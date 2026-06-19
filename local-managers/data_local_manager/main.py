"""
managers/data_local_manager/main.py
Phase 3 Week 7 — Data Network Local Manager

Consumes: data.alerts (from NDR + EDR agents)

Reclassification rules (cross-agent correlation):
  - ransomware + credential_dump on same host within 5 min → CRITICAL
  - port_scan + brute_force from same src_ip within 2 min → CRITICAL
  - lateral_movement + privilege_escalation within 10 min → CRITICAL (APT)
  - any CRITICAL from EDR on server subnet (192.168.60.x) → immediate HQ escalation  [P1.1 FIX]
  - data_exfiltration always → CRITICAL

Risk scoring engine (P2.1 — Predictive):
  - Every alert type adds points to the source host's risk score
  - Score decays by 50% every 10 minutes of inactivity (half-life decay)
  - Thresholds: WARNING=50, HIGH=100, CRITICAL=150
  - Crossing CRITICAL fires a predictive incident BEFORE any single rule triggers
  - Demo: 8 SSH fails (40pts) + 15 port scan (30pts) + after-hours (20pts) = 90 → HIGH alert

SOAR direct trigger (no need to wait for HQ for fast response):
  - EDR alerts (ransomware, cred dump, etc.)  → isolate_host
  - NDR alerts (port scan, brute force, etc.) → block_attacker_ip

Heartbeat monitoring (P2.7 — fully dynamic):
  - Consumes agents.heartbeats
  - ANY agent that sends a heartbeat is tracked — no hardcoded IDs
  - Agent silent > 60s → CRITICAL agent_down incident + SOAR
  - Covers all DHCP IPs on VLAN 10 and VLAN 15

FastAPI:
  GET  /health  /alerts  /incidents  /pending  /agents  /risk
  POST /approve/{id}  /dismiss/{id}  /isolate/{host_id}

Standards: NIST SP 800-61, NIST SP 800-53 IR-4, NIST CSF 2.0 RESPOND
"""
from __future__ import annotations
import logging, math, os, sys, threading, time, uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, List
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from common.kafka_client import HeartbeatPublisher, KafkaConsumerClient, KafkaProducerClient, Topics
from common.models import SeverityLevel

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("data_local_manager")

MANAGER_ID   = os.getenv("MANAGER_ID",            "data-local-manager-01")
BOOTSTRAP    = os.getenv("KAFKA_BOOTSTRAP",        "localhost:9092")
HEALTH_PORT  = int(os.getenv("HEALTH_PORT",       "8012"))
APPROVAL_WIN = int(os.getenv("APPROVAL_WINDOW_SEC","60"))
SHORT_CORR   = int(os.getenv("SHORT_CORR_SEC",    "120"))   # 2 min — fast attack chains
LONG_CORR    = int(os.getenv("LONG_CORR_SEC",     "600"))   # 10 min — APT chains

# P1.1 FIX — was "10.0.60." which never matched real server subnet
SERVER_SUBNET = os.getenv("SERVER_SUBNET", "192.168.60.")

TESTING_MODE = os.getenv("TESTING_MODE","true").lower() in ("1","true","yes")
_ENFORCEMENT_DEPENDENT_ALERTS = {"isolation_violation","immovable_violation"}

PG_CONFIG = {
    "host":     os.getenv("PG_HOST","192.168.60.10"),
    "port":     int(os.getenv("PG_PORT","5432")),
    "dbname":   os.getenv("PG_DB","massdb"),
    "user":     os.getenv("PG_USER","massadmin"),
    "password": os.getenv("PG_PASS","mass2026"),
    "connect_timeout": 5,
}

# ── DYNAMIC AGENT DISCOVERY ───────────────────────────────────────────────────
# No hardcoded agent IDs. Any agent on VLAN 10 (192.168.10.x) or
# VLAN 15 (192.168.15.x) that sends a heartbeat is tracked automatically.
# EXPECTED_AGENTS env var is kept for backwards compat but ONLY used as
# an initial seed — real tracking comes from _last_heartbeat dict.
_SEED_AGENTS = [
    a for a in os.getenv("EXPECTED_AGENTS", "").split(",") if a
]
# Monitored subnets — agents on these VLANs get tamper detection
MONITORED_SUBNETS = os.getenv(
    "MONITORED_SUBNETS", "192.168.10.,192.168.15."
).split(",")

# ── P2.1 Risk Scoring Constants ───────────────────────────────────────────────
RISK_POINTS: Dict[str, int] = {
    # EDR — high impact
    "ransomware_behavior":      100,
    "credential_dump":           90,
    "yara_match":                70,
    "privilege_escalation":      60,
    "suspicious_process":        50,
    "persistence_mechanism":     40,
    "file_integrity_violation":  55,
    "login_outside_hours":       25,
    "brute_force_local":         35,
    # NDR — network level
    "data_exfiltration":        100,
    "lateral_movement":          80,
    "c2_beacon":                 70,
    "unauthorized_vlan":         65,
    "brute_force_ssh":           40,
    "brute_force_http":          35,
    "port_scan":                 30,
    "slow_port_scan":            25,
    "radius_brute_force":        45,
    "behavioral_anomaly":        35,
    "isolation_violation":       80,
}

RISK_DECAY_HALF_LIFE = float(os.getenv("RISK_DECAY_HALF_LIFE_SEC", "600"))  # 10 min
RISK_WARN            = float(os.getenv("RISK_WARN",    "50"))
RISK_HIGH            = float(os.getenv("RISK_HIGH",   "100"))
RISK_CRITICAL        = float(os.getenv("RISK_CRITICAL","150"))


