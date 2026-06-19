"""
IoT Fire System Agent — agents/iot/fire_system_agent/main.py

Role: MONITOR (with local hardware actuation)

A dedicated fire-detection monitor that fuses temperature + smoke/gas telemetry.
Where the gateway treats each sensor in isolation and the behavioral agent looks
for statistical drift, this agent answers one focused question: "is there a fire?"
Confirmation requires HEAT + SMOKE together within a short correlation window —
the same two-of-two logic a real flame/heat+smoke detector uses to avoid nuisance
trips.

Consumes:  iot.telemetry   (temperature + gas readings — from gateway/simulator/Pi)
Publishes: iot.alerts      (fire alerts — consumed by the IoT Local Manager, so
                            this agent is fully blended into the network manager)
Actuates:  GPIO relay      (real buzzer/sprinkler relay on a Raspberry Pi; logs a
                            simulated trip when no GPIO backend is present)
Health:    GET /health     (port 8009)

Standards:
  - NIST SP 800-82  — ICS monitoring
  - NFPA 72 (concept) — multi-criteria fire detection (heat + smoke)
  - MITRE ATT&CK for ICS — T0879 (Damage to Property), T0826 (Loss of Availability)
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from common.kafka_client import KafkaConsumerClient, KafkaProducerClient, Topics
from common.models import Alert, SeverityLevel
from common.sensor_types import canonical_sensor_type

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("fire_system_agent")

AGENT_ID            = os.getenv("AGENT_ID",            "fire-system-agent-01")
BOOTSTRAP           = os.getenv("KAFKA_BOOTSTRAP",     "localhost:9092")
HEALTH_PORT         = int(os.getenv("HEALTH_PORT",     "8009"))

# Fire thresholds (overridable via env for different rooms / sensors)
FIRE_TEMP_HIGH      = float(os.getenv("FIRE_TEMP_HIGH",     "50.0"))   # °C — heat
FIRE_GAS_HIGH       = float(os.getenv("FIRE_GAS_HIGH",      "400.0"))  # ppm — smoke (analog MQ sensors)
# Events within this window count as "simultaneous" for heat+smoke fusion
FIRE_CORRELATION_SEC = float(os.getenv("FIRE_CORRELATION_SEC", "30"))
# After a confirmed fire we hold the relay ON for this long, then auto-release
FIRE_RELAY_HOLD_SEC  = float(os.getenv("FIRE_RELAY_HOLD_SEC",  "30"))
# Don't re-publish the same fire alert more often than this (anti-spam)
FIRE_ALERT_COOLDOWN_SEC = float(os.getenv("FIRE_ALERT_COOLDOWN_SEC", "15"))
# BCM pin driving the relay/buzzer. Distinct from the sensor reader's pins
# (17/27/18) so the two host processes never fight over a line.
FIRE_RELAY_PIN      = int(os.getenv("FIRE_RELAY_PIN",  "23"))

# ─── GPIO relay (graceful: real on a Pi, simulated everywhere else) ────────────
class FireRelay:
    """
    Drives a physical relay/buzzer via gpiozero when a backend is available
    (Raspberry Pi). On any import/instantiation failure — e.g. inside a plain
    container or on a dev laptop — it degrades to logging the actions so the
    detection pipeline keeps working unchanged.
    """

    def __init__(self, pin: int):
        self.pin = pin
        self.engaged = False
        self._device = None
        self._real = False
        try:
            from gpiozero import OutputDevice  # type: ignore
            self._device = OutputDevice(pin, active_high=True, initial_value=False)
            self._real = True
            logger.info(f"🔌 GPIO relay armed on BCM pin {pin} (real hardware)")
        except Exception as e:  # noqa: BLE001 — any GPIO/backend error → simulate
            logger.warning(f"⚠️  GPIO unavailable ({e}); relay runs in SIMULATED mode")

    def engage(self):
        self.engaged = True
        if self._real and self._device is not None:
            try:
                self._device.on()
                logger.error(f"🚒 RELAY ENGAGED on pin {self.pin} — suppression/alarm ON")
                return
            except Exception as e:  # noqa: BLE001
                logger.error(f"❌ Relay engage failed on pin {self.pin}: {e}")
                return
        logger.error(f"🚒 [SIMULATED] RELAY ENGAGED on pin {self.pin} — suppression/alarm ON")

    def release(self):
        self.engaged = False
        if self._real and self._device is not None:
            try:
                self._device.off()
                logger.info(f"🔻 Relay released on pin {self.pin}")
                return
            except Exception as e:  # noqa: BLE001
                logger.error(f"❌ Relay release failed on pin {self.pin}: {e}")
                return
        logger.info(f"🔻 [SIMULATED] Relay released on pin {self.pin}")

    @property
    def mode(self) -> str:
        return "hardware" if self._real else "simulated"


# ─── Fire detection agent ──────────────────────────────────────────────────────
class FireSystemAgent:

    def __init__(self):
        logger.info(f"🚀 Starting Fire System Agent {AGENT_ID}")

        # Latest heat/smoke reading per zone: {zone: (value, ts, is_high, raw)}
        self._temp: Dict[str, dict] = {}
        self._gas:  Dict[str, dict] = {}

        # Per-zone cooldown so a sustained fire doesn't flood iot.alerts
        self._last_alert_ts: Dict[str, float] = {}
        self._relay = FireRelay(FIRE_RELAY_PIN)
        self._relay_release_timer: Optional[threading.Timer] = None
        self._fire_events: deque = deque(maxlen=50)

        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._consumer = KafkaConsumerClient(
            AGENT_ID, [Topics.IOT_TELEMETRY], BOOTSTRAP
        )
        self._stats = {
            "processed": 0,
            "heat_high": 0,
            "smoke_high": 0,
            "fires_confirmed": 0,
            "alerts_published": 0,
        }
        self._app = self._build_app()
        logger.info("✅ Fire System Agent ready")

    # ── Telemetry handling ────────────────────────────────────────────────────

    def _is_gas_high(self, value: float, unit: str) -> bool:
        """
        MQ-2 on the real Pi is wired as a *digital* sensor (value 0/1), while the
        simulator emits analog ppm. Handle both: digital→trip on 1, analog→ppm.
        """
        u = (unit or "").strip().lower()
        if u in ("digital", "binary", "bool", "boolean"):
            return value >= 1
        return value >= FIRE_GAS_HIGH

    def handle_message(self, topic: str, payload: dict):
        self._stats["processed"] += 1
        unit = payload.get("unit", "")
        sensor = canonical_sensor_type(payload.get("device_type", ""), unit)
        if sensor not in ("temperature", "gas"):
            return  # not a fire-relevant sensor (motion / humidity / telemetry)

        try:
            value = float(payload.get("value", 0.0))
        except (TypeError, ValueError):
            return

        zone = payload.get("zone") or payload.get("gateway_id") or "default"
        now = time.time()

        if sensor == "temperature":
            is_high = value >= FIRE_TEMP_HIGH
            self._temp[zone] = {"value": value, "ts": now, "high": is_high, "raw": payload}
            if is_high:
                self._stats["heat_high"] += 1
        else:  # gas / smoke
            is_high = self._is_gas_high(value, unit)
            self._gas[zone] = {"value": value, "ts": now, "high": is_high, "raw": payload, "unit": unit}
            if is_high:
                self._stats["smoke_high"] += 1

        self._evaluate(zone, now)

    def _recent_high(self, store: Dict[str, dict], zone: str, now: float) -> Optional[dict]:
        rec = store.get(zone)
        if rec and rec["high"] and (now - rec["ts"]) <= FIRE_CORRELATION_SEC:
            return rec
        return None

    def _evaluate(self, zone: str, now: float):
        """
        Fire fusion logic:
          • HEAT high AND SMOKE high within the correlation window → CRITICAL fire
            (two-of-two confirmation) → publish + engage relay.
          • HEAT high alone                → HIGH overheat warning (no relay).
          • SMOKE high alone               → HIGH smoke warning (no relay).
        """
        hot   = self._recent_high(self._temp, zone, now)
        smoke = self._recent_high(self._gas,  zone, now)

        if hot and smoke:
            self._raise_fire(zone, hot, smoke)
        elif hot:
            self._raise_warning(zone, "overheat", hot, smoke=None)
        elif smoke:
            self._raise_warning(zone, "smoke_detected", hot=None, smoke=smoke)

    # ── Alerting + actuation ──────────────────────────────────────────────────

    def _cooled_down(self, zone: str, now: float) -> bool:
        last = self._last_alert_ts.get(zone, 0.0)
        if now - last < FIRE_ALERT_COOLDOWN_SEC:
            return False
        self._last_alert_ts[zone] = now
        return True

    def _raise_fire(self, zone: str, hot: dict, smoke: dict):
        now = time.time()
        # Engage the relay immediately on every confirmation (refresh the hold),
        # but rate-limit the published alert.
        self._engage_relay()
        self._stats["fires_confirmed"] += 1
        if not self._cooled_down(zone, now):
            return

        details = {
            "detection_logic":   "heat+smoke_2of2",
            "temperature_c":     hot["value"],
            "temp_threshold_c":  FIRE_TEMP_HIGH,
            "gas_value":         smoke["value"],
            "gas_unit":          smoke.get("unit", ""),
            "gas_threshold_ppm": FIRE_GAS_HIGH,
            "correlation_sec":   FIRE_CORRELATION_SEC,
            "relay_pin":         FIRE_RELAY_PIN,
            "relay_mode":        self._relay.mode,
            "mitre_technique":   "T0879",
        }
        self._publish_alert(
            zone=zone, alert_type="fire_detected", severity=SeverityLevel.CRITICAL,
            confidence=0.97, details=details, raw=smoke["raw"],
            actions=["activate_suppression", "trigger_evacuation_alarm",
                     "dispatch_fire_response", "notify_local_iot_manager"],
        )
        self._fire_events.append({"zone": zone, "at": datetime.now(timezone.utc).isoformat(),
                                  **details})
        logger.critical(f"🔥🔥 FIRE CONFIRMED in {zone}: "
                        f"{hot['value']}°C + smoke {smoke['value']} — relay engaged")

    def _raise_warning(self, zone: str, kind: str, hot: Optional[dict], smoke: Optional[dict]):
        now = time.time()
        if not self._cooled_down(zone + ":" + kind, now):
            return
        src = hot or smoke
        details = {
            "detection_logic": "single_criterion",
            "criterion":       kind,
            "value":           src["value"],
            "relay_mode":      self._relay.mode,
            "mitre_technique": "T0826",
        }
        self._publish_alert(
            zone=zone, alert_type=kind, severity=SeverityLevel.HIGH,
            confidence=0.85, details=details, raw=src["raw"],
            actions=["investigate_zone", "notify_local_iot_manager"],
        )
        logger.warning(f"⚠️  {kind.upper()} in {zone}: value={src['value']}")

    def _publish_alert(self, zone, alert_type, severity, confidence, details, raw, actions):
        device_id = raw.get("device_id", "unknown")
        alert = Alert(
            alert_id=str(uuid.uuid4()),
            agent_id=AGENT_ID,
            agent_type="fire_detection",
            network_type="iot",
            alert_type=alert_type,
            severity=severity,
            confidence=confidence,
            source={
                "device_id":   device_id,
                "zone":        zone,
                "gateway_id":  raw.get("gateway_id", ""),
                "sensor_type": "fire_system",
            },
            details=details,
            recommended_actions=actions,
        )
        self._producer.publish(Topics.IOT_ALERTS, alert.model_dump(mode="json"), key=zone)
        self._stats["alerts_published"] += 1

    def _engage_relay(self):
        self._relay.engage()
        # (Re)start the auto-release hold timer.
        if self._relay_release_timer is not None:
            self._relay_release_timer.cancel()
        self._relay_release_timer = threading.Timer(FIRE_RELAY_HOLD_SEC, self._relay.release)
        self._relay_release_timer.daemon = True
        self._relay_release_timer.start()

    # ── FastAPI ───────────────────────────────────────────────────────────────

    def _build_app(self) -> FastAPI:
        app = FastAPI(title="Fire System Agent")

        @app.get("/health")
        def health():
            return JSONResponse({
                "agent_id":   AGENT_ID,
                "role":       "monitor",
                "status":     "running",
                "timestamp":  datetime.now(timezone.utc).isoformat(),
                "stats":      self._stats,
                "relay":      {"pin": FIRE_RELAY_PIN, "mode": self._relay.mode,
                               "engaged": self._relay.engaged},
                "thresholds": {"temp_high_c": FIRE_TEMP_HIGH, "gas_high_ppm": FIRE_GAS_HIGH,
                               "correlation_sec": FIRE_CORRELATION_SEC},
            })

        @app.get("/status")
        def status():
            return JSONResponse({
                "latest_temperature": self._temp,
                "latest_gas":         self._gas,
                "recent_fires":       list(self._fire_events),
            })

        @app.post("/relay/reset")
        def relay_reset():
            if self._relay_release_timer is not None:
                self._relay_release_timer.cancel()
            self._relay.release()
            return JSONResponse({"relay_engaged": self._relay.engaged})

        return app

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        threading.Thread(
            target=self._consumer.poll_loop,
            args=(self.handle_message,),
            daemon=True, name="fire-consumer",
        ).start()
        logger.info(f"▶️  Fire System Agent — health :{HEALTH_PORT}/health "
                    f"(relay={self._relay.mode})")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        if self._relay_release_timer is not None:
            self._relay_release_timer.cancel()
        self._relay.release()
        self._consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    agent = FireSystemAgent()
    try:
        agent.start()
    except KeyboardInterrupt:
        agent.stop()
