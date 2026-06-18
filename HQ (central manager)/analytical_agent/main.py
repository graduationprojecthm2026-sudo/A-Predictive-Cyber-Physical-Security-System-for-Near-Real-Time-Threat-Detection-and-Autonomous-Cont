"""
agents/hq/analytical_agent/main.py
Phase 4 Week 8 — Analytical Agent (HQ Correlation Engine)

Consumes incidents from ALL three local managers via hq.incidents.
Correlates across IoT + Physical Access + Data Network to detect:

  1. coordinated_attack   — incidents from 2+ domains within 5 min (APT pattern)
  2. campus_wide_threat   — incidents in 3+ domains within 10 min
  3. insider_threat       — PAC access + data exfiltration within 15 min
                           (physical + cyber combined)
  4. iot_cyber_bridge     — IoT sensor anomaly + network lateral_movement
                           (attacker pivoted from IoT to data network)
  5. physical_cyber_combo — unknown RFID + credential_dump within 10 min
                            (physical breach enabling cyber attack)

Two correlation windows:
  fast_window  = 5 min  — fast attack chains (port_scan → brute_force → exfil)
  slow_window  = 30 min — APT campaigns (recon → persistence → exfil)

Publishes correlated incidents to: hq.correlated
Health: GET /health (port 8006)

Standards: NIST SP 800-61 Rev2 Section 3.2, MITRE ATT&CK Campaign tracking
"""
from __future__ import annotations
import logging, os, sys, threading, time, uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, List, Optional
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from common.kafka_client import KafkaConsumerClient, KafkaProducerClient, Topics

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("analytical_agent")

AGENT_ID    = os.getenv("AGENT_ID",        "analytical-agent-01")
import time as _time
CONSUMER_GROUP = f"{AGENT_ID}-{int(_time.time())}"
BOOTSTRAP   = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
HEALTH_PORT = int(os.getenv("HEALTH_PORT", "8006"))
FAST_WIN    = int(os.getenv("FAST_WINDOW_SEC",  "300"))   # 5 min
SLOW_WIN    = int(os.getenv("SLOW_WINDOW_SEC", "1800"))   # 30 min

DOMAIN_IOT  = "iot"
DOMAIN_PAC  = "physical_access"
DOMAIN_DATA = "data_network"

# MITRE ATT&CK kill-chain stage order (for reference/ordering)
KILL_CHAIN_STAGES = [
    "Reconnaissance", "Initial Access", "Execution", "Persistence",
    "Privilege Escalation", "Lateral Movement", "Collection", "Exfiltration",
    "Impact", "Discovery",
]

KILL_CHAIN_MAP: Dict[str, str] = {
    "port_scan":                      "Reconnaissance",
    "slow_port_scan":                 "Reconnaissance",
    "dns_tunneling":                  "Reconnaissance",
    "brute_force_ssh":                "Initial Access",
    "brute_force_http":               "Initial Access",
    "unknown_card":                   "Initial Access",
    "unauthorized_card":              "Initial Access",
    "after_hours":                    "Initial Access",
    "suspicious_process":             "Execution",
    "credential_dump":                "Execution",
    "yara_match":                     "Execution",
    "persistence_mechanism":          "Persistence",
    "privilege_escalation":           "Privilege Escalation",
    "lateral_movement":               "Lateral Movement",
    "unauthorized_vlan":              "Lateral Movement",
    "c2_beacon":                      "Collection",
    "data_exfiltration":              "Exfiltration",
    "ransomware_behavior":            "Impact",
    "sensor_dropout":                 "Discovery",
    "temperature_behavioral_anomaly": "Discovery",
    "gas_behavioral_anomaly":         "Discovery",
}


