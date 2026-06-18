"""
agents/data_network/ndr_agent/main.py
Phase 3 Week 6 — Network Detection & Response Agent (NDR)

Detects network-layer attacks from flow/event records.

Original detections (unchanged):
  1. port_scan          — >20 unique dst_ports from same src_ip in 60s        (T1046)
  2. brute_force_ssh    — >10 failed SSH from same src_ip in 60s              (T1110)
  3. brute_force_http   — >15 failed HTTP 401/403 from same src_ip in 60s    (T1110)
  4. data_exfiltration  — single flow > 50 MB to external IP                  (T1048)
  5. lateral_movement   — src_ip crosses 3+ internal VLANs in 120s           (T1021)
  6. c2_beacon          — periodic small flows to same external IP >5 in 5min (T1071)
  7. unauthorized_vlan  — traffic between VLANs that should be isolated       (T1599)

New detections:
  8.  slow_port_scan        — 100+ unique ports over 24hrs                    (T1046) [P2.3]
  9a. immovable_violation   — traffic violates hardcoded role policy           (T1036) [P2.4]
  9b. behavioral_anomaly    — scored deviation from adaptive baseline          (T1036) [P2.4]
  9c. baseline_drift        — adaptive baseline shifting too fast              (T1036) [P2.4]
  10. radius_brute_force    — 5+ failed 802.1X auth in 60s                   (T1110.001) [P2.6]
  11. isolation_violation   — traffic from isolated IP >10s after block        (T1562) [P2.2]

UEBA Architecture — Three-Wall Design:
  Wall 1 — Immovable baseline: derived from network policy + ACL rules.
            Never modified by traffic. Violations = immediate alert.
  Wall 2 — Adaptive baseline: slow-moving EMA refined by traffic.
            Protected by quarantine (3 days + 5% volume + canary clearance).
            Violations = scored alert.
  Wall 3 — Canary baseline: copy of immovable, never changes.
            Hourly divergence check against adaptive baseline.
            Divergence = freeze adaptive + CRITICAL alert + rollback.

New capabilities:
  - Heartbeat publishing every 25s with SHA-256 code integrity hash           (P1.2)
  - Threshold hot-update from learning agent via soar.commands                (P1.4)

Consumes: data.telemetry, soar.commands
Publishes: data.alerts, agents.heartbeats
Health:    GET /health /alerts /baseline (port 8004)

Standards: NIST SP 800-94, NIST SP 800-61 Rev2
           MITRE ATT&CK T1046, T1048, T1110, T1021, T1071, T1599, T1036, T1562
"""
from __future__ import annotations
import hashlib, logging, os, random as _rand, statistics, sys, threading, time, uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
CAIRO = ZoneInfo("Africa/Cairo")
from ipaddress import ip_address, ip_network
from typing import Dict, List, Optional, Set, Tuple
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from common.kafka_client import KafkaConsumerClient, KafkaProducerClient, Topics
from common.models import Alert, SeverityLevel

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("ndr_agent")

AGENT_ID    = os.getenv("AGENT_ID",        "ndr-agent-01")
BOOTSTRAP   = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
HEALTH_PORT = int(os.getenv("HEALTH_PORT", "8004"))

# ── Signature detection thresholds — mutable via soar.commands (P1.4) ─────────
_PORT_SCAN_BASE     = int(os.getenv("PORT_SCAN_THRESHOLD", "20"))
PORT_SCAN_THRESHOLD = _PORT_SCAN_BASE + _rand.randint(-4, 4)
PORT_SCAN_WINDOW       = int(os.getenv("PORT_SCAN_WINDOW_SEC",   "60"))
_BRUTE_SSH_BASE     = int(os.getenv("BRUTE_SSH_THRESHOLD", "10"))
BRUTE_SSH_THRESHOLD = _BRUTE_SSH_BASE + _rand.randint(-2, 2)
BRUTE_HTTP_THRESHOLD   = int(os.getenv("BRUTE_HTTP_THRESHOLD",   "15"))
BRUTE_WINDOW           = int(os.getenv("BRUTE_WINDOW_SEC",       "60"))
EXFIL_THRESHOLD_MB     = float(os.getenv("EXFIL_THRESHOLD_MB",   "50.0"))
LATERAL_VLAN_THRESHOLD = int(os.getenv("LATERAL_VLAN_THRESHOLD", "3"))
LATERAL_WINDOW         = int(os.getenv("LATERAL_WINDOW_SEC",     "120"))
C2_BEACON_THRESHOLD    = int(os.getenv("C2_BEACON_THRESHOLD",    "5"))
C2_BEACON_WINDOW       = int(os.getenv("C2_BEACON_WINDOW_SEC",   "300"))
SLOW_SCAN_THRESHOLD    = int(os.getenv("SLOW_SCAN_THRESHOLD",    "100"))
SLOW_SCAN_WINDOW       = int(os.getenv("SLOW_SCAN_WINDOW_SEC",   "86400"))
RADIUS_FAIL_THRESHOLD  = int(os.getenv("RADIUS_FAIL_THRESHOLD",  "5"))
RADIUS_WINDOW          = int(os.getenv("RADIUS_WINDOW_SEC",      "60"))
ISOLATION_GRACE        = int(os.getenv("ISOLATION_GRACE_SEC",    "10"))
HEARTBEAT_INTERVAL     = int(os.getenv("HEARTBEAT_INTERVAL_SEC", "25"))
AFTER_HOURS_START    = int(os.getenv("AFTER_HOURS_START", "0"))
AFTER_HOURS_END      = int(os.getenv("AFTER_HOURS_END", "6"))
DNS_TUNNEL_THRESHOLD = int(os.getenv("DNS_TUNNEL_THRESHOLD", "20"))
DNS_TUNNEL_WINDOW    = int(os.getenv("DNS_TUNNEL_WINDOW_SEC", "60"))
LEGIT_DNS_SERVERS    = {"192.168.60.13"}  # Pi-hole only

# ── UEBA constants ─────────────────────────────────────────────────────────────
# Quarantine: how many distinct calendar days a behavior must appear before
# graduating into the adaptive baseline
QUARANTINE_MIN_DAYS    = int(os.getenv("QUARANTINE_MIN_DAYS",    "3"))
# Quarantine: behavior must appear in at least this % of flows to be considered normal
QUARANTINE_MIN_PCT     = float(os.getenv("QUARANTINE_MIN_PCT",   "5.0"))
# Quarantine window: observations older than this expire from quarantine
QUARANTINE_WINDOW_DAYS = int(os.getenv("QUARANTINE_WINDOW_DAYS", "14"))
# EMA weight for new observations (0.1 = new data counts 10%, history counts 90%)
EMA_ALPHA              = float(os.getenv("EMA_ALPHA",             "0.10"))
# Canary divergence: if adaptive baseline diverges from canary by this %, alert
CANARY_DIVERGE_PCT     = float(os.getenv("CANARY_DIVERGE_PCT",   "50.0"))
# Canary check interval in seconds
CANARY_CHECK_INTERVAL  = int(os.getenv("CANARY_CHECK_INTERVAL",  "3600"))  # 1 hour
# Anomaly score thresholds
ANOMALY_MEDIUM         = int(os.getenv("ANOMALY_SCORE_MEDIUM",   "50"))
ANOMALY_HIGH           = int(os.getenv("ANOMALY_SCORE_HIGH",     "80"))

