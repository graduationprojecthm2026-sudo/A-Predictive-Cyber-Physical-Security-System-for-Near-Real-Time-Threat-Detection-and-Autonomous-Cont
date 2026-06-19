"""agents/iot/gateway_agent/communicator.py — fixed to use shared Kafka client."""
from __future__ import annotations
import logging
import os
import uuid
from typing import Dict, Optional
from common.kafka_client import KafkaProducerClient, Topics
from common.models import Alert, SensorReading, SeverityLevel
from common.sensor_types import canonical_sensor_type


class AlertCommunicator:
    def __init__(self, config: Dict, agent_id: str):
        self.agent_id = agent_id
        kafka_cfg = config.get("kafka", {})
        # KAFKA_BOOTSTRAP env (set by docker-compose) wins over config.yaml,
        # matching how behavioral_agent and the local manager resolve the broker.
        env_bootstrap = os.getenv("KAFKA_BOOTSTRAP")
        bootstrap = env_bootstrap or kafka_cfg.get("bootstrap_servers", "localhost:9092")
        # Enabled if config says so OR an explicit broker was provided via env.
        self.enabled = bool(kafka_cfg.get("enabled", False)) or bool(env_bootstrap)
        if self.enabled:
            logging.getLogger("gateway_agent").info(f"📡 Kafka enabled → {bootstrap}")
        self._producer: Optional[KafkaProducerClient] = KafkaProducerClient(bootstrap) if self.enabled else None

    def send_alert(self, reading: SensorReading, severity: SeverityLevel,
                   confidence: float, details: Dict) -> bool:
        sensor_type = canonical_sensor_type(reading.device_type, reading.unit) or reading.device_type.lower()
        alert = Alert(
            alert_id=str(uuid.uuid4()),
            agent_id=self.agent_id,
            agent_type="iot_gateway",
            network_type="iot",
            alert_type=f"{sensor_type}_anomaly",
            severity=severity,
            confidence=confidence,
            source={"device_id": reading.device_id, "zone": reading.zone, "gateway_id": reading.gateway_id, "sensor_type": sensor_type},
            details=details,
            recommended_actions=["notify_security"] if severity != SeverityLevel.LOW else [],
        )
        payload = alert.model_dump(mode="json")
        if self.enabled and self._producer:
            ok = self._producer.publish(Topics.IOT_ALERTS, payload, key=reading.device_id)
            if ok:
                import logging; logging.getLogger("gateway_agent").info(
                    f"🚨 Kafka alert sent sev={severity.value} topic={Topics.IOT_ALERTS}")
            return ok
        import logging; logging.getLogger("gateway_agent").info(f"ALERT (Kafka disabled) >> {payload}")
        return True

    def send_telemetry(self, reading: SensorReading, severity: SeverityLevel, extra: Dict) -> bool:
        sensor_type = canonical_sensor_type(reading.device_type, reading.unit) or reading.device_type.lower()
        event = {
            "device_id": reading.device_id, "device_type": reading.device_type,
            "sensor_type": sensor_type,
            "zone": reading.zone, "value": reading.value, "unit": reading.unit,
            "gateway_id": reading.gateway_id, "seq": reading.seq,
            "timestamp": reading.timestamp.isoformat(), "severity": severity.value, **extra,
        }
        if self.enabled and self._producer:
            return self._producer.publish(Topics.IOT_TELEMETRY, event, key=reading.device_id)
        return True

    def close(self):
        if self._producer:
            self._producer.close()
