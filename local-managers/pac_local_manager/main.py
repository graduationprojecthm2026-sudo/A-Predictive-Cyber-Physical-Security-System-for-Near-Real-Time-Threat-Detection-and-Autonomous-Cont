"""
managers/pac_local_manager/main.py
Phase 2 — PAC Local Manager

Consumes: pac.alerts  (from pac_eda_agent + credential_anomaly_agent)
Publishes: pac.incidents → hq.incidents

Reclassification rules (IEC 62443-2-1):
  - unknown_card HIGH + brute_force_badge within 120s → CRITICAL
  - unauthorized_area + impossible_travel same card within 60s → CRITICAL
  - 3+ alerts same card within 30s → CRITICAL (coordinated attack)

Operator approval: 60s window for CRITICAL, auto-escalate on timeout.
Area-sensitivity boost: restricted area alerts auto-upgrade by one level.

FastAPI:
  GET  /health  /alerts  /incidents  /devices  /pending
  POST /approve/{id}  /dismiss/{id}  /lock_door/{door_id}

Standards: NIST SP 800-61, IEC 62443-2-1, NIST CSF 2.0 RESPOND
"""
from __future__ import annotations

import logging, os, sys, threading, time, uuid
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
logger = logging.getLogger("pac_local_manager")

MANAGER_ID   = os.getenv("MANAGER_ID",          "pac-local-manager-01")
BOOTSTRAP    = os.getenv("KAFKA_BOOTSTRAP",      "localhost:9092")
HEALTH_PORT  = int(os.getenv("HEALTH_PORT",     "8011"))
PAC_PI_IP    = os.getenv("PAC_PI_IP",           "192.168.31.10")  # IP of the Pi running PAC agents

# Postgres (history) — read-only history of this domain's alerts
PG_CONFIG = {
    "host":     os.getenv("PG_HOST", "192.168.60.10"),
    "port":     int(os.getenv("PG_PORT", "5432")),
    "dbname":   os.getenv("PG_DB",   "massdb"),
    "user":     os.getenv("PG_USER", "massadmin"),
    "password": os.getenv("PG_PASS", "mass2026"),
    "connect_timeout": 5,
}
HISTORY_TOPIC = os.getenv("HISTORY_TOPIC", "pac.alerts")
APPROVAL_WIN = int(os.getenv("APPROVAL_WINDOW_SEC",    "60"))
CORR_WIN     = int(os.getenv("CORRELATION_WINDOW_SEC", "120"))
HB_TIMEOUT   = int(os.getenv("HEARTBEAT_TIMEOUT_SEC",  "30"))

# Restricted areas get automatic severity upgrade
RESTRICTED_AREAS = {"restricted", "server_room", "admin"}
SEVERITY_ORDER   = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
SEVERITY_UP      = {v: k for k, v in SEVERITY_ORDER.items()}   # int → name

# Physical door whitelist — ground truth from building infrastructure.
# ANY door_id that arrives from Kafka that is NOT in this set is an attack or noise.
KNOWN_DOORS: Dict[str, dict] = {
    "door_acad_f1_d1": {
        "id":      "door_acad_f1_d1",
        "door_id": "door_acad_f1_d1",
        "label":   "Academic Floor 1 Door 1",
        "floor":   1,
        "zone":    "Academic/Floor1/Door1",
    },
}
KNOWN_CAMERAS: Dict[str, dict] = {
    "camera-agent-01": {
        "id":    "camera-agent-01",
        "label": "Academic Floor 1 Camera",
        "floor": 1,
        "zone":  "Academic/Floor1/Door1",
    },
}