# ── Wall 1 — Immovable role baselines (derived from network policy + ACL) ──────
# These never change. Traffic cannot modify them.
# Fields per role:
#   allowed_ports     — ports the ACL permits for this role
#   allowed_hours     — hours the physical space is accessible (UTC)
#   allowed_days      — weekdays allowed (0=Monday 6=Sunday)
#   internal_only     — True = device should NEVER talk to external internet
#   max_bytes_per_flow — hard ceiling — anything above is always suspicious
#   max_flows_per_min  — hard ceiling — anything above is always suspicious
IMMOVABLE_BASELINES: Dict[str, dict] = {
    # Student lab — VLAN 10
    "192.168.10.": {
        "allowed_ports":      {9092, 53, 443, 80, 22, 8004, 8005, 8080,
                               3000, 5000, 8000, 8888, 3306, 5432},
        "allowed_hours":      set(range(8, 24)),        # 8am–midnight
        "allowed_days":       set(range(0, 7)),         # all week — students work weekends
        "internal_only":      False,                    # can reach internet
        "max_bytes_per_flow": 200 * 1024 * 1024,        # 200 MB
        "max_flows_per_min":  300,
    },
    # Staff — VLAN 15
    "192.168.15.": {
        "allowed_ports":      {9092, 53, 443, 80, 22, 389, 636, 25, 587, 993},
        "allowed_hours":      set(range(7, 22)),        # 7am–10pm
        "allowed_days":       set(range(0, 6)),         # Mon–Sat
        "internal_only":      False,
        "max_bytes_per_flow": 100 * 1024 * 1024,        # 100 MB
        "max_flows_per_min":  150,
    },
    # HQ — VLAN 12
    "192.168.12.": {
        "allowed_ports":      {9092, 53, 443, 80, 22, 8006, 8007, 8008},
        "allowed_hours":      set(range(8, 22)),
        "allowed_days":       set(range(0, 6)),
        "internal_only":      False,
        "max_bytes_per_flow": 50 * 1024 * 1024,
        "max_flows_per_min":  200,
    },
    # IoT sensors — VLAN 20
    "192.168.20.": {
        "allowed_ports":      {1883},                   # MQTT only
        "allowed_hours":      set(range(0, 24)),        # always on
        "allowed_days":       set(range(0, 7)),
        "internal_only":      True,                     # never external
        "max_bytes_per_flow": 2 * 1024,                 # 2 KB — sensor readings are tiny
        "max_flows_per_min":  20,
    },
    # Physical access — VLAN 31
    "192.168.31.": {
        "allowed_ports":      {9092, 389},              # Kafka + LDAP
        "allowed_hours":      set(range(0, 24)),
        "allowed_days":       set(range(0, 7)),
        "internal_only":      True,
        "max_bytes_per_flow": 50 * 1024,                # 50 KB
        "max_flows_per_min":  10,
    },
    # SOC / Local Manager — VLAN 40
    "192.168.40.": {
        "allowed_ports":      {9092, 53, 443, 80, 22, 8010, 8011, 8012},
        "allowed_hours":      set(range(0, 24)),
        "allowed_days":       set(range(0, 7)),
        "internal_only":      False,
        "max_bytes_per_flow": 100 * 1024 * 1024,
        "max_flows_per_min":  200,
    },
    # Server room — VLAN 60
    "192.168.60.": {
        "allowed_ports":      set(range(1, 65536)),     # servers use everything
        "allowed_hours":      set(range(0, 24)),
        "allowed_days":       set(range(0, 7)),
        "internal_only":      False,
        "max_bytes_per_flow": float("inf"),             # no limit
        "max_flows_per_min":  float("inf"),
    },
    # Visitors — VLAN 70
    "192.168.70.": {
        "allowed_ports":      {80, 443, 53},            # internet browsing only
        "allowed_hours":      set(range(9, 18)),        # 9am–6pm
        "allowed_days":       set(range(0, 5)),         # Mon–Fri only
        "internal_only":      False,
        "max_bytes_per_flow": 50 * 1024 * 1024,
        "max_flows_per_min":  100,
    },
}

# Simulator ranges — same policy as real ranges for compatibility
IMMOVABLE_BASELINES["10.0.10."] = IMMOVABLE_BASELINES["192.168.10."]
IMMOVABLE_BASELINES["10.0.15."] = IMMOVABLE_BASELINES["192.168.15."]
IMMOVABLE_BASELINES["10.0.20."] = IMMOVABLE_BASELINES["192.168.20."]
IMMOVABLE_BASELINES["10.0.30."] = IMMOVABLE_BASELINES["192.168.31."]
IMMOVABLE_BASELINES["10.0.60."] = IMMOVABLE_BASELINES["192.168.60."]
IMMOVABLE_BASELINES["10.0.70."] = IMMOVABLE_BASELINES["192.168.70."]

# Default — unknown role — strictest possible profile
IMMOVABLE_DEFAULT: dict = {
    "allowed_ports":      {80, 443, 53},
    "allowed_hours":      set(range(8, 18)),
    "allowed_days":       set(range(0, 5)),
    "internal_only":      False,
    "max_bytes_per_flow": 10 * 1024 * 1024,
    "max_flows_per_min":  50,
}

# Campus internal network ranges
INTERNAL_NETWORKS = [
    ip_network("192.168.10.0/24"), ip_network("192.168.12.0/24"),
    ip_network("192.168.15.0/24"), ip_network("192.168.20.0/24"),
    ip_network("192.168.31.0/24"), ip_network("192.168.40.0/24"),
    ip_network("192.168.60.0/24"), ip_network("192.168.70.0/24"),
    ip_network("10.0.10.0/24"),    ip_network("10.0.11.0/24"),
    ip_network("10.0.12.0/24"),    ip_network("10.0.15.0/24"),
    ip_network("10.0.20.0/24"),    ip_network("10.0.30.0/24"),
    ip_network("10.0.50.0/24"),    ip_network("10.0.60.0/24"),
    ip_network("10.0.70.0/24"),
]

ISOLATED_VLAN_PAIRS = {
    ("192.168.10.0/24", "192.168.20.0/24"),
    ("192.168.10.0/24", "192.168.31.0/24"),
    ("192.168.15.0/24", "192.168.20.0/24"),
    ("192.168.15.0/24", "192.168.31.0/24"),
    ("192.168.20.0/24", "192.168.60.0/24"),
    ("192.168.99.0/24", "192.168.60.0/24"),
    ("192.168.20.0/24", "192.168.15.0/24"),
    ("192.168.31.0/24", "192.168.60.0/24"),
    ("10.0.20.0/24",    "10.0.60.0/24"),
    ("10.0.70.0/24",    "10.0.60.0/24"),
    ("10.0.20.0/24",    "10.0.15.0/24"),
    ("10.0.30.0/24",    "10.0.60.0/24"),
}

MITRE = {
    "port_scan":            "T1046",
    "brute_force_ssh":      "T1110",
    "brute_force_http":     "T1110",
    "data_exfiltration":    "T1048",
    "lateral_movement":     "T1021",
    "c2_beacon":            "T1071",
    "unauthorized_vlan":    "T1599",
    "slow_port_scan":       "T1046",
    "immovable_violation":  "T1036",
    "behavioral_anomaly":   "T1036",
    "baseline_drift":       "T1036",
    "radius_brute_force":   "T1110.001",
    "isolation_violation":  "T1562",
    "after_hours_activity": "T1036",
    "dns_tunneling":        "T1071.004",
}


def _is_internal(ip_str: str) -> bool:
    try:
        ip = ip_address(ip_str)
        return any(ip in net for net in INTERNAL_NETWORKS)
    except ValueError:
        return False


def _vlan_subnet(ip_str: str) -> Optional[str]:
    try:
        ip = ip_address(ip_str)
        for net in INTERNAL_NETWORKS:
            if ip in net:
                return str(net)
    except ValueError:
        pass
    return None


