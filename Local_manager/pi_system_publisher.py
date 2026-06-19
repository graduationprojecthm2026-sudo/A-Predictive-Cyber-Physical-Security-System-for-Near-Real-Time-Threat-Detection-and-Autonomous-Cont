"""
pi_system_publisher.py — publishes Pi board CPU temperature to Kafka iot.telemetry.

Run this on the Raspberry Pi (alongside gateway_agent). It reads the SoC temperature
from the Linux thermal subsystem and publishes it every PUBLISH_INTERVAL_SEC seconds
so the IoT local manager can surface it in the sensor grid and Pi node card.

Usage:
  python3 pi_system_publisher.py
  KAFKA_BOOTSTRAP=192.168.60.10:9092 python3 pi_system_publisher.py

Environment variables:
  KAFKA_BOOTSTRAP         Kafka broker address  (default: 192.168.60.10:9092)
  PI_DEVICE_ID            Device ID for this Pi (default: PI-IOT-01-CPU)
  GATEWAY_ID              Gateway ID            (default: GW-ACADEMIC-F1-01)
  ZONE                    Physical zone         (default: Academic/Floor1/LabA)
  PUBLISH_INTERVAL_SEC    How often to publish  (default: 10)
"""

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root))

from common.kafka_client import KafkaProducerClient, Topics

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("pi_system_publisher")

BOOTSTRAP        = os.getenv("KAFKA_BOOTSTRAP",        "192.168.60.10:9092")
DEVICE_ID        = os.getenv("PI_DEVICE_ID",           "PI-IOT-01-CPU")
GATEWAY_ID       = os.getenv("GATEWAY_ID",             "GW-ACADEMIC-F1-01")
ZONE             = os.getenv("ZONE",                   "Academic/Floor1/LabA")
INTERVAL         = int(os.getenv("PUBLISH_INTERVAL_SEC", "10"))
THERMAL_PATH     = "/sys/class/thermal/thermal_zone0/temp"

WARN_THRESHOLD   = 70.0  # °C — matches SENSOR_THRESHOLDS in iot_local_manager
CRIT_THRESHOLD   = 80.0  # °C


def read_cpu_temp() -> float:
    """Read Pi SoC temperature from Linux thermal subsystem (millidegrees → °C)."""
    with open(THERMAL_PATH) as f:
        return round(int(f.read().strip()) / 1000.0, 1)


def main():
    producer = KafkaProducerClient(BOOTSTRAP)
    seq = 0
    logger.info(f"Pi system publisher started — CPU temp every {INTERVAL}s → {BOOTSTRAP}")

    while True:
        try:
            temp = read_cpu_temp()
            seq += 1
            severity = "HIGH" if temp >= CRIT_THRESHOLD else "MEDIUM" if temp >= WARN_THRESHOLD else "LOW"
            payload = {
                "device_id":   DEVICE_ID,
                "device_type": "cpu_temp",
                "zone":        ZONE,
                "value":       temp,
                "unit":        "celsius",
                "gateway_id":  GATEWAY_ID,
                "seq":         seq,
                "timestamp":   datetime.now(timezone.utc).isoformat(),
                "severity":    severity,
            }
            producer.publish(Topics.IOT_TELEMETRY, payload, key=DEVICE_ID)
            logger.info(f"CPU temp: {temp}°C  severity={severity}  seq={seq}")
        except FileNotFoundError:
            logger.error(f"Thermal file not found: {THERMAL_PATH} — is this running on the Pi?")
        except Exception as e:
            logger.error(f"Publish error: {e}")

        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