class PACLocalManager:
    def __init__(self):
        logger.info(f"🚀 PAC Local Manager {MANAGER_ID}")
        self._alerts:    deque = deque(maxlen=300)
        self._incidents: List[dict] = []
        self._pending:   Dict[str, dict] = {}
        self._last_seen:  Dict[str, float] = {}           # card_uid → last event ts
        self._last_event: Dict[str, tuple] = {}           # card_uid → (access, ts) for debounce
        self._soar_log:   List[dict] = []                 # auto-issued SOAR commands

        # Per card-uid rolling alert history for correlation
        self._card_alerts: Dict[str, deque] = defaultdict(lambda: deque(maxlen=20))
        # Per alert_type rolling history for cross-type correlation
        self._type_alerts: Dict[str, deque] = defaultdict(lambda: deque(maxlen=20))

        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._snapshots: deque = deque(maxlen=50)
        self._consumer = KafkaConsumerClient(MANAGER_ID, [Topics.PAC_ALERTS, Topics.PAC_EVENTS, "pac.snapshots"], BOOTSTRAP, replay_history=True, force_seek_beginning_topics=["pac.snapshots"])
        self._stats = {"received": 0, "incidents": 0, "escalated": 0,
                       "auto_escalated": 0, "dismissed": 0, "locked_doors": 0}
        self._locked_doors: Dict[str, str] = {}   # door_id → reason
        self._blocked_cards: Dict[str, str] = {}  # card_uid → reason
        self._hb = HeartbeatPublisher(
            self._producer, MANAGER_ID, interval_sec=15.0,
            stats_fn=lambda: dict(self._stats),
        )
        self._app = self._build_app()
        logger.info("✅ PAC Local Manager ready")

    # ── Alert handler ─────────────────────────────────────────────────────────
    def handle_alert(self, topic: str, payload: dict):
        self._stats["received"] += 1

        # ── Door validation (pac.events only) ───────────────────────────────
        # pac.events come from the Pi RFID reader. Any event with a door_id
        # that is NOT in KNOWN_DOORS is a spoofed injection — treat it as a
        # CRITICAL attack and reject the event from normal processing.
        if topic == Topics.PAC_EVENTS:
            door_id = payload.get("door_id", "")
            if door_id and door_id not in KNOWN_DOORS:
                logger.warning(
                    f"🚨 SPOOFED DOOR INJECTION: topic={topic} door_id={door_id!r} "
                    f"(not in KNOWN_DOORS) — rejecting event, escalating as attack"
                )
                spoof_alert = {
                    "alert_id":   str(uuid.uuid4()),
                    "alert_type": "spoofed_door_injection",
                    "severity":   "CRITICAL",
                    "confidence": 1.0,
                    "door_id":    door_id,
                    "card_uid":   payload.get("card_uid", "unknown"),
                    "source":     payload,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "message":    f"Event received for unknown door '{door_id}' — Kafka injection attack suspected",
                }
                incident = self._create_incident(spoof_alert, "CRITICAL", payload.get("card_uid", "unknown"))
                self._handle_escalation(incident)
                return  # do NOT store this event as a normal alert

        card_uid   = (payload.get("source") or {}).get("card_uid", "") or payload.get("card_uid", "unknown")
        # Camera events use event_type; EDA/RFID events use alert_type — normalise both
        alert_type = payload.get("alert_type") or payload.get("event_type") or ""
        severity   = payload.get("severity", "LOW")
        ts         = time.time()

        self._last_seen[card_uid] = ts
        stored = {**payload, "received_at": datetime.now(timezone.utc).isoformat()}
        # Ensure alert_type is always set so downstream endpoints work
        if not stored.get("alert_type") and stored.get("event_type"):
            stored["alert_type"] = stored["event_type"]
        # Normalize naive timestamps from the Pi (no timezone suffix) to explicit UTC
        # so the dashboard always interprets them correctly as UTC before converting to UTC+3.
        raw_ts = stored.get("timestamp", "")
        if raw_ts and len(raw_ts) >= 16 and "+" not in raw_ts[10:] and not raw_ts.endswith("Z"):
            stored["timestamp"] = raw_ts + "Z"
        # Snapshot events go to separate deque (they carry image_b64 and are large).
        # Return immediately — snapshots must NOT feed card_alerts, reclassify, or incidents.
        if topic == "pac.snapshots" or stored.get("image_b64"):
            self._snapshots.append(stored)
            return
        # Intermediate face-verification state — drop it; the final decision
        # (access=denied with reason=face_verification_timeout, or access=granted)
        # arrives as a separate event from the same door_process.py loop.
        if payload.get("access") == "pending":
            logger.debug(f"⏳ Skipping intermediate pending event for card={card_uid}")
            return
        # Debounce: only for raw pac.events (not EDA alerts which have alert_id).
        # Drop duplicate events from the same card+access within 5 seconds —
        # the Pi polling loop publishes the same physical scan multiple times.
        is_raw_event = topic == Topics.PAC_EVENTS and not payload.get("alert_id")
        if is_raw_event:
            access = payload.get("access", "")
            last_key = self._last_event.get(card_uid)
            if last_key and last_key[0] == access and (ts - last_key[1]) < 5.0:
                logger.debug(f"⏭️  Debounce duplicate {access} event for card={card_uid}")
                return
            self._last_event[card_uid] = (access, ts)
            # Persist raw scan event to Postgres so it survives manager restarts.
            # Kafka retention is very short; without this, history is empty after a few minutes.
            self._persist_raw_event(stored)

        self._alerts.append(stored)
        self._card_alerts[card_uid].append({"ts": ts, "type": alert_type, "sev": severity})
        self._type_alerts[alert_type].append({"ts": ts, "card": card_uid, "sev": severity})

        logger.info(f"📥 [{severity}] {alert_type} card={card_uid}")

        # Apply area-sensitivity upgrade
        severity = self._area_upgrade(payload, severity)

        # Apply correlation reclassification
        severity = self._reclassify(card_uid, alert_type, severity, ts)

        if SEVERITY_ORDER.get(severity, 0) >= SEVERITY_ORDER["HIGH"]:
            incident = self._create_incident(payload, severity, card_uid)
            self._handle_escalation(incident)

    # ── Persist raw RFID scan events ──────────────────────────────────────────
    def _persist_raw_event(self, event: dict):
        """Write one raw pac.events scan to Postgres for durable history.
        Opens a short-lived connection (scans are infrequent — 1-2 per swipe)."""
        access = event.get("access", "unknown")
        conn = None
        try:
            import psycopg2, json as _json
            conn = psycopg2.connect(**PG_CONFIG)
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO alerts (alert_id, topic, agent_id, alert_type, severity, confidence, timestamp, payload) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        str(uuid.uuid4()),
                        "pac.events",
                        "",          # no agent_id — raw Pi scan, not from a security agent
                        f"rfid_{access}",
                        "LOW",
                        1.0,
                        event.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                        _json.dumps(event),
                    )
                )
                conn.commit()
            logger.debug(f"💾 pac.event persisted: card={event.get('card_uid')} access={access}")
        except Exception as e:
            logger.debug(f"DB write skipped for pac.event: {e}")
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    # ── Reclassification rules ────────────────────────────────────────────────
    def _area_upgrade(self, payload: dict, severity: str) -> str:
        details = payload.get("details", {})
        area    = details.get("area_sensitivity", "")
        if area in RESTRICTED_AREAS and severity != "CRITICAL":
            idx = SEVERITY_ORDER.get(severity, 0)
            upgraded = SEVERITY_UP.get(min(idx + 1, 3), severity)
            if upgraded != severity:
                logger.info(f"⬆️  Area upgrade [{severity}] → [{upgraded}] (restricted area)")
            return upgraded
        return severity

    def _reclassify(self, card_uid: str, alert_type: str,
                    severity: str, now: float) -> str:
        cutoff = now - CORR_WIN

        def recent_type(atype, min_sev="LOW"):
            return any(
                a["ts"] >= cutoff
                and SEVERITY_ORDER.get(a["sev"], 0) >= SEVERITY_ORDER.get(min_sev, 0)
                for a in self._type_alerts.get(atype, [])
            )

        def card_alert_count(min_sev="MEDIUM", window=30):
            return sum(
                1 for a in self._card_alerts.get(card_uid, [])
                if (now - a["ts"]) <= window
                and SEVERITY_ORDER.get(a["sev"], 0) >= SEVERITY_ORDER.get(min_sev, 0)
            )

        # Rule 1: unknown_card + brute_force within CORR_WIN → CRITICAL
        if alert_type == "unknown_card_attempt" and recent_type("brute_force_badge_attempt","HIGH"):
            logger.warning("🔴 Rule 1: unknown_card + brute_force → CRITICAL")
            return "CRITICAL"
        if alert_type == "brute_force_badge_attempt" and recent_type("unknown_card_attempt","HIGH"):
            logger.warning("🔴 Rule 1 (inv): brute_force + unknown_card → CRITICAL")
            return "CRITICAL"

        # Rule 2: unauthorized_area + impossible_travel same card → CRITICAL
        if alert_type == "unauthorized_area_access" and recent_type("impossible_travel_detected","HIGH"):
            logger.warning("🔴 Rule 2: unauthorized_area + impossible_travel → CRITICAL")
            return "CRITICAL"
        if alert_type == "impossible_travel_detected" and recent_type("unauthorized_area_access","MEDIUM"):
            logger.warning("🔴 Rule 2 (inv): impossible_travel + unauthorized → CRITICAL")
            return "CRITICAL"

        # Rule 3: ≥3 alerts same card in 30s → CRITICAL (coordinated)
        if card_alert_count(min_sev="MEDIUM", window=30) >= 3:
            logger.warning(f"🔴 Rule 3: ≥3 alerts card={card_uid} in 30s → CRITICAL")
            return "CRITICAL"

        return severity

    # ── Incident management ───────────────────────────────────────────────────
    def _create_incident(self, payload: dict, severity: str, card_uid: str) -> dict:
        inc = {
            "incident_id":      f"INC-PAC-{uuid.uuid4().hex[:8].upper()}",
            "created_at":       datetime.now(timezone.utc).isoformat(),
            "manager_id":       MANAGER_ID,
            "severity":         severity,
            "network_domain":   "physical_access",
            "trigger_alert_id": payload.get("alert_id"),
            "card_uid":         card_uid,
            "alert_type":       payload.get("alert_type", ""),
            "details":          payload.get("details", {}),
            "status":           "pending_approval" if severity == "CRITICAL" else "auto_escalated",
            "recommended_actions": payload.get("recommended_actions", []),
        }
        self._incidents.append(inc)
        self._stats["incidents"] += 1
        logger.warning(f"📋 Incident {inc['incident_id']} [{severity}] card={card_uid}")
        return inc

    def _handle_escalation(self, inc: dict):
        if inc["severity"] == "CRITICAL":
            self._pending[inc["incident_id"]] = {**inc, "deadline": time.time() + APPROVAL_WIN}
            logger.warning(f"⏳ {inc['incident_id']} queued — auto-escalates in {APPROVAL_WIN}s")
            threading.Thread(target=self._approval_timeout,
                             args=(inc["incident_id"],), daemon=True).start()
        else:
            self._escalate_to_hq(inc)

    def _approval_timeout(self, iid: str):
        time.sleep(APPROVAL_WIN)
        if iid in self._pending:
            inc = self._pending.pop(iid)
            inc["status"] = "auto_escalated_after_timeout"
            logger.warning(f"⏰ Auto-escalating {iid}")
            self._escalate_to_hq(inc)
            self._stats["auto_escalated"] += 1

    def _escalate_to_hq(self, inc: dict):
        inc["status"]       = "escalated_to_hq"
        inc["escalated_at"] = datetime.now(timezone.utc).isoformat()
        self._producer.publish(Topics.HQ_INCIDENTS, inc, key=inc["incident_id"])
        self._stats["escalated"] += 1
        logger.warning(f"🚀 → HQ: {inc['incident_id']} [{inc['severity']}]")

    # ── Automatic SOAR response ───────────────────────────────────────────────
    # Called immediately after incident creation for HIGH/CRITICAL alerts.
    # Publishes block_card (and optionally lock_door) to soar.commands so the
    # Pi's door_process.py can act on it in real-time.
    _BLOCK_ACTIONS = {
        "brute_force_badge_attempt":      {"block": True, "lock": True,  "approval": False},
        "unknown_card_attempt":           {"block": True, "lock": False, "approval": False},
        "badge_clone_suspected":          {"block": True, "lock": False, "approval": False},
        "insider_threat_physical_cyber":  {"block": True, "lock": False, "approval": True},
        "forced_entry":                   {"block": True, "lock": True,  "approval": False},
        "spoofed_door_injection":         {"block": True, "lock": True,  "approval": False},
    }

    def _auto_soar(self, payload: dict, card_uid: str, alert_type: str):
        rule = self._BLOCK_ACTIONS.get(alert_type)
        if not rule:
            return  # no auto-action for this alert type (e.g. tailgating, face_mismatch)

        # Don't re-block a card that's already blocked
        if card_uid in self._blocked_cards and rule["block"]:
            logger.info(f"⏭️  SOAR: card {card_uid} already blocked — skipping duplicate")
            return

        door_id = (payload.get("details", {}).get("door_id")
                   or payload.get("door_id")
                   or (payload.get("source") or {}).get("door_id")
                   or "door_acad_f1_d1")
        now = datetime.now(timezone.utc).isoformat()

        if rule["block"]:
            self._blocked_cards[card_uid] = alert_type
            cmd = {
                "command_id":        f"CMD-{uuid.uuid4().hex[:8].upper()}",
                "action":            "block_card",
                "card_uid":          card_uid,
                "door_id":           door_id,
                "reason":            alert_type,
                "issued_by":         MANAGER_ID,
                "issued_at":         now,
                "triggered_by":      payload.get("agent_id", "pac_eda"),
                "incident_id":       payload.get("alert_id", ""),
                "requires_approval": rule["approval"],
                "auto":              True,
            }
            self._producer.publish(Topics.SOAR_COMMANDS, cmd, key=card_uid)
            self._soar_log.append(cmd)
            logger.warning(
                f"📤 AUTO SOAR: block_card card={card_uid} alert={alert_type} "
                f"approval_required={rule['approval']}"
            )

        if rule["lock"]:
            self._locked_doors[door_id] = alert_type
            cmd = {
                "command_id":        f"CMD-{uuid.uuid4().hex[:8].upper()}",
                "action":            "lock_door",
                "door_id":           door_id,
                "reason":            alert_type,
                "issued_by":         MANAGER_ID,
                "issued_at":         now,
                "triggered_by":      payload.get("agent_id", "pac_eda"),
                "incident_id":       payload.get("alert_id", ""),
                "requires_approval": False,
                "auto":              True,
            }
            self._producer.publish(Topics.SOAR_COMMANDS, cmd, key=door_id)
            self._soar_log.append(cmd)
            logger.warning(f"📤 AUTO SOAR: lock_door door={door_id} alert={alert_type}")

    # ── FastAPI ───────────────────────────────────────────────────────────────
    def _build_app(self) -> FastAPI:
        app = FastAPI(title="PAC Local Manager")

        @app.get("/health")
        def health():
            return JSONResponse({"manager_id": MANAGER_ID, "status": "running",
                                  "timestamp": datetime.now(timezone.utc).isoformat(),
                                  "stats": self._stats,
                                  "locked_doors": self._locked_doors})

        @app.get("/alerts")
        def alerts(limit: int = 50):
            return JSONResponse(list(self._alerts)[-limit:])

        @app.get("/snapshots")
        def snapshots(limit: int = 10, camera_id: str = None):
            """Return latest camera snapshots with image_b64 from pac.snapshots topic."""
            snaps = list(self._snapshots)
            if camera_id:
                snaps = [s for s in snaps if s.get("sensor") == camera_id or s.get("camera_id") == camera_id]
            return JSONResponse(snaps[-limit:])

        @app.get("/history")
        def history(limit: int = 200):
            """Read this domain's alert history from Postgres (read-only).
            Returns pac.alerts rows with payload nested (EDA alert format) and
            pac.events rows with payload spread to top-level (raw scan format),
            so the dashboard _normPacEvent function handles both correctly.
            """
            limit = max(1, min(limit, 1000))
            conn = None
            try:
                import psycopg2, psycopg2.extras
                conn = psycopg2.connect(**PG_CONFIG)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        "SELECT alert_id, topic, agent_id, alert_type, severity, confidence, timestamp, payload "
                        "FROM alerts WHERE topic IN %s ORDER BY timestamp DESC LIMIT %s",
                        (("pac.alerts", "pac.events"), limit))
                    rows = cur.fetchall()
                result = []
                for r in rows:
                    r = dict(r)
                    ts = r.get("timestamp")
                    if ts is not None:
                        r["timestamp"] = ts.isoformat()
                    payload = r.pop("payload", None) or {}
                    if r.get("topic") == "pac.events":
                        # Raw scan event: spread payload to top level so _normPacEvent
                        # sees access/card_uid directly.  Clear alert_id/agent_id so
                        # the dashboard does NOT classify this as an EDA alert.
                        merged = {**payload,
                                  "timestamp": r["timestamp"],
                                  "severity": r.get("severity", "LOW")}
                        merged.pop("agent_id", None)
                        merged.pop("alert_id", None)
                        result.append(merged)
                    else:
                        # EDA alert: keep payload nested.
                        # _normPacEvent reads a.payload||a so it will unwrap it.
                        r["payload"] = payload
                        result.append(r)
                return JSONResponse(result)
            except Exception as e:
                logger.error(f"History query failed: {e}")
                return JSONResponse([])
            finally:
                if conn:
                    conn.close()

        @app.get("/incidents")
        def incidents():
            """Dashboard compat: the dashboard maps /pac-manager/incidents →
            STATE.pacEvents, expecting event_type, verdict, uid, door_id etc.
            Real incidents are at /raw-incidents.
            """
            out = []
            for a in list(self._alerts)[-50:]:
                src = a.get("source") or {}
                det = a.get("details") or {}
                atype = a.get("alert_type", "access_event")
                flat_access = "granted" if "grant" in atype else ("denied" if "den" in atype else "granted")
                access = det.get("access") or a.get("access") or flat_access
                verdict = ("allow" if access == "granted"
                           else "tail" if "tailgat" in atype else "deny")
                door_id = (det.get("door_id") or src.get("door_id")
                           or a.get("door_id") or src.get("device_id")
                           or a.get("device_id") or "door_unknown")
                uid = src.get("card_uid") or a.get("card_uid") or a.get("uid") or ""
                name = src.get("user_name") or a.get("user_name") or "Unknown"
                cam_suffix = door_id[-2:].upper() if door_id else "A1"
                out.append({
                    "event_id":      a.get("alert_id", ""),
                    "event_type":    "rfid_swipe_" + atype,
                    "timestamp":     a.get("timestamp", ""),
                    "verdict":       verdict,
                    "match":         verdict,
                    "uid":           uid,
                    "door_id":       door_id,
                    "camera_id":     "CAM-" + cam_suffix,
                    "floor":         det.get("floor") or a.get("floor", 1),
                    "employee_name": name,
                    "user_role":     src.get("user_role") or a.get("user_role", ""),
                    "ldap_result":   det.get("ldap_result", ""),
                    "confidence":    a.get("confidence", 0.9),
                    "severity":      a.get("severity", "LOW"),
                    "reason":        a.get("message", atype),
                    "message":       a.get("message", ""),
                    "mitre":         det.get("mitre_technique", ""),
                    "zone":          src.get("zone") or a.get("zone", ""),
                    "rfid_swipe":    True,
                })
            return JSONResponse(out)

        @app.get("/raw-incidents")
        def raw_incidents():
            return JSONResponse(self._incidents)

        @app.get("/events")
        def events(limit: int = 50):
            """Dashboard-compatible PAC events list.
            Handles both EDA alert format (nested source/details) and raw
            pac.events format (flat fields from Pi door_process.py).
            """
            out = []
            for a in list(self._alerts)[-limit:]:
                src = a.get("source") or {}
                det = a.get("details") or {}
                atype = a.get("alert_type", "access_event")
                # Flat pac.events: access derived from event_type
                flat_access = "granted" if "grant" in atype else ("denied" if "den" in atype else "granted")
                access = det.get("access") or (a.get("access") or flat_access)
                verdict = "allow" if access == "granted" else (
                    "tail" if "tailgat" in atype else "deny"
                )
                # door_id: nested EDA format first, then flat pac.events fields
                door_id = (det.get("door_id") or src.get("door_id")
                           or a.get("door_id") or src.get("device_id")
                           or a.get("device_id") or "")
                # card uid: nested first, then flat
                uid = (src.get("card_uid") or a.get("card_uid")
                       or a.get("uid") or "")
                # employee name
                name = src.get("user_name") or a.get("user_name") or "Unknown"
                cam_suffix = door_id[-2:].upper() if door_id else "A1"
                out.append({
                    "event_id":      a.get("alert_id", ""),
                    "event_type":    atype,
                    "timestamp":     a.get("timestamp", ""),
                    "verdict":       verdict,
                    "match":         verdict,
                    "uid":           uid,
                    "door_id":       door_id,
                    "camera_id":     "CAM-" + cam_suffix,
                    "floor":         det.get("floor") or a.get("floor", 1),
                    "employee_name": name,
                    "user_role":     src.get("user_role") or a.get("user_role", ""),
                    "ldap_result":   det.get("ldap_result", ""),
                    "confidence":    a.get("confidence", 0.9),
                    "severity":      a.get("severity", "LOW"),
                    "reason":        a.get("message", atype),
                    "message":       a.get("message", ""),
                    "mitre":         det.get("mitre_technique", ""),
                    "zone":          src.get("zone") or a.get("zone", ""),
                    "rfid_swipe":    True,
                })
            return JSONResponse(out)

        @app.get("/doors")
        def doors():
            """Return monitored doors in dashboard-compatible shape."""
            doors_seen: dict = {}
            for a in self._alerts:
                det = a.get("details", {})
                did = det.get("door_id", "")
                if did and did not in doors_seen:
                    access = det.get("access", "granted")
                    doors_seen[did] = {
                        "id":      did,
                        "door_id": did,
                        "label":   did.replace("_", " ").replace("-", " ").title(),
                        "floor":   det.get("floor", 1),
                        "zone":    a.get("source", {}).get("zone", ""),
                        "state":   "OPEN" if access == "granted" else "LOCKED",
                        "locked":  self._locked_doors.get(did, "") != "",
                        "lock_reason": self._locked_doors.get(did, ""),
                    }
            return JSONResponse(list(doors_seen.values()))

        @app.get("/pending")
        def pending():
            return JSONResponse(list(self._pending.values()))

        @app.get("/devices")
        def devices():
            """Return only the known physical doors (KNOWN_DOORS whitelist).
            Doors that appear in Kafka but are not in the whitelist are attacks —
            they are never surfaced as real doors in the dashboard.
            """
            result = []
            for did, base in KNOWN_DOORS.items():
                door = {**base}
                door["locked"]      = did in self._locked_doors
                door["lock_reason"] = self._locked_doors.get(did, "")
                door["state"]       = "LOCKED" if door["locked"] else "CLOSED"
                result.append(door)
            return JSONResponse(result)

        @app.post("/approve/{iid}")
        def approve(iid: str):
            if iid not in self._pending:
                raise HTTPException(404, "Not found or already processed")
            inc = self._pending.pop(iid)
            inc["status"] = "manually_approved"
            self._escalate_to_hq(inc)
            return JSONResponse({"approved": True, "incident_id": iid})

        @app.post("/dismiss/{iid}")
        def dismiss(iid: str):
            if iid not in self._pending:
                raise HTTPException(404, "Not found")
            self._pending[iid]["status"] = "dismissed"
            del self._pending[iid]
            self._stats["dismissed"] += 1
            return JSONResponse({"dismissed": True, "incident_id": iid})

        @app.post("/lock_door/{door_id}")
        def lock_door(door_id: str, reason: str = "manual_lock"):
            self._locked_doors[door_id] = reason
            self._stats["locked_doors"] += 1
            logger.warning(f"🔒 Door locked: {door_id} reason={reason}")
            # Publish to soar.commands so door_process.py on the Pi actually locks the door
            cmd = {
                "command_id": f"CMD-{uuid.uuid4().hex[:8].upper()}",
                "action": "lock_door",
                "door_id": door_id,
                "reason": reason,
                "issued_by": MANAGER_ID,
                "issued_at": datetime.now(timezone.utc).isoformat(),
                "requires_approval": False,
            }
            self._producer.publish(Topics.SOAR_COMMANDS, cmd, key=door_id)
            logger.warning(f"📤 soar.commands: lock_door {door_id}")
            return JSONResponse({"locked": True, "door_id": door_id, "reason": reason})

        @app.post("/block_card")
        async def block_card(request: Request):
            body = await request.json()
            card_uid = body.get("card_uid", "")
            reason   = body.get("reason", "manual_block")
            door_id  = body.get("door_id", "")
            if not card_uid:
                raise HTTPException(400, "card_uid required")
            self._blocked_cards[card_uid] = reason
            logger.warning(f"🚫 Card blocked: {card_uid} reason={reason}")
            cmd = {
                "command_id": f"CMD-{uuid.uuid4().hex[:8].upper()}",
                "action": "block_card",
                "card_uid": card_uid,
                "door_id": door_id,
                "reason": reason,
                "issued_by": MANAGER_ID,
                "issued_at": datetime.now(timezone.utc).isoformat(),
                "requires_approval": False,
            }
            self._producer.publish(Topics.SOAR_COMMANDS, cmd, key=card_uid)
            logger.warning(f"📤 soar.commands: block_card {card_uid}")
            return JSONResponse({"blocked": True, "card_uid": card_uid, "reason": reason})

        @app.get("/blocked_cards")
        def blocked_cards():
            return JSONResponse([{"card_uid": k, "reason": v} for k, v in self._blocked_cards.items()])

        @app.get("/soar-log")
        def soar_log(limit: int = 50):
            """Return auto-issued SOAR commands (block_card / lock_door) from agent decisions."""
            return JSONResponse(self._soar_log[-limit:])

        @app.get("/agents")
        def pac_agents():
            """Poll EDA (8002) and CRED (8003) health endpoints; return live statuses."""
            import urllib.request as _ur
            import json as _json
            _PAC_AGENTS = [
                ("pac-eda-agent-01",            8002),
                ("credential-anomaly-agent-01", 8003),
            ]
            result = {}
            for agent_id, port in _PAC_AGENTS:
                try:
                    with _ur.urlopen(f"http://{PAC_PI_IP}:{port}/health", timeout=2) as r:
                        data = _json.loads(r.read())
                    result[agent_id] = {
                        "id":            agent_id,
                        "status":        "alive",
                        "last_seen_ago": 0,
                        "source":        "pac-manager-proxy",
                        "stats":         data.get("stats", {}),
                    }
                except Exception:
                    result[agent_id] = {
                        "id":            agent_id,
                        "status":        "down",
                        "last_seen_ago": 999,
                        "source":        "pac-manager-proxy",
                    }
            return JSONResponse(result)

        return app

    def start(self):
        self._hb.start()
        threading.Thread(target=self._consumer.poll_loop,
                         args=(self.handle_alert,),
                         daemon=True, name="pac-mgr-consumer").start()
        logger.info(f"▶️  PAC Local Manager — API :{HEALTH_PORT}")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        self._hb.stop()
        self._consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    m = PACLocalManager()
    try:
        m.start()
    except KeyboardInterrupt:
        m.stop()