class AnalyticalAgent:
    def __init__(self):
        logger.info(f"🚀 Starting Analytical Agent {AGENT_ID}")

        # All incidents indexed by domain and time
        self._incidents: deque = deque(maxlen=1000)
        self._by_domain: Dict[str, deque] = {
            DOMAIN_IOT:  deque(maxlen=200),
            DOMAIN_PAC:  deque(maxlen=200),
            DOMAIN_DATA: deque(maxlen=200),
        }

        # Correlated incidents (campaign-level)
        self._correlated: List[dict] = []
        self._dedup: Dict[str, float] = {}   # prevent re-firing same correlation

        # Per-correlation kill-chain entries: correlation_id → {correlation_id, type, actors, stages, status, ...}
        self._kill_chain_tracker: Dict[str, dict] = {}
        # Per-actor stage tracking for Rule 6 kill-chain progression detection
        self._actor_stages: Dict[str, Dict[str, List[float]]] = defaultdict(
            lambda: defaultdict(list)
        )

        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._consumer = KafkaConsumerClient(
            CONSUMER_GROUP, [Topics.HQ_INCIDENTS, "ti.enriched", Topics.SOAR_COMMANDS], BOOTSTRAP)
        self._stats = {
            "incidents_received": 0, "correlations_fired": 0,
            "coordinated_attack": 0, "campus_wide_threat": 0,
            "insider_threat": 0, "iot_cyber_bridge": 0,
            "physical_cyber_combo": 0, "kill_chain_progression": 0,
            "ti_enriched_received": 0,
        }
        self._throughput_window = []
        self._enhanced_capture  = False
        self._capture_until     = 0.0
        self._capture_buffer    = []
        self._enhanced_logging  = False
        self._logging_until     = 0.0
        self._app = self._build_app()
        logger.info("✅ Analytical Agent ready")

    # ── SOAR command handler (analytical agent actions) ───────────────────────
    def _handle_soar_command_aa(self, cmd: dict):
        action = cmd.get("action", "")
        if action == "capture_full_traffic":
            self._enhanced_capture = True
            self._capture_until    = time.time() + 60
            self._capture_buffer   = []
            logger.info("CAPTURE: Full traffic capture started for 60s")
        elif action == "enable_enhanced_logging":
            self._enhanced_logging = True
            self._logging_until    = time.time() + 1800
            logging.getLogger().setLevel(logging.DEBUG)
            logger.info("LOGGING: Enhanced logging enabled for 30 minutes")
        elif action == "resolve_killchain":
            cid = cmd.get("correlation_id", "")
            if cid in self._kill_chain_tracker:
                self._kill_chain_tracker[cid]["status"] = "resolved"
                logger.info(f"Kill-chain {cid} resolved by {cmd.get('resolved_by', 'unknown')}")

    # ── Incident handler ──────────────────────────────────────────────────────
    def handle_incident(self, topic: str, payload: dict):
        if topic == Topics.SOAR_COMMANDS:
            self._handle_soar_command_aa(payload)
            return
        self._stats["incidents_received"] += 1
        self._throughput_window.append((time.time(), payload.get("network_domain", "unknown")))
        if topic == "ti.enriched":
            self._stats["ti_enriched_received"] += 1
            ti = payload.get("threat_intelligence", {})
            if ti.get("enriched"):
                logger.warning(
                    f"TI-enriched incident: {ti.get('iocs_matched')} IOCs matched, "
                    f"actors: {ti.get('threat_actors')}"
                )
                if ti.get("severity_upgraded"):
                    logger.warning(
                        f"TI upgraded severity: {ti.get('original_severity')} "
                        f"-> {ti.get('new_severity')}"
                    )
        domain    = payload.get("network_domain", "unknown")
        severity  = payload.get("severity", "LOW")
        alert_type= payload.get("alert_type", "")
        ts        = time.time()

        kill_chain_stage = KILL_CHAIN_MAP.get(alert_type, "Unknown")
        actor = (payload.get("src_ip") or payload.get("host_id")
                 or payload.get("card_uid") or "unknown")

        inc = {**payload, "received_at": datetime.now(timezone.utc).isoformat(),
               "_ts": ts, "kill_chain_stage": kill_chain_stage, "_actor": actor}
        self._incidents.append(inc)

        if self._enhanced_capture:
            if time.time() > self._capture_until:
                self._enhanced_capture = False
            else:
                self._capture_buffer.append(payload)
                if len(self._capture_buffer) > 500:
                    self._capture_buffer = self._capture_buffer[-500:]
        if self._enhanced_logging and time.time() > self._logging_until:
            self._enhanced_logging = False
            logging.getLogger().setLevel(logging.INFO)
            logger.info("LOGGING: Enhanced logging period ended, reverting to INFO")

        if domain in self._by_domain:
            self._by_domain[domain].append(inc)

        if kill_chain_stage != "Unknown" and actor != "unknown":
            self._actor_stages[actor][kill_chain_stage].append(ts)

        logger.info(f"📥 [{domain}] [{severity}] {alert_type} "
                    f"stage={kill_chain_stage} actor={actor} "
                    f"id={payload.get('incident_id','?')}")

        # Run correlation engine on every new incident
        self._correlate(inc, ts)

    # ── Correlation engine ────────────────────────────────────────────────────
    def _recent(self, domain: str, since: float,
                alert_types: Optional[List[str]] = None,
                min_severity: str = "LOW") -> List[dict]:
        order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
        return [
            i for i in self._by_domain.get(domain, [])
            if i["_ts"] >= since
            and order.get(i.get("severity","LOW"),0) >= order.get(min_severity,0)
            and (alert_types is None or i.get("alert_type","") in alert_types)
        ]

    def _correlate(self, trigger: dict, ts: float):
        fast_since = ts - FAST_WIN
        slow_since = ts - SLOW_WIN
        domain     = trigger.get("network_domain","")

        # ── Rule 1: Coordinated attack — 2+ domains in FAST window ────────────
        active_domains = {
            d for d in [DOMAIN_IOT, DOMAIN_PAC, DOMAIN_DATA]
            if self._recent(d, fast_since, min_severity="HIGH")
        }
        if len(active_domains) >= 2 and domain in active_domains:
            key = f"coordinated:{':'.join(sorted(active_domains))}"
            if self._fire(key, ts, cooldown=300):
                self._publish_correlation("coordinated_attack", "CRITICAL",
                    trigger, list(active_domains),
                    {"domains": list(active_domains),
                     "window_sec": FAST_WIN,
                     "detail": "HIGH+ incidents detected in multiple network domains simultaneously"},
                    ["activate_campus_lockdown_protocol",
                     "notify_all_local_managers", "alert_ciso"])
                self._stats["coordinated_attack"] += 1

        # ── Rule 2: Campus-wide threat — all 3 domains in SLOW window ─────────
        all_domains = {
            d for d in [DOMAIN_IOT, DOMAIN_PAC, DOMAIN_DATA]
            if self._recent(d, slow_since, min_severity="MEDIUM")
        }
        if len(all_domains) == 3:
            key = "campus_wide_threat"
            if self._fire(key, ts, cooldown=600):
                self._publish_correlation("campus_wide_threat", "CRITICAL",
                    trigger, list(all_domains),
                    {"domains": list(all_domains),
                     "window_sec": SLOW_WIN,
                     "detail": "Active threats across all three network domains — possible APT campaign"},
                    ["escalate_to_national_cert",
                     "full_campus_incident_response",
                     "preserve_all_evidence"])
                self._stats["campus_wide_threat"] += 1

        # ── Rule 3: Insider threat — PAC access + data exfil in SLOW window ───
        pac_incidents = self._recent(DOMAIN_PAC, slow_since,
                                     alert_types=["unknown_card","unauthorized_card",
                                                  "after_hours","badge_clone"],
                                     min_severity="MEDIUM")
        data_exfil    = self._recent(DOMAIN_DATA, slow_since,
                                     alert_types=["data_exfiltration"],
                                     min_severity="HIGH")
        if pac_incidents and data_exfil:
            key = f"insider:{pac_incidents[0].get('card_uid','')}"
            if self._fire(key, ts, cooldown=600):
                self._publish_correlation("insider_threat", "CRITICAL",
                    trigger, [DOMAIN_PAC, DOMAIN_DATA],
                    {"pac_incident": pac_incidents[0].get("incident_id",""),
                     "data_incident": data_exfil[0].get("incident_id",""),
                     "detail": "Physical access anomaly followed by data exfiltration — insider threat pattern"},
                    ["revoke_all_access_for_user",
                     "forensic_capture_workstation",
                     "alert_hr_and_legal"])
                self._stats["insider_threat"] += 1

        # ── Rule 4: IoT→Cyber bridge (pivot via IoT) ──────────────────────────
        iot_incidents  = self._recent(DOMAIN_IOT, fast_since,
                                      alert_types=["temperature_behavioral_anomaly",
                                                   "gas_behavioral_anomaly",
                                                   "sensor_dropout"],
                                      min_severity="HIGH")
        lateral_data   = self._recent(DOMAIN_DATA, fast_since,
                                      alert_types=["lateral_movement","unauthorized_vlan"],
                                      min_severity="HIGH")
        if iot_incidents and lateral_data:
            key = "iot_cyber_bridge"
            if self._fire(key, ts, cooldown=300):
                self._publish_correlation("iot_cyber_bridge", "HIGH",
                    trigger, [DOMAIN_IOT, DOMAIN_DATA],
                    {"iot_incident": iot_incidents[0].get("incident_id",""),
                     "data_incident": lateral_data[0].get("incident_id",""),
                     "detail": "IoT sensor anomaly + network lateral movement — attacker may have pivoted from IoT VLAN"},
                    ["isolate_iot_vlan",
                     "check_vlan_acl_rules",
                     "review_network_segmentation"])
                self._stats["iot_cyber_bridge"] += 1

        # ── Rule 5: Physical+Cyber combo ──────────────────────────────────────
        unknown_rfid   = self._recent(DOMAIN_PAC, fast_since,
                                      alert_types=["unknown_card"],
                                      min_severity="HIGH")
        cred_dump      = self._recent(DOMAIN_DATA, fast_since,
                                      alert_types=["credential_dump","suspicious_process"],
                                      min_severity="HIGH")
        if unknown_rfid and cred_dump:
            key = "physical_cyber_combo"
            if self._fire(key, ts, cooldown=300):
                self._publish_correlation("physical_cyber_combo", "CRITICAL",
                    trigger, [DOMAIN_PAC, DOMAIN_DATA],
                    {"pac_incident":  unknown_rfid[0].get("incident_id",""),
                     "data_incident": cred_dump[0].get("incident_id",""),
                     "detail": "Unknown physical access + credential dump — physical breach enabling cyber attack"},
                    ["lock_all_access_points",
                     "kill_suspicious_sessions",
                     "escalate_to_hq_immediately"])
                self._stats["physical_cyber_combo"] += 1

        # ── Rule 6: Kill-chain progression — actor in 3+ stages within SLOW window
        for actor, stage_map in list(self._actor_stages.items()):
            active_stages = {
                stage: [t for t in times if t >= slow_since]
                for stage, times in stage_map.items()
            }
            active_stages = {s: t_list for s, t_list in active_stages.items() if t_list}
            if len(active_stages) < 3:
                continue
            key = f"kill_chain_progression:{actor}"
            if self._fire(key, ts, cooldown=600):
                all_events = sorted(
                    (t, s)
                    for s, t_list in active_stages.items()
                    for t in t_list
                )
                stages_in_order = list(dict.fromkeys(s for _, s in all_events))
                self._publish_correlation("kill_chain_progression", "CRITICAL",
                    trigger, list({trigger.get("network_domain", "")}),
                    {"actor": actor,
                     "stages_observed": list(active_stages.keys()),
                     "stages_in_order": stages_in_order,
                     "stage_count": len(active_stages),
                     "window_sec": SLOW_WIN,
                     "detail": (f"Actor {actor} observed across {len(active_stages)} "
                                f"kill-chain stages — active campaign detected")},
                    ["isolate_actor_immediately",
                     "trace_all_actor_connections",
                     "escalate_to_incident_commander"])
                self._stats["kill_chain_progression"] += 1

    def _fire(self, key: str, ts: float, cooldown: float) -> bool:
        if ts - self._dedup.get(key, 0) < cooldown:
            return False
        self._dedup[key] = ts
        return True

    def _publish_correlation(self, corr_type, severity, trigger,
                              domains, details, actions):
        correlation_id = f"CORR-{uuid.uuid4().hex[:8].upper()}"
        corr = {
            "correlation_id":      correlation_id,
            "correlation_type":    corr_type,
            "severity":            severity,
            "agent_id":            AGENT_ID,
            "created_at":          datetime.now(timezone.utc).isoformat(),
            "domains_involved":    domains,
            "trigger_incident":    trigger.get("incident_id",""),
            "details":             details,
            "recommended_actions": actions,
        }
        self._correlated.append(corr)
        self._stats["correlations_fired"] += 1
        self._producer.publish(Topics.HQ_CORRELATED, corr, key=correlation_id)
        logger.warning(
            f"🧠 CORRELATION [{severity}] [{corr_type}] "
            f"domains={domains} id={correlation_id}")
        # Per-correlation kill-chain entry
        actors = []
        stages = []
        actor = trigger.get("_actor", "")
        if actor and actor != "unknown":
            actors.append(actor)
        stages_from_details = details.get("stages_observed", [])
        if stages_from_details:
            stages = list(stages_from_details)
        else:
            kc_stage = trigger.get("kill_chain_stage", "")
            if kc_stage and kc_stage != "Unknown":
                stages.append(kc_stage)
        self._kill_chain_tracker[correlation_id] = {
            "correlation_id":    correlation_id,
            "correlation_type":  corr_type,
            "actors":            actors,
            "stages_active":     stages,
            "total_stages_ever": len(stages),
            "severity":          severity,
            "status":            "active",
            "created_at":        corr["created_at"],
            "last_updated":      time.time(),
        }

    def _cleanup_kill_chains(self):
        now = time.time()
        for cid, entry in self._kill_chain_tracker.items():
            if entry["status"] == "active" and (now - entry["last_updated"]) > 1800:
                entry["status"] = "stale"
                logger.info(f"Kill-chain {cid} marked stale (30min no activity)")

    def _cleanup_loop(self):
        while True:
            time.sleep(60)
            self._cleanup_kill_chains()

    def _compute_throughput(self) -> dict:
        cutoff = time.time() - 60
        self._throughput_window = [(ts, d) for ts, d in self._throughput_window if ts >= cutoff]
        data_count = sum(1 for _, d in self._throughput_window if d == DOMAIN_DATA)
        iot_count  = sum(1 for _, d in self._throughput_window if d == DOMAIN_IOT)
        pac_count  = sum(1 for _, d in self._throughput_window if d == DOMAIN_PAC)
        return {
            "ndr": round(data_count / 120, 1),
            "edr": round(data_count / 120, 1),
            "iot": round(iot_count / 60, 1),
            "pac": round(pac_count / 60, 1),
        }

    # ── FastAPI ───────────────────────────────────────────────────────────────
    def _build_app(self) -> FastAPI:
        app = FastAPI(title="Analytical Agent")

        @app.get("/health")
        def health():
            active_count   = len([e for e in self._kill_chain_tracker.values() if e["status"] == "active"])
            stale_count    = len([e for e in self._kill_chain_tracker.values() if e["status"] == "stale"])
            resolved_count = len([e for e in self._kill_chain_tracker.values() if e["status"] == "resolved"])
            return JSONResponse({
                "agent_id":         AGENT_ID, "status": "running",
                "timestamp":        datetime.now(timezone.utc).isoformat(),
                "stats":            self._stats,
                "incidents_by_domain": {
                    d: len(list(q)) for d, q in self._by_domain.items()},
                "kill_chain_tracker": self._kill_chain_tracker,
                "kill_chain_summary": {
                    "active":   active_count,
                    "stale":    stale_count,
                    "resolved": resolved_count,
                },
                "kafka_throughput":    self._compute_throughput(),
                "enhanced_logging":    self._enhanced_logging,
                "enhanced_capture":    self._enhanced_capture,
            })

        @app.get("/correlations")
        def correlations(limit: int = 20):
            return JSONResponse(self._correlated[-limit:])

        @app.get("/incidents")
        def incidents(limit: int = 50):
            return JSONResponse(list(self._incidents)[-limit:])

        @app.get("/capture_buffer")
        def capture_buffer():
            return JSONResponse({
                "capturing":   self._enhanced_capture,
                "buffer_size": len(self._capture_buffer),
                "events":      self._capture_buffer[-20:],
            })

        return app

    def start(self):
        threading.Thread(target=self._consumer.poll_loop,
                         args=(self.handle_incident,),
                         daemon=True, name="analytical-consumer").start()
        threading.Thread(target=self._cleanup_loop,
                         daemon=True, name="kc-cleanup").start()
        logger.info(f"▶️  Analytical Agent running — health :{HEALTH_PORT}/health")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        self._consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    a = AnalyticalAgent()
    try:
        a.start()
    except KeyboardInterrupt:
        a.stop()