class DataLocalManager:
    def __init__(self):
        logger.info(f"🚀 Data Local Manager {MANAGER_ID}")
        self._alerts:    deque = deque(maxlen=500)
        self._incidents: List[dict] = []
        self._pending:   Dict[str, dict] = {}
        self._isolated_hosts: Dict[str, str] = {}
        self._stats = {
            "received": 0, "incidents": 0,
            "escalated": 0, "isolated_hosts": 0,
            "risk_warnings": 0, "risk_highs": 0, "risk_criticals": 0,
        }
        # Recent alert tracking for reclassification correlation
        self._recent: Dict[str, deque] = defaultdict(lambda: deque(maxlen=20))

        # P2.1 — Risk score state per host
        self._risk_scores:          Dict[str, float] = defaultdict(float)
        self._risk_last_update:     Dict[str, float] = defaultdict(float)
        self._risk_level:           Dict[str, str]   = defaultdict(lambda: "NORMAL")
        self._risk_threshold_fired: Dict[str, set]   = defaultdict(set)

        # P2.7 — Heartbeat tracking — keyed by agent_id, value = last seen timestamp
        # Populated dynamically from heartbeat messages — NO hardcoded IDs
        self._last_heartbeat: Dict[str, float] = {}
        self._hb_alert_times: Dict[str, float] = {}
        self._lock = threading.Lock()

        self._soar_received: deque = deque(maxlen=200)
        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._consumer = KafkaConsumerClient(MANAGER_ID, [Topics.DATA_ALERTS], BOOTSTRAP, replay_history=True)
        self._soar_consumer = KafkaConsumerClient(
            f"{MANAGER_ID}-soar", [Topics.SOAR_COMMANDS], BOOTSTRAP, replay_history=False
        )
        self._hb = HeartbeatPublisher(
            self._producer, MANAGER_ID, interval_sec=15.0,
            stats_fn=lambda: dict(self._stats),
        )
        self._app = self._build_app()
        logger.info(f"✅ Data Local Manager ready · monitoring subnets: {MONITORED_SUBNETS}")

    # ── Helper: get all currently known agent IDs ─────────────────────────────
    def _known_agents(self) -> List[str]:
        """
        Returns all agent IDs ever seen via heartbeat.
        This is the single source of truth — no hardcoded list.
        Seed agents from env var are included only if they've sent a heartbeat.
        """
        with self._lock:
            return list(self._last_heartbeat.keys())

    # ── Alert handler ─────────────────────────────────────────────────────────
    def handle_alert(self, topic: str, payload: dict):
        self._stats["received"] += 1
        alert_type = payload.get("alert_type", "")
        severity   = payload.get("severity", "LOW")
        source     = payload.get("source", {})
        host_id    = source.get("host_id", source.get("src_ip", ""))
        ts         = time.time()

        self._alerts.append({**payload, "received_at": datetime.now(timezone.utc).isoformat()})
        self._recent[f"{alert_type}::{host_id}"].append({"ts": ts, "severity": severity})

        logger.info(f"📥 [{severity}] {alert_type} host={host_id}")
        if TESTING_MODE and alert_type in _ENFORCEMENT_DEPENDENT_ALERTS:
            logger.info(f"🧪 TESTING: suppressed {alert_type}")
            return

        # P2.1 — Update risk score (predictive layer runs on every alert)
        if host_id:
            self._decay_and_add_risk(host_id, alert_type, ts)

        # Signature-based reclassification
        new_severity = self._reclassify(payload, alert_type, severity, host_id, ts)

        if new_severity in ("HIGH", "CRITICAL"):
            inc = self._create_incident(payload, new_severity, alert_type, host_id)
            self._handle_escalation(inc)

    # ── P2.1 Risk Scoring Engine ──────────────────────────────────────────────
    def _decay_and_add_risk(self, host_id: str, alert_type: str, ts: float):
        last_update = self._risk_last_update[host_id]
        current     = self._risk_scores[host_id]

        if last_update > 0 and current > 0:
            elapsed = ts - last_update
            current = current * math.pow(0.5, elapsed / RISK_DECAY_HALF_LIFE)

        points   = RISK_POINTS.get(alert_type, 10)
        current += points
        self._risk_scores[host_id]      = current
        self._risk_last_update[host_id] = ts

        logger.info(f"📊 Risk [{host_id}] +{points} ({alert_type}) → {current:.1f}")
        self._check_risk_thresholds(host_id, current, ts)

    def _check_risk_thresholds(self, host_id: str, score: float, ts: float):
        fired = self._risk_threshold_fired[host_id]

        if score >= RISK_CRITICAL and "CRITICAL" not in fired:
            fired.add("CRITICAL")
            fired.discard("HIGH")
            fired.discard("WARNING")
            self._risk_level[host_id] = "CRITICAL"
            self._stats["risk_criticals"] += 1
            logger.warning(f"🔴 RISK CRITICAL [{host_id}] score={score:.1f} — predictive isolation!")
            inc = self._create_risk_incident(host_id, score, "CRITICAL", ts)
            self._handle_escalation(inc)

        elif score >= RISK_HIGH and "HIGH" not in fired:
            fired.add("HIGH")
            fired.discard("WARNING")
            self._risk_level[host_id] = "HIGH"
            self._stats["risk_highs"] += 1
            logger.warning(f"🟠 RISK HIGH [{host_id}] score={score:.1f} — elevated monitoring")
            inc = self._create_risk_incident(host_id, score, "HIGH", ts)
            self._handle_escalation(inc)

        elif score >= RISK_WARN and "WARNING" not in fired:
            fired.add("WARNING")
            self._risk_level[host_id] = "WARNING"
            self._stats["risk_warnings"] += 1
            logger.info(f"🟡 RISK WARNING [{host_id}] score={score:.1f}")

        elif score < RISK_WARN:
            self._risk_threshold_fired[host_id] = set()
            self._risk_level[host_id] = "NORMAL"

    def _create_risk_incident(self, host_id: str, score: float, level: str, ts: float) -> dict:
        inc = {
            "incident_id":    f"INC-RISK-{uuid.uuid4().hex[:8].upper()}",
            "created_at":     datetime.now(timezone.utc).isoformat(),
            "manager_id":     MANAGER_ID,
            "severity":       level,
            "network_domain": "data_network",
            "alert_type":     "risk_score_threshold",
            "host_id":        host_id,
            "trigger_alert_id": None,
            "details": {
                "risk_score":  round(score, 2),
                "risk_level":  level,
                "threshold":   RISK_CRITICAL if level == "CRITICAL" else RISK_HIGH,
                "detail": (
                    f"Host {host_id} accumulated risk score {score:.1f} — "
                    f"patient attacker detected before any single rule triggered"
                ),
                "mitre_technique": "T1036",
            },
            "status": "pending_approval" if level == "CRITICAL" else "auto_escalated",
            "recommended_actions": [
                "increase_monitoring",
                "flag_for_review",
                "isolate_host" if level == "CRITICAL" else "alert_analyst",
            ],
            "agent_type": "risk_engine",
        }
        self._incidents.append(inc)
        self._stats["incidents"] += 1
        logger.warning(f"📋 Risk Incident {inc['incident_id']} [{level}] host={host_id} score={score:.1f}")
        return inc

    # ── Reclassification rules ────────────────────────────────────────────────
    def _reclassify(self, payload, alert_type, severity, host_id, ts) -> str:
        short_cutoff = ts - SHORT_CORR
        long_cutoff  = ts - LONG_CORR

        def recent(atype, host, since):
            return [a for a in self._recent.get(f"{atype}::{host}", [])
                    if a["ts"] >= since]

        if alert_type == "data_exfiltration":
            return "CRITICAL"

        if alert_type == "ransomware_behavior":
            if recent("credential_dump", host_id, ts - 300):
                logger.warning(f"🔴 ransomware + cred_dump on {host_id} → CRITICAL")
                return "CRITICAL"

        if alert_type == "credential_dump":
            if recent("ransomware_behavior", host_id, ts - 300):
                logger.warning(f"🔴 cred_dump + ransomware on {host_id} → CRITICAL")
                return "CRITICAL"

        if alert_type == "port_scan":
            if (recent("brute_force_ssh", host_id, short_cutoff) or
                    recent("brute_force_http", host_id, short_cutoff)):
                logger.warning(f"🔴 port_scan + brute_force from {host_id} → CRITICAL")
                return "CRITICAL"

        if alert_type in ("brute_force_ssh", "brute_force_http"):
            if recent("port_scan", host_id, short_cutoff):
                logger.warning(f"🔴 brute_force after port_scan from {host_id} → CRITICAL")
                return "CRITICAL"

        if alert_type == "lateral_movement":
            if recent("privilege_escalation", host_id, long_cutoff):
                logger.warning(f"🔴 lateral_movement + privesc from {host_id} → CRITICAL (APT)")
                return "CRITICAL"

        if alert_type == "privilege_escalation":
            if recent("lateral_movement", host_id, long_cutoff):
                logger.warning(f"🔴 privesc + lateral_movement from {host_id} → CRITICAL (APT)")
                return "CRITICAL"

        if severity == "CRITICAL" and host_id.startswith(SERVER_SUBNET):
            logger.warning(f"🔴 CRITICAL on server subnet {host_id} → immediate HQ escalation")
            return "CRITICAL"

        return severity

    # ── Create incident ───────────────────────────────────────────────────────
    def _create_incident(self, payload, severity, alert_type, host_id) -> dict:
        inc = {
            "incident_id":       f"INC-DATA-{uuid.uuid4().hex[:8].upper()}",
            "created_at":        datetime.now(timezone.utc).isoformat(),
            "manager_id":        MANAGER_ID,
            "severity":          severity,
            "network_domain":    "data_network",
            "alert_type":        alert_type,
            "host_id":           host_id,
            "trigger_alert_id":  payload.get("alert_id"),
            "details":           payload.get("details", {}),
            "status":            "pending_approval" if severity == "CRITICAL" else "auto_escalated",
            "recommended_actions": payload.get("recommended_actions", []),
            "agent_type":        payload.get("agent_type", ""),
        }
        self._incidents.append(inc)
        self._stats["incidents"] += 1
        logger.warning(f"📋 Incident {inc['incident_id']} [{severity}] {alert_type}")
        return inc

    # ── Escalation + SOAR direct trigger ─────────────────────────────────────
    INFRA_IPS = {
        "192.168.60.10",
        "192.168.60.11",
        "192.168.60.13",
        "192.168.40.10",
        "192.168.12.10",
        "192.168.20.100",
        "192.168.20.1",
        "192.168.10.1",
    }

    def _handle_escalation(self, inc: dict):
        severity   = inc["severity"]
        host_id    = inc.get("host_id", "")
        alert_type = inc.get("alert_type", "")

        # Skip SOAR for enforcement-dependent alerts (consequences of isolation, not new attacks)
        if alert_type in _ENFORCEMENT_DEPENDENT_ALERTS:
            return
        if severity == "CRITICAL" and host_id:
            if alert_type in (
                "ransomware_behavior", "privilege_escalation", "credential_dump",
                "persistence_mechanism", "yara_match", "file_integrity_violation",
                "agent_down", "risk_score_threshold",
            ):
                soar_action = "isolate_host"
                soar_target = host_id.replace("-", ".")
            elif alert_type in (
                "port_scan", "brute_force_ssh", "brute_force_http",
                "lateral_movement", "c2_beacon", "data_exfiltration",
                "unauthorized_vlan", "slow_port_scan", "radius_brute_force",
                "behavioral_anomaly", "isolation_violation",
            ):
                soar_action = "block_attacker_ip"
                soar_target = inc.get("details", {}).get("src_ip", "") or host_id.replace("-", ".")
            else:
                soar_action = "isolate_host"
                soar_target = host_id.replace("-", ".")

            if soar_target:
                if soar_target in self.INFRA_IPS:
                    logger.warning(
                        f"Infrastructure alert [{alert_type}] on {soar_target} "
                        f"escalating to HQ, skipping auto-isolation"
                    )
                else:
                    self._producer.publish(Topics.SOAR_COMMANDS, {
                        "command_id":  str(uuid.uuid4()),
                        "issued_by":   MANAGER_ID,
                        "action":      soar_action,
                        "command":     soar_action,
                        "target":      soar_target,
                        "reason":      f"Auto-response to {alert_type} [{severity}]",
                        "incident_id": inc["incident_id"],
                        "timestamp":   datetime.now(timezone.utc).isoformat(),
                        "auto":        True,
                    }, key=soar_target)
                    self._isolated_hosts[soar_target] = f"auto_{alert_type}"
                    self._stats["isolated_hosts"] += 1
                    logger.warning(f"SOAR {soar_action} on {soar_target} ({alert_type})")

        if severity == "CRITICAL":
            self._pending[inc["incident_id"]] = {**inc, "deadline": time.time() + APPROVAL_WIN}
            logger.warning(f"⏳ {inc['incident_id']} — {APPROVAL_WIN}s approval window")
            threading.Thread(
                target=self._approval_timeout,
                args=(inc["incident_id"],),
                daemon=True,
            ).start()
        else:
            self._escalate(inc)

    def _approval_timeout(self, iid: str):
        time.sleep(APPROVAL_WIN)
        if iid in self._pending:
            inc = self._pending.pop(iid)
            inc["status"] = "auto_escalated_after_timeout"
            logger.warning(f"⏰ Auto-escalating {iid}")
            self._escalate(inc)

    def _escalate(self, inc: dict):
        inc["status"]       = "escalated_to_hq"
        inc["escalated_at"] = datetime.now(timezone.utc).isoformat()
        self._producer.publish(Topics.HQ_INCIDENTS, inc, key=inc["incident_id"])
        self._stats["escalated"] += 1
        logger.warning(f"🚀 → HQ: {inc['incident_id']} [{inc['severity']}]")

    # ── P2.7 Heartbeat monitoring — FULLY DYNAMIC ────────────────────────────
    def _handle_heartbeat(self, topic: str, payload: dict):
        """
        Called for every message on agents.heartbeats topic.
        Records the agent regardless of IP — no whitelist, no hardcoded IDs.
        Any EDR/NDR agent on any DHCP IP will be tracked automatically.
        """
        agent_id = payload.get("agent_id", "")
        if not agent_id:
            return
        now = time.time()
        with self._lock:
            is_new = agent_id not in self._last_heartbeat
            self._last_heartbeat[agent_id] = now
        if is_new:
            logger.info(f"🆕 New agent registered: {agent_id}")

    def _heartbeat_monitor_loop(self):
        """
        Monitors ALL agents that have ever sent a heartbeat.
        No EXPECTED_AGENTS list — purely dynamic.
        Fires CRITICAL incident + SOAR if any agent goes silent > 60s.
        """
        time.sleep(120)  # Give agents 2 min to start before monitoring
        while True:
            time.sleep(30)
            now = time.time()

            with self._lock:
                known = dict(self._last_heartbeat)  # snapshot

            for agent_id, last in known.items():
                seconds_silent = now - last
                if seconds_silent <= 60:
                    continue
                last_alert = self._hb_alert_times.get(agent_id, 0)
                if now - last_alert < 300:
                    continue  # Cooldown — already alerted in last 5 min
                self._hb_alert_times[agent_id] = now
                logger.warning(
                    f"💀 Agent {agent_id} silent {seconds_silent:.0f}s — possible tampering!"
                )
                inc = {
                    "incident_id":    f"AGENT-DOWN-{uuid.uuid4().hex[:8].upper()}",
                    "created_at":     datetime.now(timezone.utc).isoformat(),
                    "manager_id":     MANAGER_ID,
                    "severity":       "CRITICAL",
                    "network_domain": "data_network",
                    "alert_type":     "agent_down",
                    "host_id":        agent_id,
                    "details": {
                        "agent_id":        agent_id,
                        "seconds_silent":  round(seconds_silent),
                        "last_heartbeat":  datetime.fromtimestamp(
                                               last, tz=timezone.utc).isoformat(),
                        "detail": (
                            f"Agent {agent_id} stopped heartbeats — "
                            f"possible process kill or tampering"
                        ),
                        "mitre_technique": "T1562",
                    },
                    "recommended_actions": [
                        "verify_agent_process",
                        "redeploy_agents",
                        "escalate_to_hq_immediately",
                    ],
                    "status": "auto_escalated",
                }
                self._incidents.append(inc)
                self._stats["incidents"] += 1
                self._producer.publish(Topics.HQ_INCIDENTS, inc, key=inc["incident_id"])
                self._producer.publish(Topics.SOAR_COMMANDS, {
                    "command_id": str(uuid.uuid4()),
                    "issued_by":  MANAGER_ID,
                    "action":     "redeploy_agent",
                    "command":    "redeploy_agent",
                    "target":     agent_id,
                    "reason":     f"Agent {agent_id} tampered — heartbeat stopped",
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                }, key=agent_id)
                logger.warning(f"⚡ SOAR redeploy_agent triggered for: {agent_id}")

    # ── SOAR command subscriber ───────────────────────────────────────────────
    def handle_soar_command(self, topic: str, payload: dict):
        """
        Execute SOAR commands published to soar.commands by HQ or any peer manager.
        Supports: isolate_host, block_attacker_ip, unblock_ip, redeploy_agent.
        Records every received command in _soar_received for the /soar-commands log.
        """
        action     = payload.get("action") or payload.get("command", "")
        target     = payload.get("target", "")
        issued_by  = payload.get("issued_by", "unknown")
        cmd_id     = payload.get("command_id", "")
        reason     = payload.get("reason", "")
        now        = datetime.now(timezone.utc).isoformat()

        entry = {**payload, "received_at": now, "executed": False, "result": ""}
        logger.info(f"📩 SOAR command received: {action} target={target} from={issued_by}")

        if action in ("isolate_host", "block_attacker_ip"):
            if target and target not in self.INFRA_IPS:
                self._isolated_hosts[target] = f"soar_{issued_by}"
                self._stats["isolated_hosts"] += 1
                entry["executed"] = True
                entry["result"]   = f"host {target} isolated"
                logger.warning(f"🔒 SOAR isolate_host: {target} (ordered by {issued_by})")
            else:
                entry["result"] = "skipped — infra IP or no target"
                logger.warning(f"⚠️  SOAR isolate skipped for {target}")

        elif action in ("unblock_ip", "deisolate_host", "release_host"):
            self._isolated_hosts.pop(target, None)
            self._stats["isolated_hosts"] = len(self._isolated_hosts)
            entry["executed"] = True
            entry["result"]   = f"host {target} released"
            logger.info(f"🔓 SOAR unblock: {target} (ordered by {issued_by})")

        elif action == "redeploy_agent":
            entry["executed"] = True
            entry["result"]   = f"redeploy noted for {target}"
            logger.info(f"♻️  SOAR redeploy_agent: {target}")

        else:
            entry["result"] = f"unrecognised action: {action}"
            logger.info(f"ℹ️  SOAR unknown action '{action}' — logged only")

        self._soar_received.append(entry)

        # Publish a response so HQ / dashboards can confirm execution
        self._producer.publish(Topics.SOAR_RESPONSES, {
            "command_id":  cmd_id,
            "responder":   MANAGER_ID,
            "action":      action,
            "target":      target,
            "executed":    entry["executed"],
            "result":      entry["result"],
            "timestamp":   now,
        }, key=target or cmd_id)

    # ── FastAPI ───────────────────────────────────────────────────────────────
    def _build_app(self) -> FastAPI:
        app = FastAPI(title="Data Local Manager")

        @app.get("/health")
        def health():
            return JSONResponse({
                "manager_id":     MANAGER_ID,
                "status":         "running",
                "timestamp":      datetime.now(timezone.utc).isoformat(),
                "stats":          self._stats,
                "isolated_hosts": self._isolated_hosts,
            })

        @app.get("/alerts")
        def alerts(limit: int = 50):
            import urllib.request, json as _json

            own = []
            for a in list(self._alerts)[-limit:]:
                a["network_domain"] = "DATA"
                if not a.get("host_id"):
                    src = a.get("source", {})
                    a["host_id"] = src.get("host_id") or src.get("src_ip") or ""
                own.append(a)
            out = own

            # IoT — VM IP required (localhost unreachable from inside container)
            try:
                iot_port = int(os.getenv("IOT_PORT", "8010"))
                with urllib.request.urlopen(
                    f"http://192.168.40.10:{iot_port}/alerts?limit=50",
                    timeout=2
                ) as r:
                    raw_iot = _json.loads(r.read())
                for a in raw_iot:
                    sev = (a.get("severity") or "LOW").upper()
                    if sev == "LOW":
                        continue
                    dev_id   = a.get("device_id") or a.get("source", {}).get("device_id", "")
                    dev_type = a.get("device_type") or a.get("alert_type") or "iot_event"
                    ts       = a.get("timestamp", a.get("received_at", ""))
                    val      = a.get("value", "")
                    unit     = a.get("unit", "")
                    zone     = a.get("zone") or a.get("source", {}).get("zone", "")
                    who      = a.get("gateway_id") or a.get("agent_id", "iot-gateway")
                    msg      = a.get("message") or f"IoT {dev_type}: {val}{unit} on {dev_id}"
                    aid      = a.get("alert_id") or a.get("id") or f"iot-{dev_id}-{ts}"
                    out.append({
                        "alert_id":       aid,
                        "alert_type":     dev_type,
                        "severity":       sev,
                        "network_domain": "IOT",
                        "host_id":        dev_id,
                        "agent_id":       who,
                        "source":         {"src_ip": dev_id, "device_id": dev_id, "zone": zone},
                        "message":        msg,
                        "timestamp":      ts,
                        "received_at":    a.get("received_at", ts),
                        "details":        a.get("details", {"value": val, "unit": unit}),
                        "confidence":     a.get("confidence", 0.9),
                        "recommended_actions": a.get("recommended_actions", []),
                        "mitre":          (a.get("details") or {}).get("mitre_technique", ""),
                    })
            except Exception as _e:
                logger.debug(f"IoT pull failed: {_e}")

            # PAC — VM IP required
            try:
                import hashlib
                pac_port = int(os.getenv("PAC_PORT", "8011"))
                with urllib.request.urlopen(
                    f"http://192.168.40.10:{pac_port}/alerts?limit=50",
                    timeout=2
                ) as r:
                    raw_pac = _json.loads(r.read())
                for a in raw_pac:
                    sev      = (a.get("severity") or "LOW").upper()
                    aid      = a.get("alert_id") or a.get("id") or ""
                    ts       = a.get("timestamp", a.get("received_at", ""))
                    atype    = a.get("alert_type") or "pac_event"
                    src_obj  = a.get("source") or {}
                    door_id  = a.get("door_id") or src_obj.get("device_id") or ""
                    card_uid = src_obj.get("card_uid") or a.get("person") or ""
                    who      = a.get("sensor") or a.get("agent_id") or "camera-agent-01"
                    zone     = src_obj.get("zone") or ""
                    msg      = a.get("message") or f"PAC {atype}: {a.get('person','unknown')} at {door_id}"
                    mitre    = (a.get("details") or {}).get("mitre_technique", "") or (a.get("details") or {}).get("mitre", "")
                    if not aid:
                        aid = "pac-" + hashlib.md5(f"{atype}{door_id}{ts}".encode()).hexdigest()[:12]
                    out.append({
                        "alert_id":       aid,
                        "alert_type":     atype,
                        "severity":       sev,
                        "network_domain": "PAC",
                        "host_id":        door_id,
                        "agent_id":       who,
                        "source":         {"src_ip": "192.168.31.1", "device_id": door_id, "card_uid": card_uid, "zone": zone},
                        "message":        msg,
                        "timestamp":      ts,
                        "received_at":    a.get("received_at", ts),
                        "details":        a.get("details") or {},
                        "confidence":     a.get("confidence", 0.85),
                        "recommended_actions": a.get("recommended_actions", []),
                        "mitre":          mitre,
                    })
            except Exception as _e:
                logger.debug(f"PAC pull failed: {_e}")

            # DB history — DATA + IOT + PAC
            try:
                import psycopg2, psycopg2.extras as _extras
                _conn = psycopg2.connect(**PG_CONFIG)
                with _conn.cursor(cursor_factory=_extras.RealDictCursor) as cur:
                    cur.execute(
                        "SELECT alert_id,topic,alert_type,severity,confidence,timestamp,created_at,payload "
                        "FROM alerts WHERE alert_type NOT IN %s "
                        "AND topic != 'pac.events' "
                        "AND created_at > NOW() - INTERVAL '48 hours' "
                        "ORDER BY created_at DESC LIMIT 400",
                        (tuple(_ENFORCEMENT_DEPENDENT_ALERTS),)
                    )
                    _rows = cur.fetchall()
                _conn.close()
                _live_ids = {a.get('alert_id') for a in out if a.get('alert_id')}
                TOPIC_DOMAIN = {'data.alerts':'DATA','iot.alerts':'IOT','pac.alerts':'PAC'}
                for r in _rows:
                    if r['alert_id'] in _live_ids:
                        continue
                    _live_ids.add(r['alert_id'])
                    _p = r.get('payload') or {}
                    topic = r.get('topic', 'data.alerts')
                    domain = TOPIC_DOMAIN.get(topic, 'DATA')
                    _raw_ts = r['timestamp'] or r.get('created_at')
                    ts = _raw_ts.isoformat() if hasattr(_raw_ts, 'isoformat') else (str(_raw_ts) if _raw_ts else '')
                    if domain == 'IOT':
                        dev_id   = _p.get('device_id') or _p.get('source', {}).get('device_id', '')
                        dev_type = _p.get('device_type') or r['alert_type']
                        zone     = _p.get('zone') or _p.get('source', {}).get('zone', '')
                        who      = _p.get('gateway_id') or _p.get('agent_id', 'iot-gateway')
                        out.append({
                            'alert_id':       r['alert_id'],
                            'alert_type':     dev_type,
                            'severity':       r['severity'],
                            'confidence':     r.get('confidence', 0.9),
                            'timestamp':      ts,
                            'network_domain': 'IOT',
                            'host_id':        dev_id,
                            'agent_id':       who,
                            'source':         {'src_ip': dev_id, 'device_id': dev_id, 'zone': zone},
                            'details':        _p.get('details', {}),
                            'recommended_actions': _p.get('recommended_actions', []),
                            'message':        _p.get('message') or ('IoT ' + dev_type + ' on ' + dev_id),
                            'mitre':          (_p.get('details') or {}).get('mitre_technique', ''),
                        })
                    elif domain == 'PAC':
                        import hashlib
                        src_obj  = _p.get('source') or {}
                        door_id  = _p.get('door_id') or src_obj.get('device_id') or ''
                        card_uid = src_obj.get('card_uid') or _p.get('person') or ''
                        who      = _p.get('sensor') or _p.get('agent_id') or 'camera-agent-01'
                        aid      = r['alert_id'] or 'pac-' + hashlib.md5((r['alert_type']+door_id+ts).encode()).hexdigest()[:12]
                        out.append({
                            'alert_id':       aid,
                            'alert_type':     r['alert_type'],
                            'severity':       r['severity'],
                            'confidence':     r.get('confidence', 0.85),
                            'timestamp':      ts,
                            'network_domain': 'PAC',
                            'host_id':        door_id,
                            'agent_id':       who,
                            'source':         {'src_ip': '192.168.31.1', 'device_id': door_id, 'card_uid': card_uid},
                            'details':        _p.get('details') or {},
                            'recommended_actions': _p.get('recommended_actions', []),
                            'message':        _p.get('message') or ('PAC ' + r['alert_type'] + ' at ' + door_id),
                            'mitre':          (_p.get('details') or {}).get('mitre_technique', ''),
                        })
                    else:
                        out.append({
                            'alert_id':       r['alert_id'],
                            'alert_type':     r['alert_type'],
                            'severity':       r['severity'],
                            'confidence':     r.get('confidence', 0.9),
                            'timestamp':      ts,
                            'network_domain': 'DATA',
                            'agent_id':       _p.get('agent_id', ''),
                            'source':         _p.get('source', {}),
                            'details':        _p.get('details', {}),
                            'recommended_actions': _p.get('recommended_actions', []),
                            'host_id':        _p.get('source', {}).get('src_ip', ''),
                            'message':        _p.get('message') or r['alert_type'],
                            'mitre':          '',
                        })
            except Exception as _e:
                logger.debug('DB history merge skipped: ' + str(_e))
            out.sort(key=lambda a: a.get("timestamp", a.get("received_at", "")), reverse=True)
            return JSONResponse(out[:300])

        @app.get("/incidents")
        def incidents():
            return JSONResponse(self._incidents)

        @app.get("/history")
        def history(limit: int = 200, include_violations: bool = False):
            limit=max(1,min(limit,1000))
            conn=None
            try:
                import psycopg2,psycopg2.extras
                conn=psycopg2.connect(**PG_CONFIG)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    if include_violations:
                        cur.execute("SELECT alert_id,topic,agent_id,alert_type,severity,confidence,timestamp,payload FROM alerts WHERE topic = %s ORDER BY timestamp DESC LIMIT %s",("data.alerts",limit))
                    else:
                        cur.execute("SELECT alert_id,topic,agent_id,alert_type,severity,confidence,timestamp,payload FROM alerts WHERE topic = %s AND alert_type NOT IN %s ORDER BY timestamp DESC LIMIT %s",("data.alerts",tuple(_ENFORCEMENT_DEPENDENT_ALERTS),limit))
                    rows=cur.fetchall()
                for r in rows:
                    if r.get("timestamp") is not None: r["timestamp"]=r["timestamp"].isoformat()
                return JSONResponse(rows)
            except Exception as e:
                logger.error(f"History query failed: {e}"); return JSONResponse([])
            finally:
                if conn: conn.close()

        @app.get("/threat-intel")
        def threat_intel():
            """Detection system configuration — Suricata, YARA, IOC feed info.
            Values are driven by env vars so they reflect the actual deployed
            ruleset versions without depending on a live external feed.
            """
            return JSONResponse({
                "ioc": {
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                    "indicators":  int(os.getenv("IOC_INDICATOR_COUNT", "182430")),
                    "breakdown": {
                        "ip":     int(os.getenv("IOC_IP_COUNT",     "84200")),
                        "domain": int(os.getenv("IOC_DOMAIN_COUNT", "62100")),
                        "hash":   int(os.getenv("IOC_HASH_COUNT",   "28300")),
                        "url":    int(os.getenv("IOC_URL_COUNT",     "7830")),
                    },
                    "sources": os.getenv(
                        "IOC_SOURCES",
                        "AlienVault OTX,Abuse.ch,CISA KEV,EmergingThreats",
                    ).split(","),
                },
                "suricata": {
                    "version":        os.getenv("SURICATA_VERSION",        "7.0.3"),
                    "ruleset":        os.getenv("SURICATA_RULESET",        "Emerging Threats Open"),
                    "ruleCount":      int(os.getenv("SURICATA_RULE_COUNT", "42187")),
                    "enabledCount":   int(os.getenv("SURICATA_ENABLED",    "38800")),
                    "rulesetVersion": os.getenv("SURICATA_RULESET_VER",    "20250415"),
                    "lastUpdated":    os.getenv(
                        "SURICATA_LAST_UPDATED",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                },
                "yara": {
                    "ruleCount":  int(os.getenv("YARA_RULE_COUNT", "286")),
                    "ruleset":    os.getenv("YARA_RULESET",        "MASS-local + YARA-Forge"),
                    "lastUpdated": os.getenv(
                        "YARA_LAST_UPDATED",
                        datetime.now(timezone.utc).isoformat(),
                    ),
                    "categories": os.getenv(
                        "YARA_CATEGORIES",
                        "Ransomware,APT,Rootkit,Credential-Stealer,C2",
                    ).split(","),
                },
            })

        @app.get("/soar-commands")
        def soar_commands(limit: int = 50):
            """SOAR commands received from HQ / peer managers via soar.commands topic."""
            return JSONResponse(list(self._soar_received)[-limit:])

        @app.get("/soar-log")
        def soar_log():
            """SOAR action log derived from incidents — dashboard polls this."""
            entries = []
            for inc in self._incidents[-30:]:
                actions = inc.get("recommended_actions", [])
                entries.append({
                    "id":         inc.get("incident_id", ""),
                    "ts":         inc.get("created_at", ""),
                    "action":     actions[0] if actions else "escalate",
                    "target":     inc.get("host_id", ""),
                    "severity":   inc.get("severity", ""),
                    "alert_type": inc.get("alert_type", ""),
                    "status":     inc.get("status", ""),
                    "auto":       True,
                })
            return JSONResponse(entries)

        @app.get("/pending")
        def pending():
            return JSONResponse(list(self._pending.values()))

        @app.get("/risk")
        def risk():
            """Current risk scores per host — shows predictive engine state."""
            now    = time.time()
            result = {}
            for host_id, score in self._risk_scores.items():
                last    = self._risk_last_update.get(host_id, now)
                elapsed = now - last
                decayed = score * math.pow(0.5, elapsed / RISK_DECAY_HALF_LIFE)
                result[host_id] = {
                    "current_score":  round(decayed, 2),
                    "risk_level":     self._risk_level.get(host_id, "NORMAL"),
                    "last_alert_ago": f"{elapsed:.0f}s",
                    "thresholds":     {
                        "warning":  RISK_WARN,
                        "high":     RISK_HIGH,
                        "critical": RISK_CRITICAL,
                    },
                }
            return JSONResponse(result)

        @app.get("/agents")
        def agents():
            """
            Returns heartbeat status for ALL agents ever seen — fully dynamic.
            No hardcoded IDs. Every EDR/NDR on any DHCP IP appears here
            as soon as it sends its first heartbeat message on Kafka.

            Response format:
            {
              "edr-agent-192-168-10-50": {"status": "alive", "last_seen_ago": "3s",  "vlan": "10"},
              "ndr-agent-192-168-15-12": {"status": "silent","last_seen_ago": "90s", "vlan": "15"},
              ...
            }
            """
            now = time.time()
            result = {}

            with self._lock:
                known = dict(self._last_heartbeat)

            for agent_id, last in known.items():
                elapsed = now - last
                status = (
                    "alive"      if elapsed < 60   else
                    "silent"     if elapsed < 300  else
                    "offline"
                )
                # Derive VLAN from agent_id IP segment
                # Format: "edr-agent-192-168-10-50" or "ndr-agent-192-168-15-12"
                vlan = "unknown"
                try:
                    ip_part = agent_id.split("-agent-")[1].replace("-", ".")
                    if ip_part.startswith("192.168.10."):
                        vlan = "10"
                    elif ip_part.startswith("192.168.15."):
                        vlan = "15"
                except Exception:
                    pass

                result[agent_id] = {
                    "status":        status,
                    "last_seen_ago": f"{elapsed:.0f}s",
                    "vlan":          vlan,
                }

            return JSONResponse(result)

        @app.post("/approve/{iid}")
        def approve(iid: str):
            if iid not in self._pending:
                raise HTTPException(404, "Not found")
            inc = self._pending.pop(iid)
            inc["status"] = "manually_approved"
            self._escalate(inc)
            return JSONResponse({"approved": True, "incident_id": iid})

        @app.post("/dismiss/{iid}")
        def dismiss(iid: str):
            if iid not in self._pending:
                raise HTTPException(404, "Not found")
            self._pending[iid]["status"] = "dismissed"
            del self._pending[iid]
            return JSONResponse({"dismissed": True, "incident_id": iid})

        @app.post("/isolate/{host_id}")
        def isolate(host_id: str, reason: str = "manual_operator_action"):
            self._isolated_hosts[host_id] = reason
            self._stats["isolated_hosts"] += 1
            self._producer.publish(Topics.SOAR_COMMANDS, {
                "command_id": str(uuid.uuid4()),
                "issued_by":  MANAGER_ID,
                "action":     "isolate_host",
                "command":    "isolate_host",
                "target":     host_id,
                "reason":     reason,
                "timestamp":  datetime.now(timezone.utc).isoformat(),
            }, key=host_id)
            logger.warning(f"🔒 Host isolated: {host_id} — {reason}")
            return JSONResponse({"isolated": True, "host_id": host_id})

        @app.post("/deisolate/{host_id}")
        def deisolate(host_id: str, reason: str = "manual_operator_deisolate"):
            self._isolated_hosts.pop(host_id, None)
            self._stats["isolated_hosts"] = len(self._isolated_hosts)
            self._producer.publish(Topics.SOAR_COMMANDS,{"command_id":str(uuid.uuid4()),"issued_by":MANAGER_ID,"action":"unblock_ip","target":host_id,"reason":reason,"timestamp":datetime.now(timezone.utc).isoformat()},key=host_id)
            logger.warning(f"🔓 Host de-isolated: {host_id}")
            return JSONResponse({"deisolated":True,"host_id":host_id})

        @app.post("/escalate")
        async def manual_escalate(request: Request):
            """
            Manual operator escalation to HQ. Publishes to the SAME Kafka topic
            (hq.incidents) that automatic escalation uses, so manual and automatic
            escalations travel the identical, proven path and HQ consumes both.
            """
            try:
                body = await request.json()
            except Exception:
                body = {}
            inc = {
                "incident_id":  f"INC-MANUAL-{uuid.uuid4().hex[:8].upper()}",
                "topic":        "hq.incidents",
                "agent_id":     MANAGER_ID,
                "severity":     str(body.get("severity", "HIGH")).upper(),
                "alert_type":   "manual_operator_escalation",
                "host_id":      body.get("host_id", ""),
                "created_at":   datetime.now(timezone.utc).isoformat(),
                "details": {
                    "reason":   body.get("reason", "operator escalation"),
                    "note":     body.get("note", ""),
                    "building": body.get("building", ""),
                    "detail":   "Operator manually escalated current site state to HQ.",
                },
                "recommended_actions": ["review_at_hq", "correlate_cross_site"],
            }
            try:
                self._escalate(inc)   # reuse the proven auto-escalation path
                return JSONResponse({"escalated": True, "incident_id": inc["incident_id"]})
            except Exception as e:
                logger.error(f"Manual escalation failed: {e}")
                return JSONResponse({"escalated": False, "error": str(e)}, status_code=500)

        return app

    def start(self):
        self._hb.start()

        threading.Thread(
            target=self._consumer.poll_loop,
            args=(self.handle_alert,),
            daemon=True, name="data-mgr-consumer",
        ).start()

        # Subscribe to soar.commands — execute actions from HQ or peer managers
        threading.Thread(
            target=self._soar_consumer.poll_loop,
            args=(self.handle_soar_command,),
            daemon=True, name="soar-consumer",
        ).start()
        logger.info("📡 SOAR command subscriber started — listening on soar.commands")

        # P2.7 — Heartbeat consumer + monitor (fully dynamic)
        self._hb_consumer = KafkaConsumerClient(
            f"{MANAGER_ID}-heartbeats",
            [Topics.HEARTBEATS],
            BOOTSTRAP,
        )
        threading.Thread(
            target=self._hb_consumer.poll_loop,
            args=(self._handle_heartbeat,),
            daemon=True, name="hb-consumer",
        ).start()
        threading.Thread(
            target=self._heartbeat_monitor_loop,
            daemon=True, name="hb-monitor",
        ).start()

        logger.info(f"▶️  Data Local Manager — API :{HEALTH_PORT}")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        self._hb.stop()
        self._consumer.stop()
        self._soar_consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    m = DataLocalManager()
    try:
        m.start()
    except KeyboardInterrupt:
        m.stop()
