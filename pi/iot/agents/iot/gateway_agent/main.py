"""
IoT Gateway Agent — agents/iot/gateway_agent/main.py
Receives MQTT sensor data, validates, classifies risk, sends alerts to Kafka.
"""
import logging
import os
import signal
import sys
import threading
import time
import yaml
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

# Project root is 4 levels up from this file
project_root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from common.kafka_client import ensure_topics, KafkaProducerClient, Topics
from common.models import SeverityLevel
from common.mqtt_client import SecureMQTTClient
from agents.iot.gateway_agent.classifier import RiskClassifier
from agents.iot.gateway_agent.communicator import AlertCommunicator
from agents.iot.gateway_agent.validator import SensorValidator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("gateway_agent.log")],
)
logger = logging.getLogger("gateway_agent")

_STOP_EVENT = threading.Event()


class GatewayAgent:
    def __init__(self, config_path: str):
        logger.info("🚀 Starting Gateway Agent...")
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        self.agent_id = self.config["gateway"]["id"]
        logger.info(f"📍 Agent ID: {self.agent_id}  Location: {self.config['gateway']['location']}  MQTT_BROKER env={os.getenv('MQTT_BROKER','(not set)')}")

        self.validator    = SensorValidator(self.config)
        self.classifier   = RiskClassifier(self.config)
        self.communicator = AlertCommunicator(self.config, self.agent_id)

        mqtt_cfg = self.config["mqtt"]
        tls_cfg  = mqtt_cfg.get("tls", {})
        # MQTT_BROKER env (set by docker-compose to "campus-mosquitto") takes
        # priority over config.yaml so the gateway works both inside and outside Docker.
        mqtt_broker = os.getenv("MQTT_BROKER") or mqtt_cfg["broker"]
        self.mqtt = SecureMQTTClient(
            client_id=self.agent_id,
            broker_host=mqtt_broker,
            broker_port=mqtt_cfg.get("port", 8883),
            ca_cert=tls_cfg.get("ca_cert") or tls_cfg.get("ca"),
            client_cert=tls_cfg.get("client_cert") or tls_cfg.get("cert"),
            client_key=tls_cfg.get("client_key") or tls_cfg.get("key"),
        )
        self.mqtt.set_message_callback(self._handle)
        self.stats = {"received": 0, "valid": 0, "invalid": 0, "alerts": 0, "devices": {}}

        bootstrap = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
        self._hb_producer = KafkaProducerClient(bootstrap)
        self._hb_interval = int(os.getenv("HEARTBEAT_INTERVAL_SEC", "30"))
        logger.info("✅ Gateway Agent initialized")

    def _handle(self, topic: str, payload: dict):
        self.stats["received"] += 1
        ok, reason, reading = self.validator.validate(payload)
        if not ok:
            self.stats["invalid"] += 1
            logger.warning(f"⚠️  Invalid msg: {reason} device={payload.get('device_id','?')}")
            # Security: treat sequence anomaly and unknown devices as potential attacks
            if reason in ("unauthorized_device", "sequence_anomaly"):
                logger.error(f"🚨 Possible attack: {reason} from {payload.get('device_id','?')}")
            return

        self.stats["valid"] += 1
        self.stats["devices"][reading.device_id] = self.stats["devices"].get(reading.device_id, 0) + 1

        severity, confidence, details = self.classifier.classify(reading)
        logger.info(f"📊 {reading.device_id} → {severity.value} conf={confidence:.2f}")

        # Always forward the raw reading to iot.telemetry so the downstream
        # monitors (behavioral + fire) see the COMPLETE stream — including the
        # high readings — not just the ones classified LOW.
        self.communicator.send_telemetry(reading, severity, {})

        # Additionally raise an alert when the reading is actionable.
        if severity in (SeverityLevel.HIGH, SeverityLevel.CRITICAL):
            self.communicator.send_alert(reading, severity, confidence, details)
            self.stats["alerts"] += 1
            logger.warning(f"🚨 {severity.value} alert — {reading.device_id} val={reading.value}")
        elif severity == SeverityLevel.MEDIUM:
            self.communicator.send_alert(reading, severity, confidence, details)
            self.stats["alerts"] += 1

        if self.stats["received"] % 10 == 0:
            logger.info(f"📊 Stats: {self.stats}")

    def _build_app(self) -> FastAPI:
        app = FastAPI(title="Gateway Agent")

        @app.get("/health")
        def health():
            return JSONResponse({
                "agent_id":  self.agent_id,
                "status":    "running",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stats":     self.stats,
                "mqtt_connected": self.mqtt.connected,
                "kafka_enabled":  self.communicator.enabled,
            })

        return app

    def _heartbeat_loop(self):
        logger.info(f"💓 Heartbeat thread started (interval={self._hb_interval}s)")
        while not _STOP_EVENT.is_set():
            payload = {
                "agent_id":   self.agent_id,
                "agent_type": "iot_gateway",
                "status":     "running",
                "timestamp":  datetime.now(timezone.utc).isoformat(),
                "stats":      self.stats,
            }
            self._hb_producer.publish(Topics.HEARTBEATS, payload, key=self.agent_id)
            logger.debug(f"💓 Heartbeat sent → {Topics.HEARTBEATS}")
            _STOP_EVENT.wait(self._hb_interval)

    def start(self):
        logger.info("▶️  Connecting to MQTT...")
        self.mqtt.connect()
        topic = self.config["mqtt"]["topics"]["subscribe"]
        self.mqtt.subscribe(topic)
        logger.info(f"✅ Listening on {topic}  — Ctrl+C to stop")

        health_port = int(os.getenv("HEALTH_PORT", "8000"))
        app = self._build_app()
        threading.Thread(
            target=uvicorn.run,
            kwargs={"app": app, "host": "0.0.0.0", "port": health_port, "log_level": "warning"},
            daemon=True,
            name="gateway-health",
        ).start()

        threading.Thread(
            target=self._heartbeat_loop,
            daemon=True,
            name="gateway-heartbeat",
        ).start()

        _STOP_EVENT.wait()   # blocks cleanly; no busy loop

    def stop(self):
        logger.info("🛑 Stopping Gateway Agent...")
        logger.info(f"📊 Final stats: {self.stats}")
        self.mqtt.disconnect()
        self.communicator.close()
        self._hb_producer.close()
        _STOP_EVENT.set()
        logger.info("👋 Gateway Agent stopped")


def main():
    config_path = os.path.join(os.path.dirname(__file__), "config.yaml")
    agent = GatewayAgent(config_path)

    def _sig(sig, frame):
        agent.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)
    agent.start()


if __name__ == "__main__":
    main()