def _get_role(ip_str: str) -> dict:
    """Return the immovable baseline for this IP's role based on subnet prefix."""
    for prefix, role in IMMOVABLE_BASELINES.items():
        if ip_str.startswith(prefix):
            return role
    return IMMOVABLE_DEFAULT


class NdrAgent:
    def __init__(self):
        logger.info(f"🚀 Starting NDR Agent {AGENT_ID}")

        # ── Original detection state ──────────────────────────────────────────
        self._port_scans: Dict[str, deque] = defaultdict(lambda: deque(maxlen=500))
        self._ssh_fails:  Dict[str, deque] = defaultdict(lambda: deque(maxlen=200))
        self._http_fails: Dict[str, deque] = defaultdict(lambda: deque(maxlen=200))
        self._vlan_hops:  Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
        self._c2_beacons: Dict[str, deque] = defaultdict(lambda: deque(maxlen=50))
        self._after_hours: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
        self._dns_queries: Dict[str, deque] = defaultdict(lambda: deque(maxlen=500))
        self._last_alert: Dict[str, float] = {}

        # ── P2.3 — Slow scan ──────────────────────────────────────────────────
        self._daily_scans: Dict[str, dict] = {}

        # ── P2.6 — RADIUS ─────────────────────────────────────────────────────
        self._radius_fails: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))

        # ── P2.2 — Isolation tracking ─────────────────────────────────────────
        self._isolated_ips: Dict[str, float] = {}

        # ── P2.4 — UEBA: Three-Wall Baseline System ───────────────────────────

        # Wall 2 — Adaptive baseline per device
        # Starts as a copy of the immovable role baseline.
        # Slowly refined by EMA as real traffic is observed.
        # {ip: {
        #    "avg_bytes_per_flow": float,  EMA of bytes per flow
        #    "avg_flows_per_min":  float,  EMA of flows per minute
        #    "port_counts":        {port: int},  how many times each port seen
        #    "total_flows":        int,    total flows seen — for % calculation
        #    "active_slots":       {(weekday, hour): int},  slot → count
        #    "established_at":     str,
        #    "last_updated":       float,
        #    "frozen":             bool,   True = canary detected poisoning
        # }}
        self._adaptive: Dict[str, dict] = {}

        # Quarantine buffer — behaviors waiting to graduate
        # {ip: {port: {"days_seen": set(), "total_count": int, "first_seen": float}}}
        self._quarantine: Dict[str, dict] = defaultdict(dict)

        # Per-device flow rate tracking for flows-per-minute EMA
        # {ip: {"count": int, "window_start": float}}
        self._flow_rate: Dict[str, dict] = {}

        # Wall 3 — Canary baseline — fixed copy of immovable, used for divergence check
        # {ip: snapshot of adaptive at initialization time}
        self._canary: Dict[str, dict] = {}

        # Rollback snapshots — saved every 24h
        # {ip: [snapshot, snapshot, ...]} — max 7 kept
        self._snapshots: Dict[str, list] = defaultdict(list)
        self._last_snapshot: Dict[str, float] = {}

        # Last canary check timestamp
        self._last_canary_check: float = time.time()

        # ── P1.2 — Code hash ──────────────────────────────────────────────────
        self._code_hash = self._compute_code_hash()

        # ── Kafka ─────────────────────────────────────────────────────────────
        self._producer    = KafkaProducerClient(BOOTSTRAP)
        self._consumer    = KafkaConsumerClient(AGENT_ID, [Topics.DATA_TELEMETRY], BOOTSTRAP)
        self._cmd_consumer = KafkaConsumerClient(
            f"{AGENT_ID}-cmd", [Topics.SOAR_COMMANDS], BOOTSTRAP
        )

        self._recent_alerts: deque = deque(maxlen=200)
        self._stats = {
            "flows_processed": 0, "alerts_sent": 0,
            **{k: 0 for k in MITRE},
        }
        self._app = self._build_app()
        logger.info(f"✅ NDR Agent ready — code_hash={self._code_hash[:12]}...")

    # ── P1.2 — Code hash ─────────────────────────────────────────────────────
    def _compute_code_hash(self) -> str:
        try:
            return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        except Exception:
            return "unavailable"

    # ── P1.2 — Heartbeat ──────────────────────────────────────────────────────
    def _heartbeat_loop(self):
        while True:
            try:
                self._producer.publish(Topics.HEARTBEATS, {
                    "agent_id":   AGENT_ID,
                    "agent_type": "ndr",
                    "status":     "running",
                    "timestamp":  datetime.now(CAIRO).isoformat(),
                    "code_hash":  self._code_hash,
                    "stats":      dict(self._stats),
                }, key=AGENT_ID)
            except Exception as e:
                logger.error(f"Heartbeat failed: {e}")
            time.sleep(HEARTBEAT_INTERVAL)

    # ── P1.4 — soar.commands consumer ────────────────────────────────────────
    def handle_command(self, topic: str, payload: dict):
        action = payload.get("action", "")
        target = payload.get("target_agent", "")
        if action == "update_thresholds" and target in ("ndr_agent", "ndr-agent"):
            self._apply_threshold_updates(payload.get("recommendations", {}))
        elif action in ("block_src_ip", "block_attacker_ip", "isolate_host"):
            ip = payload.get("target", "")
            if ip:
                self._isolated_ips[ip] = time.time()
                logger.info(f"🔒 Recorded isolation: {ip}")

    def _apply_threshold_updates(self, recs: dict):
        global PORT_SCAN_THRESHOLD, BRUTE_SSH_THRESHOLD, BRUTE_HTTP_THRESHOLD
        global EXFIL_THRESHOLD_MB, C2_BEACON_THRESHOLD, SLOW_SCAN_THRESHOLD
        updated = []
        if "port_scan_threshold"  in recs:
            PORT_SCAN_THRESHOLD   = int(recs["port_scan_threshold"]);   updated.append(f"port_scan={PORT_SCAN_THRESHOLD}")
        if "brute_ssh_threshold"  in recs:
            BRUTE_SSH_THRESHOLD   = int(recs["brute_ssh_threshold"]);   updated.append(f"brute_ssh={BRUTE_SSH_THRESHOLD}")
        if "brute_http_threshold" in recs:
            BRUTE_HTTP_THRESHOLD  = int(recs["brute_http_threshold"]);  updated.append(f"brute_http={BRUTE_HTTP_THRESHOLD}")
        if "exfil_threshold_mb"   in recs:
            EXFIL_THRESHOLD_MB    = float(recs["exfil_threshold_mb"]);  updated.append(f"exfil_mb={EXFIL_THRESHOLD_MB}")
        if "c2_beacon_threshold"  in recs:
            C2_BEACON_THRESHOLD   = int(recs["c2_beacon_threshold"]);   updated.append(f"c2={C2_BEACON_THRESHOLD}")
        if "slow_scan_threshold"  in recs:
            SLOW_SCAN_THRESHOLD   = int(recs["slow_scan_threshold"]);   updated.append(f"slow_scan={SLOW_SCAN_THRESHOLD}")
        if "anomaly_score_medium" in recs:
            global ANOMALY_MEDIUM
            ANOMALY_MEDIUM = int(recs["anomaly_score_medium"])
            updated.append(f"anomaly_medium={ANOMALY_MEDIUM}")
        if "anomaly_score_high" in recs:
            global ANOMALY_HIGH
            ANOMALY_HIGH = int(recs["anomaly_score_high"])
            updated.append(f"anomaly_high={ANOMALY_HIGH}")
        if updated:
            logger.warning(f"🔧 Thresholds updated: {', '.join(updated)}")

    # ── Main flow handler ─────────────────────────────────────────────────────
    def handle_flow(self, topic: str, payload: dict):
        self._stats["flows_processed"] += 1
        src_ip     = payload.get("src_ip", "")
        dst_ip     = payload.get("dst_ip", "")
        dst_port   = int(payload.get("dst_port", 0))
        proto      = payload.get("proto", "").lower()
        status     = payload.get("status", "")
        bytes_out  = float(payload.get("bytes_out", 0))
        event_type = payload.get("event_type", "flow").lower()
        ts         = time.time()

        # Skip infrastructure IPs — VM1, VM2, VM3
        if src_ip in {"192.168.60.10", "192.168.60.11", "192.168.60.13"}:
            return

        # P2.2 — Isolation violation (highest priority)
        if src_ip:
            self._check_isolation_violation(src_ip, ts, payload)

        # Original detections
        self._check_port_scan(src_ip, dst_ip, dst_port, ts, payload)
        self._check_brute_force(src_ip, dst_port, proto, status, ts, payload)
        self._check_exfiltration(src_ip, dst_ip, bytes_out, ts, payload)
        self._check_lateral_movement(src_ip, dst_ip, ts, payload)
        self._check_c2_beacon(src_ip, dst_ip, bytes_out, ts, payload)
        self._check_unauthorized_vlan(src_ip, dst_ip, ts, payload)
        self._check_after_hours(src_ip, dst_ip, dst_port, ts, payload)
        self._check_dns_tunneling(src_ip, dst_ip, dst_port, ts, payload)

        # New detections
        if src_ip and dst_port:
            self._check_slow_scan(src_ip, dst_port, ts, payload)

        if src_ip:
            # P2.4 — UEBA: Wall 1 first, then Wall 2
            self._check_immovable(src_ip, dst_ip, dst_port, bytes_out, ts, payload)
            self._update_adaptive(src_ip, dst_port, bytes_out, ts)
            self._check_behavioral_anomaly(src_ip, dst_port, bytes_out, ts, payload)

            # Wall 3 — Canary check every hour
            if ts - self._last_canary_check >= CANARY_CHECK_INTERVAL:
                self._last_canary_check = ts
                self._run_canary_check(ts)

        if event_type == "radius_auth":
            self._check_radius_brute(src_ip, status, ts, payload)

    # =========================================================================
    # ── P2.4 — UEBA: WALL 1 — Immovable baseline check ───────────────────────
    # =========================================================================
    def _check_immovable(
        self, src_ip: str, dst_ip: str, dst_port: int,
        bytes_out: float, ts: float, payload: dict
    ):
        """
        Check traffic against the hardcoded role policy.
        Any violation fires immediately — no scoring, no thresholds.
        This wall cannot be corrupted by traffic.
        """
        role = _get_role(src_ip)
        now  = datetime.fromtimestamp(ts, tz=timezone.utc)
        hour = now.hour
        day  = now.weekday()   # 0=Monday, 6=Sunday

        violations = []

        # Check 1: Port not in allowed set
        if dst_port and dst_port not in role["allowed_ports"]:
            violations.append(f"forbidden_port:{dst_port}")

        # Check 2: Hour outside allowed window
        if hour not in role["allowed_hours"]:
            violations.append(f"outside_hours:{hour}:00")

        # Check 3: Day not allowed
        if day not in role["allowed_days"]:
            day_names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
            violations.append(f"outside_days:{day_names[day]}")

        # Check 4: Internal-only device talking to external
        if role["internal_only"] and dst_ip and not _is_internal(dst_ip):
            violations.append(f"external_destination:{dst_ip}")

        # Check 5: Flow size exceeds hard ceiling
        max_bytes = role["max_bytes_per_flow"]
        if max_bytes != float("inf") and bytes_out > max_bytes:
            violations.append(
                f"flow_size_exceeded:{bytes_out/1024/1024:.1f}MB>"
                f"{max_bytes/1024/1024:.0f}MB"
            )

        if violations:
            if self._dedup(f"immovable:{src_ip}:{violations[0]}", ts, cooldown=60):
                self._alert(payload, "immovable_violation", SeverityLevel.HIGH, 0.97,
                    {"src_ip":     src_ip,
                     "violations": violations,
                     "role":       next(
                         (p for p in IMMOVABLE_BASELINES if src_ip.startswith(p)),
                         "unknown"
                     ),
                     "detail": (
                         f"Traffic from {src_ip} violates hardcoded role policy: "
                         f"{', '.join(violations)}"
                     )},
                    ["block_src_ip", "investigate_device",
                     "notify_data_local_manager", "escalate_to_hq_immediately"])
                self._stats["immovable_violation"] += 1

    # =========================================================================
    # ── P2.4 — UEBA: WALL 2 — Adaptive baseline update ───────────────────────
    # =========================================================================
    def _get_or_init_adaptive(self, ip: str) -> dict:
        """
        Initialize adaptive baseline from role policy if not yet seen.
        This means detection works from the very first flow.
        """
        if ip not in self._adaptive:
            role = _get_role(ip)
            baseline = {
                "avg_bytes_per_flow": 1200.0,     # reasonable campus default
                "avg_flows_per_min":  10.0,
                "port_counts":        {p: 10 for p in role["allowed_ports"]
                                       if p != set(range(1, 65536))},
                "total_flows":        len(role["allowed_ports"]) * 10,
                "active_slots":       {},          # (weekday, hour) → count
                "established_at":     datetime.now(CAIRO).isoformat(),
                "last_updated":       time.time(),
                "frozen":             False,
            }
            self._adaptive[ip] = baseline
            # Initialize canary as exact copy — never modified after this
            self._canary[ip] = {
                "avg_bytes_per_flow": baseline["avg_bytes_per_flow"],
                "avg_flows_per_min":  baseline["avg_flows_per_min"],
                "port_counts":        dict(baseline["port_counts"]),
                "total_flows":        baseline["total_flows"],
            }
            logger.info(f"📊 Adaptive baseline initialized [{ip}] from role policy")
        return self._adaptive[ip]

    def _update_adaptive(self, ip: str, dst_port: int, bytes_out: float, ts: float):
        """
        Update the adaptive baseline using EMA.
        New observation counts for EMA_ALPHA (10%), history counts for 90%.

        Port learning uses quarantine:
          - Port goes to quarantine buffer first
          - Must appear on 3+ separate calendar days within 14 days
          - Must appear in 5%+ of total flows
          - Canary must not be in alert state
          Only then does it graduate into port_counts.

        Entries older than QUARANTINE_WINDOW_DAYS expire from quarantine.
        """
        baseline = self._get_or_init_adaptive(ip)

        if baseline["frozen"]:
            return   # Canary detected poisoning — no learning until cleared

        now = datetime.fromtimestamp(ts, tz=timezone.utc)
        today = now.date().isoformat()
        slot  = (now.weekday(), now.hour)

        # EMA update — bytes per flow
        if bytes_out > 0:
            baseline["avg_bytes_per_flow"] = (
                (1 - EMA_ALPHA) * baseline["avg_bytes_per_flow"] +
                EMA_ALPHA * bytes_out
            )

        # Flow rate tracking — flows per minute
        if ip not in self._flow_rate:
            self._flow_rate[ip] = {"count": 0, "window_start": ts}
        fr = self._flow_rate[ip]
        fr["count"] += 1
        elapsed = ts - fr["window_start"]
        if elapsed >= 60:
            fpm = fr["count"] / (elapsed / 60)
            baseline["avg_flows_per_min"] = (
                (1 - EMA_ALPHA) * baseline["avg_flows_per_min"] +
                EMA_ALPHA * fpm
            )
            fr["count"] = 0
            fr["window_start"] = ts

        # Active slot tracking — (weekday, hour)
        baseline["active_slots"][slot] = baseline["active_slots"].get(slot, 0) + 1
        baseline["total_flows"] += 1
        baseline["last_updated"] = ts

        # Port quarantine logic
        if dst_port:
            self._quarantine_port(ip, dst_port, today, ts, baseline)

        # Daily snapshot for rollback (Wall 3 support)
        self._maybe_save_snapshot(ip, ts)

    def _quarantine_port(
        self, ip: str, port: int, today: str, ts: float, baseline: dict
    ):
        """
        Quarantine a port observation. Graduate to adaptive baseline only when:
          1. Seen on 3+ separate calendar days
          2. Appears in 5%+ of total flows
          3. Adaptive baseline is not frozen (canary clearance)
        Entries expire after QUARANTINE_WINDOW_DAYS.
        """
        q = self._quarantine[ip]

        if port not in q:
            q[port] = {"days_seen": set(), "total_count": 0, "first_seen": ts}

        entry = q[port]
        entry["days_seen"].add(today)
        entry["total_count"] += 1

        # Expire old quarantine entries
        cutoff_ts = ts - (QUARANTINE_WINDOW_DAYS * 86400)
        if entry["first_seen"] < cutoff_ts:
            del q[port]
            return

        # Check graduation conditions
        total_flows   = max(baseline["total_flows"], 1)
        pct           = (entry["total_count"] / total_flows) * 100
        days_count    = len(entry["days_seen"])
        canary_clear  = not baseline["frozen"]

        if (days_count  >= QUARANTINE_MIN_DAYS and
                pct     >= QUARANTINE_MIN_PCT   and
                canary_clear):
            # Graduate — port is now considered normal for this device
            baseline["port_counts"][port] = entry["total_count"]
            del q[port]
            logger.info(
                f"🎓 Port {port} graduated to adaptive baseline [{ip}] "
                f"({days_count} days, {pct:.1f}% of flows)"
            )

    def _maybe_save_snapshot(self, ip: str, ts: float):
        """Save a rollback snapshot every 24 hours. Keep last 7."""
        last = self._last_snapshot.get(ip, 0)
        if ts - last < 86400:
            return
        self._last_snapshot[ip] = ts
        b = self._adaptive.get(ip, {})
        snapshot = {
            "saved_at":           datetime.now(CAIRO).isoformat(),
            "avg_bytes_per_flow": b.get("avg_bytes_per_flow", 0),
            "avg_flows_per_min":  b.get("avg_flows_per_min", 0),
            "port_counts":        dict(b.get("port_counts", {})),
            "total_flows":        b.get("total_flows", 0),
        }
        snaps = self._snapshots[ip]
        snaps.append(snapshot)
        if len(snaps) > 7:
            snaps.pop(0)
        logger.info(f"💾 Snapshot saved [{ip}] ({len(snaps)} total)")

    # =========================================================================
    # ── P2.4 — UEBA: WALL 2 — Behavioral anomaly scoring ─────────────────────
    # =========================================================================
    def _check_behavioral_anomaly(
        self, ip: str, dst_port: int, bytes_out: float, ts: float, payload: dict
    ):
        """
        Score incoming flow against the adaptive baseline across 5 dimensions.
        Score thresholds:
          < ANOMALY_MEDIUM  — no alert, passive signal to risk engine
          ANOMALY_MEDIUM-79 — behavioral_anomaly MEDIUM
          >= ANOMALY_HIGH   — behavioral_anomaly HIGH
        """
        baseline = self._adaptive.get(ip)
        if not baseline:
            return

        now          = datetime.fromtimestamp(ts, tz=timezone.utc)
        slot         = (now.weekday(), now.hour)
        score        = 0
        score_detail = []

        # Dimension 1 — Port not in adaptive learned set
        port_counts  = baseline.get("port_counts", {})
        total_flows  = max(baseline.get("total_flows", 1), 1)
        if dst_port and dst_port not in port_counts:
            score += 40
            score_detail.append(f"unknown_port:{dst_port}(+40)")

        # Dimension 2 — Bytes per flow deviation (z-score approximation)
        avg_bytes = baseline.get("avg_bytes_per_flow", 1200)
        if avg_bytes > 0 and bytes_out > 0:
            ratio = bytes_out / avg_bytes
            if ratio > 10:
                pts = min(80, int(30 * (ratio / 10)))
                score += pts
                score_detail.append(f"volume_extreme:{ratio:.1f}x(+{pts})")
            elif ratio > 3:
                pts = 20 + int(10 * (ratio - 3))
                score += pts
                score_detail.append(f"volume_high:{ratio:.1f}x(+{pts})")

        # Dimension 3 — Flow rate deviation
        avg_fpm = baseline.get("avg_flows_per_min", 10)
        if ip in self._flow_rate and avg_fpm > 0:
            current_fpm = self._flow_rate[ip].get("count", 0)
            ratio_fpm   = current_fpm / max(avg_fpm, 1)
            if ratio_fpm > 5:
                score += 55
                score_detail.append(f"flow_rate_extreme:{ratio_fpm:.1f}x(+55)")
            elif ratio_fpm > 2:
                score += 30
                score_detail.append(f"flow_rate_high:{ratio_fpm:.1f}x(+30)")

        # Dimension 4 — Time slot (weekday + hour) not in learned active slots
        active_slots = baseline.get("active_slots", {})
        if active_slots and slot not in active_slots:
            score += 40
            day_names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
            score_detail.append(
                f"unknown_slot:{day_names[slot[0]]}-{slot[1]:02d}:00(+40)"
            )
        elif active_slots:
            # Slot seen before but rarely — partial score
            slot_count = active_slots.get(slot, 0)
            slot_pct   = (slot_count / total_flows) * 100
            if slot_pct < 1.0:
                score += 25
                score_detail.append(f"rare_slot:{slot_pct:.1f}%(+25)")

        # Dimension 5 — Port frequency unusually low (port seen but very rarely)
        if dst_port and dst_port in port_counts:
            port_pct = (port_counts[dst_port] / total_flows) * 100
            if port_pct < 0.5:
                score += 20
                score_detail.append(f"rare_port:{dst_port}:{port_pct:.1f}%(+20)")

        # Fire alert based on score
        if score >= ANOMALY_HIGH:
            if self._dedup(f"behavioral_high:{ip}", ts, cooldown=300):
                self._alert(payload, "behavioral_anomaly", SeverityLevel.HIGH, 0.85,
                    {"src_ip":       ip,
                     "anomaly_score": score,
                     "dimensions":   score_detail,
                     "detail": (
                         f"Behavior significantly deviates from learned baseline. "
                         f"Score {score}/{ANOMALY_HIGH} — {', '.join(score_detail)}"
                     )},
                    ["increase_monitoring", "flag_for_review",
                     "notify_data_local_manager"])
                self._stats["behavioral_anomaly"] += 1

        elif score >= ANOMALY_MEDIUM:
            if self._dedup(f"behavioral_med:{ip}", ts, cooldown=600):
                self._alert(payload, "behavioral_anomaly", SeverityLevel.MEDIUM, 0.72,
                    {"src_ip":       ip,
                     "anomaly_score": score,
                     "dimensions":   score_detail,
                     "detail": (
                         f"Moderate behavioral deviation. "
                         f"Score {score}/{ANOMALY_MEDIUM} — {', '.join(score_detail)}"
                     )},
                    ["flag_for_review", "notify_data_local_manager"])
                self._stats["behavioral_anomaly"] += 1

        # Sub-threshold: still publish score as passive signal
        # The Local Manager's risk engine accumulates these
        elif score > 0:
            logger.debug(
                f"📊 Sub-threshold UEBA [{ip}] score={score} "
                f"({', '.join(score_detail)})"
            )

    # =========================================================================
    # ── P2.4 — UEBA: WALL 3 — Canary divergence check ────────────────────────
    # =========================================================================
    def _run_canary_check(self, ts: float):
        """
        Hourly check: compare each device's adaptive baseline against its canary.
        Canary is a frozen copy of the initial immovable-seeded baseline.
        If adaptive has drifted too far from canary:
          - Freeze adaptive (no new learning)
          - Roll back to last good snapshot
          - Fire CRITICAL baseline_drift alert
        """
        for ip, canary in self._canary.items():
            adaptive = self._adaptive.get(ip)
            if not adaptive:
                continue

            issues = []

            # Check 1: Average bytes drifted more than CANARY_DIVERGE_PCT
            canary_bytes  = canary.get("avg_bytes_per_flow", 1200)
            adaptive_bytes = adaptive.get("avg_bytes_per_flow", 1200)
            if canary_bytes > 0:
                drift_pct = abs(adaptive_bytes - canary_bytes) / canary_bytes * 100
                if drift_pct > CANARY_DIVERGE_PCT:
                    issues.append(
                        f"bytes_drift:{drift_pct:.1f}%>{CANARY_DIVERGE_PCT}%"
                    )

            # Check 2: Ports in adaptive that were never in immovable baseline
            role             = _get_role(ip)
            allowed_ports    = role["allowed_ports"]
            adaptive_ports   = set(adaptive.get("port_counts", {}).keys())
            if allowed_ports != set(range(1, 65536)):  # skip server room
                forbidden_in_adaptive = adaptive_ports - allowed_ports
                if len(forbidden_in_adaptive) > 3:
                    issues.append(
                        f"forbidden_ports_learned:{sorted(forbidden_in_adaptive)[:5]}"
                    )

            # Check 3: Flow rate drifted more than CANARY_DIVERGE_PCT
            canary_fpm   = canary.get("avg_flows_per_min", 10)
            adaptive_fpm = adaptive.get("avg_flows_per_min", 10)
            if canary_fpm > 0:
                fpm_drift = abs(adaptive_fpm - canary_fpm) / canary_fpm * 100
                if fpm_drift > CANARY_DIVERGE_PCT * 2:  # higher tolerance for flow rate
                    issues.append(f"flow_rate_drift:{fpm_drift:.1f}%")

            if issues:
                logger.warning(
                    f"🚨 Canary divergence detected [{ip}]: {issues} — "
                    f"freezing adaptive baseline and rolling back"
                )
                # Freeze adaptive — no more learning until manually cleared
                adaptive["frozen"] = True

                # Roll back to last good snapshot if available
                snaps = self._snapshots.get(ip, [])
                if snaps:
                    last_good = snaps[-1]
                    adaptive["avg_bytes_per_flow"] = last_good["avg_bytes_per_flow"]
                    adaptive["avg_flows_per_min"]  = last_good["avg_flows_per_min"]
                    adaptive["port_counts"]        = dict(last_good["port_counts"])
                    adaptive["total_flows"]        = last_good["total_flows"]
                    logger.warning(
                        f"↩️  Rolled back [{ip}] to snapshot from "
                        f"{last_good['saved_at']}"
                    )

                # Fire CRITICAL alert
                if self._dedup(f"canary:{ip}", ts, cooldown=3600):
                    self._alert(
                        {"src_ip": ip, "dst_ip": "", "dst_port": 0,
                         "proto": "", "sensor": "ueba_canary"},
                        "baseline_drift", SeverityLevel.CRITICAL, 0.95,
                        {"src_ip":      ip,
                         "issues":      issues,
                         "action_taken": "adaptive_frozen_and_rolled_back",
                         "detail": (
                             f"Canary baseline divergence detected for {ip}. "
                             f"Possible baseline poisoning attack. "
                             f"Adaptive baseline frozen pending analyst review."
                         )},
                        ["investigate_device", "review_baseline_manually",
                         "check_for_poisoning_attack",
                         "escalate_to_hq_immediately"]
                    )
                    self._stats["baseline_drift"] += 1

    # =========================================================================
    # ── Original detections — UNCHANGED ──────────────────────────────────────
    # =========================================================================

    def _check_port_scan(self, src_ip, dst_ip, dst_port, ts, payload):
        if not src_ip or not dst_port:
            return
        buf = self._port_scans[src_ip]
        buf.append({"ts": ts, "dst_port": dst_port, "dst_ip": dst_ip})
        cutoff = ts - PORT_SCAN_WINDOW
        recent = [e for e in buf if e["ts"] >= cutoff]
        unique_ports = len({e["dst_port"] for e in recent})
        if unique_ports >= PORT_SCAN_THRESHOLD:
            if self._dedup(f"port_scan:{src_ip}", ts, cooldown=30):
                self._alert(payload, "port_scan", SeverityLevel.HIGH, 0.93,
                    {"src_ip": src_ip, "unique_ports_scanned": unique_ports,
                     "window_sec": PORT_SCAN_WINDOW, "threshold": PORT_SCAN_THRESHOLD,
                     "sample_ports": sorted({e["dst_port"] for e in recent})[:10]},
                    ["block_src_ip", "notify_data_local_manager"])
                self._stats["port_scan"] += 1

    def _check_brute_force(self, src_ip, dst_port, proto, status, ts, payload):
        if not src_ip:
            return
        cutoff = ts - BRUTE_WINDOW
        if dst_port == 22 and status in ("reset", "refused", "failed", "S0", "REJ"):
            buf = self._ssh_fails[src_ip]
            buf.append({"ts": ts})
            count = sum(1 for e in buf if e["ts"] >= cutoff)
            if count >= BRUTE_SSH_THRESHOLD:
                if self._dedup(f"brute_ssh:{src_ip}", ts, cooldown=30):
                    self._alert(payload, "brute_force_ssh", SeverityLevel.HIGH, 0.95,
                        {"src_ip": src_ip, "failed_attempts": count,
                         "window_sec": BRUTE_WINDOW, "service": "SSH"},
                        ["block_src_ip", "rotate_ssh_keys", "notify_data_local_manager"])
                    self._stats["brute_force_ssh"] += 1
        if dst_port in (80, 443, 8080, 8443) and str(status) in ("401", "403"):
            buf = self._http_fails[src_ip]
            buf.append({"ts": ts})
            count = sum(1 for e in buf if e["ts"] >= cutoff)
            if count >= BRUTE_HTTP_THRESHOLD:
                if self._dedup(f"brute_http:{src_ip}", ts, cooldown=30):
                    self._alert(payload, "brute_force_http", SeverityLevel.HIGH, 0.92,
                        {"src_ip": src_ip, "failed_attempts": count,
                         "window_sec": BRUTE_WINDOW, "service": "HTTP"},
                        ["block_src_ip", "enable_rate_limiting"])
                    self._stats["brute_force_http"] += 1

    def _check_exfiltration(self, src_ip, dst_ip, bytes_out, ts, payload):
        if not src_ip or not dst_ip:
            return
        mb_out = bytes_out / (1024 * 1024)
        if mb_out >= EXFIL_THRESHOLD_MB and _is_internal(src_ip) and not _is_internal(dst_ip):
            if self._dedup(f"exfil:{src_ip}:{dst_ip}", ts, cooldown=60):
                self._alert(payload, "data_exfiltration", SeverityLevel.CRITICAL, 0.88,
                    {"src_ip": src_ip, "dst_ip": dst_ip,
                     "bytes_out": int(bytes_out), "mb_out": round(mb_out, 2),
                     "threshold_mb": EXFIL_THRESHOLD_MB,
                     "direction": "internal_to_external"},
                    ["block_connection", "capture_full_packet",
                     "escalate_to_hq_immediately", "notify_data_local_manager"])
                self._stats["data_exfiltration"] += 1

    def _check_lateral_movement(self, src_ip, dst_ip, ts, payload):
        if not src_ip or not dst_ip:
            return
        if not _is_internal(src_ip) or not _is_internal(dst_ip):
            return
        dst_vlan = _vlan_subnet(dst_ip)
        if not dst_vlan:
            return
        buf = self._vlan_hops[src_ip]
        buf.append({"ts": ts, "dst_vlan": dst_vlan})
        cutoff = ts - LATERAL_WINDOW
        recent_vlans = {e["dst_vlan"] for e in buf if e["ts"] >= cutoff}
        if len(recent_vlans) >= LATERAL_VLAN_THRESHOLD:
            if self._dedup(f"lateral:{src_ip}", ts, cooldown=60):
                self._alert(payload, "lateral_movement", SeverityLevel.HIGH, 0.85,
                    {"src_ip": src_ip, "vlans_accessed": list(recent_vlans),
                     "vlan_count": len(recent_vlans), "window_sec": LATERAL_WINDOW},
                    ["isolate_host", "notify_data_local_manager", "escalate_to_hq"])
                self._stats["lateral_movement"] += 1

    def _check_c2_beacon(self, src_ip, dst_ip, bytes_out, ts, payload):
        if not src_ip or not dst_ip:
            return
        if not _is_internal(src_ip) or _is_internal(dst_ip):
            return
        if bytes_out > 10240:
            return
        key = f"{src_ip}→{dst_ip}"
        buf = self._c2_beacons[key]
        buf.append({"ts": ts})
        cutoff = ts - C2_BEACON_WINDOW
        count = sum(1 for e in buf if e["ts"] >= cutoff)
        if count >= C2_BEACON_THRESHOLD:
            if self._dedup(f"c2:{key}", ts, cooldown=120):
                self._alert(payload, "c2_beacon", SeverityLevel.HIGH, 0.80,
                    {"src_ip": src_ip, "dst_ip": dst_ip,
                     "beacon_count": count, "window_sec": C2_BEACON_WINDOW,
                     "avg_bytes": round(bytes_out, 0)},
                    ["block_dst_ip", "capture_full_packet", "notify_data_local_manager"])
                self._stats["c2_beacon"] += 1

    def _check_unauthorized_vlan(self, src_ip, dst_ip, ts, payload):
        src_vlan = _vlan_subnet(src_ip)
        dst_vlan = _vlan_subnet(dst_ip)
        if not src_vlan or not dst_vlan or src_vlan == dst_vlan:
            return
        pair = (src_vlan, dst_vlan)
        if pair in ISOLATED_VLAN_PAIRS or (pair[1], pair[0]) in ISOLATED_VLAN_PAIRS:
            if self._dedup(f"vlan:{src_ip}:{dst_ip}", ts, cooldown=60):
                self._alert(payload, "unauthorized_vlan", SeverityLevel.HIGH, 0.97,
                    {"src_ip": src_ip, "src_vlan": src_vlan,
                     "dst_ip": dst_ip, "dst_vlan": dst_vlan,
                     "rule": "isolated_vlan_pair_violation"},
                    ["block_traffic", "log_full_flow", "notify_data_local_manager"])
                self._stats["unauthorized_vlan"] += 1

    def _check_after_hours(self, src_ip, dst_ip, dst_port, ts, payload):
        student_vlans = ["192.168.10.", "192.168.15."]
        if not any(src_ip.startswith(v) for v in student_vlans):
            return
        hour = datetime.now(timezone.utc).hour
        local_hour = (hour + 3) % 24  # UTC+3 Egypt
        if AFTER_HOURS_START <= local_hour < AFTER_HOURS_END:
            buf = self._after_hours[src_ip]
            buf.append({"ts": ts, "dst_ip": dst_ip, "dst_port": dst_port})
            cutoff = ts - 60
            recent = [e for e in buf if e["ts"] >= cutoff]
            if len(recent) >= 5:
                if self._dedup(f"after_hours:{src_ip}", ts, cooldown=300):
                    self._alert(payload, "after_hours_activity", SeverityLevel.HIGH, 0.85,
                        {"src_ip": src_ip, "local_hour": local_hour,
                         "flows_in_last_60s": len(recent),
                         "detail": f"Student/staff device active between {AFTER_HOURS_START}:00-{AFTER_HOURS_END}:00"},
                        ["flag_for_review", "notify_data_local_manager"])
                    self._stats["after_hours_activity"] += 1

    def _check_dns_tunneling(self, src_ip, dst_ip, dst_port, ts, payload):
        if dst_port != 53:
            return
        buf = self._dns_queries[src_ip]
        buf.append({"ts": ts, "dst_ip": dst_ip})
        cutoff = ts - DNS_TUNNEL_WINDOW
        recent = [e for e in buf if e["ts"] >= cutoff]
        unexpected = dst_ip not in LEGIT_DNS_SERVERS
        high_rate   = len(recent) >= DNS_TUNNEL_THRESHOLD
        if unexpected or high_rate:
            if self._dedup(f"dns_tunnel:{src_ip}", ts, cooldown=60):
                reason = []
                if unexpected:
                    reason.append(f"querying non-campus DNS {dst_ip}")
                if high_rate:
                    reason.append(f"{len(recent)} queries in {DNS_TUNNEL_WINDOW}s")
                self._alert(payload, "dns_tunneling", SeverityLevel.HIGH, 0.87,
                    {"src_ip": src_ip, "dst_dns": dst_ip,
                     "queries_in_window": len(recent),
                     "unexpected_server": unexpected,
                     "detail": ", ".join(reason)},
                    ["block_dns_to_external", "inspect_dns_payload",
                     "notify_data_local_manager"])
                self._stats["dns_tunneling"] += 1

    def _check_slow_scan(self, src_ip: str, dst_port: int, ts: float, payload: dict):
        if src_ip not in self._daily_scans:
            self._daily_scans[src_ip] = {"ports": set(), "window_start": ts}
        entry = self._daily_scans[src_ip]
        if ts - entry["window_start"] > SLOW_SCAN_WINDOW:
            entry["ports"] = set()
            entry["window_start"] = ts
        entry["ports"].add(dst_port)
        total_ports = len(entry["ports"])
        if total_ports >= SLOW_SCAN_THRESHOLD:
            if self._dedup(f"slow_scan:{src_ip}", ts, cooldown=3600):
                self._alert(payload, "slow_port_scan", SeverityLevel.HIGH, 0.85,
                    {"src_ip": src_ip, "unique_ports_24hr": total_ports,
                     "threshold": SLOW_SCAN_THRESHOLD, "window_hours": 24,
                     "detail": (
                         f"Patient attacker: {total_ports} unique ports over 24hr — "
                         f"evading 60s threshold"
                     )},
                    ["block_src_ip", "increase_monitoring", "notify_data_local_manager"])
                self._stats["slow_port_scan"] += 1

    def _check_radius_brute(self, src_ip: str, status: str, ts: float, payload: dict):
        if not src_ip:
            return
        if status not in ("failed", "reject", "rejected", "Access-Reject"):
            return
        buf = self._radius_fails[src_ip]
        buf.append({"ts": ts})
        cutoff = ts - RADIUS_WINDOW
        count  = sum(1 for e in buf if e["ts"] >= cutoff)
        if count >= RADIUS_FAIL_THRESHOLD:
            if self._dedup(f"radius:{src_ip}", ts, cooldown=60):
                self._alert(payload, "radius_brute_force", SeverityLevel.HIGH, 0.90,
                    {"src_ip": src_ip, "failed_attempts": count,
                     "window_sec": RADIUS_WINDOW, "service": "RADIUS/802.1X",
                     "detail": (
                         f"{count} failed 802.1X auth from {src_ip} in {RADIUS_WINDOW}s"
                     )},
                    ["block_src_ip", "alert_radius_admin", "notify_data_local_manager"])
                self._stats["radius_brute_force"] += 1

    def _check_isolation_violation(self, src_ip: str, ts: float, payload: dict):
        isolation_ts = self._isolated_ips.get(src_ip)
        if isolation_ts is None:
            return
        seconds_since = ts - isolation_ts
        if seconds_since > ISOLATION_GRACE:
            if self._dedup(f"iso_violation:{src_ip}", ts, cooldown=30):
                self._alert(payload, "isolation_violation", SeverityLevel.CRITICAL, 0.98,
                    {"src_ip":        src_ip,
                     "isolated_at":   datetime.fromtimestamp(
                                          isolation_ts, tz=timezone.utc).isoformat(),
                     "seconds_since": round(seconds_since),
                     "detail": (
                         f"Traffic from {src_ip} detected {seconds_since:.0f}s after "
                         f"isolation — attacker may have removed ACL entry from Core-SW"
                     ),
                     "mitre_technique": "T1562"},
                    ["re_isolate_immediately", "capture_full_traffic",
                     "check_core_sw_acl", "escalate_to_hq_immediately"])
                self._stats["isolation_violation"] += 1

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _dedup(self, key: str, ts: float, cooldown: float = 30.0) -> bool:
        if ts - self._last_alert.get(key, 0) < cooldown:
            return False
        self._last_alert[key] = ts
        return True

    def _alert(self, raw, attack_type, severity, confidence, details, actions):
        alert = Alert(
            alert_id=str(uuid.uuid4()),
            agent_id=AGENT_ID, agent_type="ndr",
            network_type="data_network",
            alert_type=attack_type, severity=severity, confidence=confidence,
            source={"src_ip":   raw.get("src_ip", ""),
                    "host_id":  raw.get("host_id", raw.get("src_ip", "")),
                    "dst_ip":   raw.get("dst_ip", ""),
                    "dst_port": raw.get("dst_port", ""),
                    "proto":    raw.get("proto", ""),
                    "sensor":   raw.get("sensor", "tcpdump")},
            details={**details, "mitre_technique": MITRE.get(attack_type, "")},
            recommended_actions=actions,
        )
        d = alert.model_dump(mode="json")
        self._producer.publish(Topics.DATA_ALERTS, d, key=raw.get("src_ip", "unknown"))
        self._recent_alerts.append(d)
        self._stats["alerts_sent"] += 1
        logger.warning(
            f"🚨 NDR [{severity.value}] [{attack_type}] "
            f"src={raw.get('src_ip', '')} dst={raw.get('dst_ip', '')}"
        )

    # ── FastAPI ───────────────────────────────────────────────────────────────
    def _build_app(self) -> FastAPI:
        app = FastAPI(title="NDR Agent")

        @app.get("/health")
        def health():
            return JSONResponse({
                "agent_id":  AGENT_ID,
                "status":    "running",
                "timestamp": datetime.now(CAIRO).isoformat(),
                "code_hash": self._code_hash,
                "stats":     self._stats,
                "thresholds": {
                    "port_scan":    PORT_SCAN_THRESHOLD,
                    "brute_ssh":    BRUTE_SSH_THRESHOLD,
                    "brute_http":   BRUTE_HTTP_THRESHOLD,
                    "exfil_mb":     EXFIL_THRESHOLD_MB,
                    "slow_scan":    SLOW_SCAN_THRESHOLD,
                    "radius_fails": RADIUS_FAIL_THRESHOLD,
                    "anomaly_medium": ANOMALY_MEDIUM,
                    "anomaly_high":   ANOMALY_HIGH,
                },
            })

        @app.get("/alerts")
        def alerts(limit: int = 50):
            return JSONResponse(list(self._recent_alerts)[-limit:])

        @app.get("/baseline")
        def baseline():
            """Show full UEBA state — all three walls — per device."""
            now    = time.time()
            result = {}
            for ip in set(list(self._adaptive.keys()) + list(self._canary.keys())):
                adaptive = self._adaptive.get(ip, {})
                canary   = self._canary.get(ip, {})
                snaps    = self._snapshots.get(ip, [])
                q_ports  = {
                    p: {
                        "days_seen":   len(e["days_seen"]),
                        "total_count": e["total_count"],
                    }
                    for p, e in self._quarantine.get(ip, {}).items()
                }
                result[ip] = {
                    "role": next(
                        (p.rstrip(".") for p in IMMOVABLE_BASELINES
                         if ip.startswith(p)), "unknown"
                    ),
                    "wall2_adaptive": {
                        "frozen":             adaptive.get("frozen", False),
                        "avg_bytes_per_flow": round(adaptive.get("avg_bytes_per_flow", 0), 1),
                        "avg_flows_per_min":  round(adaptive.get("avg_flows_per_min", 0), 2),
                        "learned_ports":      sorted(adaptive.get("port_counts", {}).keys()),
                        "active_slots_count": len(adaptive.get("active_slots", {})),
                        "total_flows":        adaptive.get("total_flows", 0),
                        "last_updated_ago":   f"{now - adaptive.get('last_updated', now):.0f}s",
                    },
                    "wall3_canary": {
                        "avg_bytes_per_flow": round(canary.get("avg_bytes_per_flow", 0), 1),
                        "avg_flows_per_min":  round(canary.get("avg_flows_per_min", 0), 2),
                        "port_count":         len(canary.get("port_counts", {})),
                    },
                    "quarantine": {
                        "ports_waiting": len(q_ports),
                        "details":       q_ports,
                    },
                    "snapshots_available": len(snaps),
                    "last_snapshot": snaps[-1]["saved_at"] if snaps else "none",
                }
            return JSONResponse(result)

        @app.post("/baseline/{ip}/unfreeze")
        def unfreeze(ip: str):
            """Manually unfreeze an adaptive baseline after analyst review."""
            if ip in self._adaptive:
                self._adaptive[ip]["frozen"] = False
                logger.warning(f"🔓 Baseline unfrozen manually for {ip}")
                return JSONResponse({"unfrozen": True, "ip": ip})
            return JSONResponse({"error": "IP not found"}, status_code=404)

        return app

    def start(self):
        threading.Thread(
            target=self._consumer.poll_loop,
            args=(self.handle_flow,),
            daemon=True, name="ndr-consumer",
        ).start()
        threading.Thread(
            target=self._cmd_consumer.poll_loop,
            args=(self.handle_command,),
            daemon=True, name="ndr-cmd-consumer",
        ).start()
        threading.Thread(
            target=self._heartbeat_loop,
            daemon=True, name="ndr-heartbeat",
        ).start()
        logger.info(f"▶️  NDR Agent running — health :{HEALTH_PORT}/health")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        self._consumer.stop()
        self._cmd_consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    a = NdrAgent()
    try:
        a.start()
    except KeyboardInterrupt:
        a.stop()
