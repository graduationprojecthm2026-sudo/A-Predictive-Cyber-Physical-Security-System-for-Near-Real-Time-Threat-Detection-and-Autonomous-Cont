"""
IoT Local Manager — managers/iot_local_manager/main.py
Phase 1 / Week 3 deliverable

Consumes alerts from iot.alerts (gateway_agent + behavioral_agent outputs),
re-classifies with multi-sensor context, manages device heartbeats,
and escalates confirmed incidents to hq.incidents.

Also exposes FastAPI endpoints:
  GET  /health           — liveness check
  GET  /alerts           — recent alert list
  GET  /incidents        — escalated incidents
  GET  /devices          — device heartbeat status
  POST /approve/{id}     — manual operator approval (60s window)

Standards:
  - NIST SP 800-61 — Incident detection and analysis
  - IEC 62443-2-1 — Security management for IACS
  - NIST CSF 2.0 DETECT / RESPOND
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from common.kafka_client import HeartbeatPublisher, KafkaConsumerClient, KafkaProducerClient, Topics
from common.models import Alert, SeverityLevel

# Canonical type map: device_type (upper) → sensor category
TYPE_MAP: dict = {
    "DHT22":     "temperature",
    "MQ2":       "gas",
    "PIR":       "motion",
    "CO2":       "co2",
    "SMOKE":     "smoke",
    "LUX":       "lux",
    "CPU_TEMP":  "cpu_temp",
    "TELEMETRY": "power",   # default for generic node telemetry
}


def resolve_sensor_type(msg: dict) -> str:
    """Canonical sensor type from any message shape (telemetry or alert).

    Priority: source.sensor_type → msg.sensor_type → msg.device_type → device_id prefix.
    Special case: device_type=TELEMETRY + unit=C_CPU → cpu_temp (Pi board sensor).
    """
    src     = msg.get("source", {})
    raw     = (src.get("sensor_type") or msg.get("sensor_type")
               or msg.get("device_type") or "")
    unit    = (src.get("unit") or msg.get("unit", "")).upper()
    did     = src.get("device_id") or msg.get("device_id", "")
    # Pi board CPU sensor: device_type=TELEMETRY, unit=C_CPU
    if raw.upper() == "TELEMETRY" and unit in ("C_CPU",):
        return "cpu_temp"
    # DHT22 publishes both temperature (unit=C) and humidity (unit=%) from the same device_id
    if raw.upper() == "DHT22" and unit in ("%", "PERCENT", "RH"):
        return "humidity"
    if raw:
        return TYPE_MAP.get(raw.upper(), raw.lower())
    # Last resort: derive from device_id prefix (e.g. PIR-ACADEMIC-* → motion)
    prefix = did.split("-")[0].upper()
    return TYPE_MAP.get(prefix, prefix.lower() or "unknown")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("iot_local_manager")

MANAGER_ID    = os.getenv("MANAGER_ID",      "iot-local-manager-01")
BOOTSTRAP     = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
HEALTH_PORT   = int(os.getenv("HEALTH_PORT", "8010"))

# Postgres (history) — read-only history of this domain's alerts
PG_CONFIG = {
    "host":     os.getenv("PG_HOST", "192.168.60.10"),
    "port":     int(os.getenv("PG_PORT", "5432")),
    "dbname":   os.getenv("PG_DB",   "massdb"),
    "user":     os.getenv("PG_USER", "massadmin"),
    "password": os.getenv("PG_PASS", "mass2026"),
    "connect_timeout": 5,
}
HISTORY_TOPIC = os.getenv("HISTORY_TOPIC", "iot.alerts")

# Heartbeat: if no message from a device for > this many seconds → dropout alert
HEARTBEAT_TIMEOUT_SEC = int(os.getenv("HEARTBEAT_TIMEOUT_SEC", "60"))

# Operator approval window for CRITICAL escalations
APPROVAL_WINDOW_SEC = int(os.getenv("APPROVAL_WINDOW_SEC", "60"))

# Correlation window: events within this window get grouped into one incident
CORRELATION_WINDOW_SEC = int(os.getenv("CORRELATION_WINDOW_SEC", "30"))


class IoTLocalManager:

    def __init__(self):
        logger.info(f"🚀 Starting IoT Local Manager {MANAGER_ID}")

        # Alert storage (last 200)
        self._alerts: deque = deque(maxlen=200)

        # Incidents waiting for operator approval: {incident_id: incident_dict}
        self._pending_approval: Dict[str, dict] = {}

        # Confirmed/escalated incidents
        self._incidents: List[dict] = []

        # Device heartbeat tracking: device_id -> last_seen timestamp
        self._last_seen: Dict[str, float] = {}
        # Last known metadata per device — used to enrich dropout alerts
        self._device_meta: Dict[str, dict] = {}

        # Recent alert buffer per sensor_type for correlation
        self._recent_alerts: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))

        # Kafka
        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._consumer = KafkaConsumerClient(
            group_id=MANAGER_ID,
            topics=[Topics.IOT_ALERTS, Topics.IOT_TELEMETRY],
            bootstrap_servers=BOOTSTRAP,
            replay_history=True,
        )

        self._stats = {
            "alerts_received": 0,
            "incidents_created": 0,
            "escalated_to_hq": 0,
            "device_dropouts_detected": 0,
        }

        self._hb = HeartbeatPublisher(
            self._producer, MANAGER_ID, interval_sec=15.0,
            stats_fn=lambda: dict(self._stats),
        )

        self._app = self._build_api()
        logger.info("✅ IoT Local Manager initialized")

    # ─── Alert processing ─────────────────────────────────────────────────────

    def handle_alert(self, topic: str, payload: dict):
        """Main handler for incoming IoT alerts."""
        self._stats["alerts_received"] += 1

        # Update device heartbeat — only for real sensor data, not for dropout events.
        # Dropout alerts are published back to iot.alerts and consumed by this same
        # manager; updating _last_seen on a dropout would re-arm the watchdog and
        # create an infinite dropout loop for genuinely-offline devices.
        device_id = payload.get("source", {}).get("device_id") or payload.get("device_id", "unknown")
        alert_type = payload.get("alert_type", "")
        if alert_type != "sensor_dropout":
            self._last_seen[device_id] = time.time()
            if hasattr(self, "_dropout_fired") and device_id in self._dropout_fired:
                self._dropout_fired.discard(device_id)

        # Cache zone/gateway/type so dropout alerts can include them
        if payload.get("alert_type") != "sensor_dropout":
            src = payload.get("source", {})
            cached: dict = {}
            zone = src.get("zone") or payload.get("zone", "")
            gw   = src.get("gateway_id") or payload.get("gateway_id", "")
            if zone:
                cached["zone"] = zone
            if gw:
                cached["gateway_id"] = gw
            st = resolve_sensor_type(payload)
            if st and st != "unknown":
                cached["sensor_type"] = st
            if cached:
                self._device_meta.setdefault(device_id, {}).update(cached)

        # Store alert
        alert_entry = {
            **payload,
            "received_at": datetime.now(timezone.utc).isoformat(),
            "manager_id": MANAGER_ID,
        }
        self._alerts.append(alert_entry)

        severity = payload.get("severity", "LOW")
        alert_type = payload.get("alert_type", "")
        sensor_type = resolve_sensor_type(payload)

        logger.info(f"📥 Alert received: [{severity}] {alert_type} device={device_id}")

        # Track in correlation window
        self._recent_alerts[sensor_type].append({
            "ts": time.time(),
            "severity": severity,
            "alert_id": payload.get("alert_id"),
            "payload": payload,
        })

        # Reclassify with context
        reclassified_severity = self._reclassify(payload, sensor_type, severity)

        # Take action based on reclassified severity
        if reclassified_severity in ("HIGH", "CRITICAL"):
            incident = self._create_incident(payload, reclassified_severity)
            self._handle_escalation(incident)

    def _reclassify(self, payload: dict, sensor_type: str, original_severity: str) -> str:
        """
        Context-aware reclassification.
        Rules (IEC 62443-2-1 aligned):
          1. If temp HIGH + gas MEDIUM within 30s → upgrade both to CRITICAL (fire risk)
          2. If motion + gas HIGH within 30s → CRITICAL (intruder + hazard)
          3. Single gas/temp HIGH without corroboration → keep HIGH
          4. MEDIUM without prior HIGH context → keep MEDIUM
        """
        now = time.time()
        cutoff = now - CORRELATION_WINDOW_SEC

        def recent_of_type(stype: str, min_severity: str) -> bool:
            sev_order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
            min_val = sev_order.get(min_severity, 0)
            for a in self._recent_alerts.get(stype, []):
                if a["ts"] >= cutoff and sev_order.get(a["severity"], 0) >= min_val:
                    return True
            return False

        # Rule 1: Temperature spike + recent gas anomaly → fire risk → CRITICAL
        if sensor_type == "temperature" and original_severity in ("HIGH", "CRITICAL"):
            if recent_of_type("gas", "MEDIUM"):
                logger.warning("🔥 Reclassify: temp HIGH + gas MEDIUM → CRITICAL (fire risk)")
                return "CRITICAL"

        # Rule 2: Gas anomaly + recent temperature HIGH → CRITICAL
        if sensor_type == "gas" and original_severity in ("HIGH", "CRITICAL"):
            if recent_of_type("temperature", "HIGH"):
                logger.warning("🔥 Reclassify: gas HIGH + temp HIGH → CRITICAL")
                return "CRITICAL"

        # Rule 3: Motion + gas HIGH → CRITICAL
        if sensor_type == "motion" and original_severity in ("HIGH", "CRITICAL"):
            if recent_of_type("gas", "HIGH"):
                logger.warning("⚠️  Reclassify: motion HIGH + gas HIGH → CRITICAL")
                return "CRITICAL"

        return original_severity

    def _create_incident(self, payload: dict, severity: str) -> dict:
        incident = {
            "incident_id": f"INC-IOT-{uuid.uuid4().hex[:8].upper()}",
            "created_at":  datetime.now(timezone.utc).isoformat(),
            "manager_id":  MANAGER_ID,
            "severity":    severity,
            "network_domain": "iot",
            "trigger_alert_id": payload.get("alert_id"),
            "device_id":   payload.get("source", {}).get("device_id", "unknown"),
            "alert_type":  payload.get("alert_type", ""),
            "details":     payload.get("details", {}),
            "status":      "pending_approval" if severity == "CRITICAL" else "auto_escalated",
            "recommended_actions": payload.get("recommended_actions", []),
        }
        self._incidents.append(incident)
        self._stats["incidents_created"] += 1
        logger.warning(f"📋 Incident created: {incident['incident_id']} [{severity}]")
        return incident

    def _handle_escalation(self, incident: dict):
        """Escalate to HQ or queue for operator approval."""
        severity = incident["severity"]

        if severity == "CRITICAL":
            # Queue for 60s operator approval window
            self._pending_approval[incident["incident_id"]] = {
                **incident,
                "approval_deadline": time.time() + APPROVAL_WINDOW_SEC,
            }
            logger.warning(
                f"⏳ CRITICAL incident {incident['incident_id']} queued for approval "
                f"(auto-escalates in {APPROVAL_WINDOW_SEC}s)"
            )
            # Start approval timeout thread
            threading.Thread(
                target=self._approval_timeout,
                args=(incident["incident_id"],),
                daemon=True,
            ).start()
        else:
            # HIGH → auto-escalate to HQ
            self._escalate_to_hq(incident)

    def _approval_timeout(self, incident_id: str):
        """Auto-escalate CRITICAL incident if not manually approved within window."""
        time.sleep(APPROVAL_WINDOW_SEC)
        if incident_id in self._pending_approval:
            incident = self._pending_approval.pop(incident_id)
            incident["status"] = "auto_escalated_after_timeout"
            logger.warning(f"⏰ Auto-escalating {incident_id} after {APPROVAL_WINDOW_SEC}s timeout")
            self._escalate_to_hq(incident)

    def _escalate_to_hq(self, incident: dict):
        """Publish incident to hq.incidents topic."""
        incident["status"] = "escalated_to_hq"
        incident["escalated_at"] = datetime.now(timezone.utc).isoformat()
        self._producer.publish(
            topic=Topics.HQ_INCIDENTS,
            payload=incident,
            key=incident["incident_id"],
        )
        self._stats["escalated_to_hq"] += 1
        logger.warning(f"🚀 Escalated to HQ: {incident['incident_id']} [{incident['severity']}]")

    # ─── Heartbeat watchdog ───────────────────────────────────────────────────

    def _heartbeat_watchdog(self):
        """
        Background thread. Checks every 5s if any device has gone silent.
        Publishes device_dropout alert to iot.alerts if timeout exceeded.
        """
        logger.info(f"💓 Heartbeat watchdog started (timeout={HEARTBEAT_TIMEOUT_SEC}s)")
        while True:
            time.sleep(5)
            now = time.time()
            if not hasattr(self, "_dropout_fired"):
                self._dropout_fired = set()
            for device_id, last in list(self._last_seen.items()):
                if now - last > HEARTBEAT_TIMEOUT_SEC:
                    if device_id in self._dropout_fired:
                        continue
                    self._dropout_fired.add(device_id)
                    self._stats["device_dropouts_detected"] += 1
                    meta = self._device_meta.get(device_id, {})
                    dropout_alert = {
                        "alert_id":    f"DROPOUT-{uuid.uuid4().hex[:8].upper()}",
                        "agent_id":    MANAGER_ID,
                        "agent_type":  "iot_local_manager",
                        "network_type": "iot",
                        "alert_type":  "sensor_dropout",
                        "severity":    "HIGH",
                        "confidence":  1.0,
                        "source": {
                            "device_id":   device_id,
                            "zone":        meta.get("zone", ""),
                            "gateway_id":  meta.get("gateway_id", ""),
                            "sensor_type": meta.get("sensor_type", ""),
                        },
                        "details": {
                            "last_seen_ago_sec": round(now - last, 1),
                            "timeout_threshold": HEARTBEAT_TIMEOUT_SEC,
                            "mitre_technique":   "T0829",  # Loss of View (ICS)
                        },
                        "recommended_actions": [
                            "check_pi_iot_hardware",
                            "verify_mqtt_connectivity",
                            "escalate_if_unresolved_after_60s",
                        ],
                    }
                    # Publish dropout as an alert so it flows through the pipeline
                    self._producer.publish(
                        topic=Topics.IOT_ALERTS,
                        payload=dropout_alert,
                        key=device_id,
                    )
                    logger.warning(
                        f"💀 DEVICE DROPOUT: {device_id} "
                        f"(silent for {round(now-last,1)}s)"
                    )
                    # Remove from tracking so we don't spam alerts
                    del self._last_seen[device_id]

    # ─── FastAPI endpoints ────────────────────────────────────────────────────

    def _build_api(self) -> FastAPI:
        app = FastAPI(title="IoT Local Manager API")

        @app.get("/health")
        def health():
            return JSONResponse({
                "manager_id": MANAGER_ID,
                "status":     "running",
                "timestamp":  datetime.now(timezone.utc).isoformat(),
                "stats":      self._stats,
            })

        @app.get("/alerts")
        def get_alerts(limit: int = 50):
            return JSONResponse(list(self._alerts)[-limit:])

        @app.get("/history")
        def history(limit: int = 200):
            """Read this domain's alert history from Postgres (read-only)."""
            limit = max(1, min(limit, 1000))
            conn = None
            try:
                import psycopg2, psycopg2.extras
                conn = psycopg2.connect(**PG_CONFIG)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        "SELECT alert_id,topic,agent_id,alert_type,severity,confidence,timestamp,payload "
                        "FROM alerts WHERE topic = %s ORDER BY timestamp DESC LIMIT %s",
                        (HISTORY_TOPIC, limit))
                    rows = cur.fetchall()
                for r in rows:
                    if r.get("timestamp") is not None:
                        r["timestamp"] = r["timestamp"].isoformat()
                return JSONResponse(rows)
            except Exception as e:
                logger.error(f"History query failed: {e}")
                return JSONResponse([])
            finally:
                if conn:
                    conn.close()

        @app.get("/incidents")
        def get_incidents():
            """Dashboard compat: returns sensor readings (the dashboard maps
            /iot-manager/incidents → STATE.sensors for the IoT sensor grid).
            Real incidents are at /raw-incidents.
            """
            # Key: (device_id, stype) — DHT22 sends both temperature and humidity
            # from the same device_id; keying by device_id alone would lose one.
            best: dict = {}    # (device_id, stype) -> latest non-dropout alert
            dropout: dict = {} # device_id          -> latest dropout alert
            for a in reversed(list(self._alerts)):  # newest first
                atype = a.get("alert_type", "")
                src = a.get("source", {})
                did = src.get("device_id") or a.get("device_id", "")
                if not did:
                    continue
                if atype == "sensor_dropout":
                    dropout.setdefault(did, a)
                else:
                    stype = resolve_sensor_type(a)
                    best.setdefault((did, stype), a)

            SENSOR_THRESHOLDS = {
                "temperature": {"warn": 35,  "critical": 50},
                "humidity":    {"warn": 80,  "critical": 90},
                "gas":         {"warn": 300, "critical": 500},
                "motion":      {"warn": 0.5, "critical": 1.0},
                "cpu_temp":    {"warn": 70,  "critical": 80},
            }
            sensors = []
            seen_dids: set = set()

            # One card per (device_id, stype) from real readings
            for (did, stype), a in best.items():
                seen_dids.add(did)
                src = a.get("source", {})
                det = a.get("details", {})
                atype = a.get("alert_type", "")
                sev = a.get("severity", "LOW")
                if "value" in det:
                    val = det["value"]
                elif "value" in a:
                    val = a["value"]
                elif "motion" in atype:
                    val = 1 if "detected" in atype else 0
                else:
                    val = 0
                unit = det.get("unit") or a.get("unit") or ("bool" if stype == "motion" else "")
                status = ("ALERT" if sev in ("HIGH", "CRITICAL")
                          else "ELEVATED" if sev == "MEDIUM" else "NORMAL")
                sensor_id = f"{did}-HUM" if stype == "humidity" else did
                sensors.append({
                    "id":        sensor_id,
                    "sensor_id": sensor_id,
                    "name":      sensor_id.replace("-", " ").title(),
                    "type":      stype,
                    "value":     val,
                    "unit":      unit,
                    "status":    status,
                    "severity":  sev,
                    "zone":      src.get("zone") or a.get("zone", ""),
                    "pi_id":     src.get("gateway_id") or a.get("gateway_id", "pi-iot-01"),
                    "timestamp": a.get("timestamp", a.get("received_at", "")),
                    "threshold": SENSOR_THRESHOLDS.get(stype, {}),
                    "alert_type": atype,
                    "offline":   False,
                    "precision": 1,
                })

            # OFFLINE cards for devices with dropout but no live reading
            for did, a in dropout.items():
                if did in seen_dids:
                    continue
                src = a.get("source", {})
                atype = a.get("alert_type", "")
                stype = resolve_sensor_type(a)
                sensors.append({
                    "id":        did,
                    "sensor_id": did,
                    "name":      did.replace("-", " ").title(),
                    "type":      stype,
                    "value":     0,
                    "unit":      "",
                    "status":    "OFFLINE",
                    "severity":  "HIGH",
                    "zone":      src.get("zone") or a.get("zone", ""),
                    "pi_id":     src.get("gateway_id") or a.get("gateway_id", "pi-iot-01"),
                    "timestamp": a.get("timestamp", a.get("received_at", "")),
                    "threshold": SENSOR_THRESHOLDS.get(stype, {}),
                    "alert_type": atype,
                    "offline":   True,
                    "precision": 1,
                })

            return JSONResponse(sensors)

        @app.get("/raw-incidents")
        def get_raw_incidents():
            return JSONResponse(self._incidents)

        @app.get("/sensors")
        def get_sensors():
            """Return latest sensor reading per device in dashboard-compatible shape.
            The dashboard expects: {id, sensor_id, value, unit, type, name, status, zone, pi_id}
            Active sensors show their latest reading; sensors with only dropout alerts show as OFFLINE.
            """
            # Key: (device_id, sensor_type) — DHT22 sends both temperature and humidity
            # from the same device_id, so keying by device_id alone loses one reading.
            latest: dict  = {}   # (device_id, stype) -> latest telemetry msg
            dropout: dict = {}   # device_id -> latest dropout msg

            SENSOR_THRESHOLDS = {
                "temperature": {"warn": 35,  "critical": 50},
                "humidity":    {"warn": 80,  "critical": 90},
                "gas":         {"warn": 300, "critical": 500},
                "motion":      {"warn": 0.5, "critical": 1.0},
                "cpu_temp":    {"warn": 70,  "critical": 80},
            }

            for a in self._alerts:
                src = a.get("source", {})
                did = src.get("device_id") or a.get("device_id", "")
                if not did:
                    continue
                if did.lower().startswith("rogue"):
                    continue
                stype = resolve_sensor_type(a)
                if a.get("alert_type") == "sensor_dropout":
                    if did not in dropout or a.get("timestamp", "") > dropout[did].get("timestamp", ""):
                        dropout[did] = a
                else:
                    key = (did, stype)
                    if key not in latest or a.get("timestamp", "") > latest[key].get("timestamp", ""):
                        latest[key] = a

            sensors = []
            # Track which device_ids have live readings (to skip their dropout cards)
            live_dids = {did for (did, _) in latest}

            for (did, stype), a in latest.items():
                src = a.get("source", {})
                det = a.get("details", {})
                val  = det.get("value") if "value" in det else a.get("value", 0)
                unit = det.get("unit") or a.get("unit", "")
                sev  = a.get("severity", "LOW")
                if sev in ("HIGH", "CRITICAL"):
                    status = "ALERT"
                elif sev == "MEDIUM":
                    status = "ELEVATED"
                else:
                    status = "NORMAL"
                thr = SENSOR_THRESHOLDS.get(stype, {})
                # Give humidity readings a distinct sensor_id so the dashboard renders two cards
                sensor_id = f"{did}-HUM" if stype == "humidity" else did
                sensors.append({
                    "id":         sensor_id,
                    "sensor_id":  sensor_id,
                    "name":       sensor_id.replace("-", " ").title(),
                    "type":       stype,
                    "value":      val,
                    "unit":       unit,
                    "status":     status,
                    "severity":   sev,
                    "zone":       src.get("zone") or a.get("zone", ""),
                    "pi_id":      src.get("gateway_id") or a.get("gateway_id", "pi-iot-01"),
                    "timestamp":  a.get("timestamp", ""),
                    "threshold":  thr,
                    "alert_type": a.get("alert_type", ""),
                    "precision":  1,
                })
            # Sensors with only dropout entries and no live reading → OFFLINE
            for did, a in dropout.items():
                if did in live_dids:
                    continue
                src   = a.get("source", {})
                stype = resolve_sensor_type(a)
                thr   = SENSOR_THRESHOLDS.get(stype, {})
                sensors.append({
                    "id":         did,
                    "sensor_id":  did,
                    "name":       did.replace("-", " ").title(),
                    "type":       stype,
                    "value":      None,
                    "unit":       a.get("unit", ""),
                    "status":     "OFFLINE",
                    "severity":   "LOW",
                    "zone":       src.get("zone") or a.get("zone", ""),
                    "pi_id":      src.get("gateway_id") or a.get("gateway_id", "pi-iot-01"),
                    "timestamp":  a.get("timestamp", ""),
                    "threshold":  thr,
                    "alert_type": "sensor_dropout",
                    "precision":  1,
                })
            return JSONResponse(sensors)

        @app.get("/devices")
        def get_devices():
            now = time.time()
            return JSONResponse({
                d: {"last_seen_ago_sec": round(now - ts, 1), "status": "online"}
                for d, ts in self._last_seen.items()
            })

        @app.get("/pending")
        def get_pending():
            return JSONResponse(list(self._pending_approval.values()))

        @app.post("/approve/{incident_id}")
        def approve(incident_id: str):
            if incident_id not in self._pending_approval:
                raise HTTPException(status_code=404, detail="Incident not found or already processed")
            incident = self._pending_approval.pop(incident_id)
            incident["status"] = "manually_approved"
            self._escalate_to_hq(incident)
            return JSONResponse({"approved": True, "incident_id": incident_id})

        @app.post("/dismiss/{incident_id}")
        def dismiss(incident_id: str):
            if incident_id not in self._pending_approval:
                raise HTTPException(status_code=404, detail="Incident not found or already processed")
            self._pending_approval[incident_id]["status"] = "dismissed_by_operator"
            del self._pending_approval[incident_id]
            return JSONResponse({"dismissed": True, "incident_id": incident_id})

        return app

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    def start(self):
        self._hb.start()

        # Device heartbeat watchdog thread
        threading.Thread(
            target=self._heartbeat_watchdog,
            daemon=True,
            name="heartbeat-watchdog",
        ).start()

        # Kafka consumer thread
        threading.Thread(
            target=self._consumer.poll_loop,
            args=(self.handle_alert,),
            daemon=True,
            name="iot-consumer",
        ).start()

        logger.info(f"▶️  IoT Local Manager running — API on :{HEALTH_PORT}")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        logger.info("🛑 Stopping IoT Local Manager")
        self._hb.stop()
        self._consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    manager = IoTLocalManager()
    try:
        manager.start()
    except KeyboardInterrupt:
        manager.stop()
