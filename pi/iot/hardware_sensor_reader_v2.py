"""
hardware_sensor_reader_v2.py
─────────────────────────────────────────────────────
Real GPIO → MQTT bridge. Run this after Docker stack is up.

Wiring:
  DHT22  DATA → GPIO 17 (PIN 11)   VCC → 3.3V (PIN 1)   GND → GND
  MQ-2   DO   → GPIO 27 (PIN 13)   VCC → 5V   (PIN 2)   GND → GND
  PIR    OUT  → GPIO 18 (PIN 12)   VCC → 5V   (PIN 4)   GND → GND
         (PIR is optional — skipped automatically if not connected)

Run:
    cd ~/agents-test && source .venv/bin/activate
    python3 hardware_sensor_reader_v2.py
    python3 hardware_sensor_reader_v2.py --broker localhost --port 1883
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root))

try:
    import board
    import adafruit_dht
    import lgpio
except ImportError as e:
    print(f"Missing GPIO library: {e}")
    print("Run: pip install adafruit-circuitpython-dht board")
    print("And: sudo apt install python3-lgpio")
    sys.exit(1)

from common.mqtt_client import SecureMQTTClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("hardware_sensor_reader")

TOPICS = {
    "temperature": "sensors/academic/floor1/temperature",
    "gas":         "sensors/academic/floor1/gas",
    "motion":      "sensors/academic/floor1/motion",
}

DEVICE_IDS = {
    "temperature": "DHT22-ACADEMIC-F1-LABA-01",
    "gas":         "MQ2-ACADEMIC-F1-LABA-01",
    "motion":      "PIR-ACADEMIC-F1-LABA-01",
}

GATEWAY_ID = "GW-ACADEMIC-F1-01"
ZONE       = "Academic/Floor1/LabA"

DHT22_GPIO = 17   # PIN 11
MQ2_GPIO   = 27   # PIN 13
PIR_GPIO   = 18   # PIN 12

MQ2_PPM_CLEAN = 120.0
MQ2_PPM_ALERT = 520.0   # above gateway high threshold (450)

READ_INTERVAL = 3.0


class HardwareSensorReader:

    def __init__(self, broker_host="localhost", broker_port=1883):
        self._seq: dict[str, int] = {}
        self._running = True

        # DHT22
        logger.info(f"Initialising DHT22 on GPIO {DHT22_GPIO} (PIN 11)...")
        self.dht = adafruit_dht.DHT22(board.D17, use_pulseio=False)
        logger.info("  DHT22 ready")

        # MQ-2 + PIR share one gpiochip handle
        logger.info(f"Initialising MQ-2 on GPIO {MQ2_GPIO} (PIN 13)...")
        self.gpio = lgpio.gpiochip_open(0)
        lgpio.gpio_claim_input(self.gpio, MQ2_GPIO)
        logger.info("  MQ-2 ready — warming up 30s...")
        for remaining in range(30, 0, -5):
            logger.info(f"  warm-up: {remaining}s left...")
            time.sleep(5)
        logger.info("  MQ-2 warm-up complete")

        # PIR — optional, skip gracefully if not wired
        self.pir_enabled = False
        logger.info(f"Initialising PIR on GPIO {PIR_GPIO} (PIN 12)...")
        try:
            lgpio.gpio_claim_input(self.gpio, PIR_GPIO)
            # Quick sanity read — if the pin is truly floating/disconnected
            # lgpio still succeeds here, so we rely on it always being readable.
            self.pir_enabled = True
            logger.info("  PIR ready")
        except lgpio.error as e:
            logger.warning(f"  PIR not available ({e}) — will be added automatically when connected")

        # MQTT
        logger.info(f"Connecting to MQTT broker {broker_host}:{broker_port}...")
        self.mqtt = SecureMQTTClient(
            client_id="hardware-sensor-reader",
            broker_host=broker_host,
            broker_port=broker_port,
        )
        self.mqtt.connect()
        time.sleep(1.5)
        logger.info("  MQTT connected")

    def _seq_next(self, device_id: str) -> int:
        self._seq[device_id] = self._seq.get(device_id, 0) + 1
        return self._seq[device_id]

    def _publish(self, sensor_type: str, value: float, unit: str, extra: dict | None = None):
        device_id = DEVICE_IDS[sensor_type]
        payload = {
            "device_id":   device_id,
            "device_type": sensor_type,
            "zone":        ZONE,
            "value":       value,
            "unit":        unit,
            "gateway_id":  GATEWAY_ID,
            "seq":         self._seq_next(device_id),
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            payload.update(extra)
        ok = self.mqtt.publish(TOPICS[sensor_type], payload, qos=1)
        icon = "OK" if ok else "FAIL"
        logger.info(f"[{icon}] [{sensor_type.upper():>11}] {value:>7} {unit:<8} seq={payload['seq']}")

    def _read_dht22(self):
        for attempt in range(3):
            try:
                temp = self.dht.temperature
                hum  = self.dht.humidity
                if temp is not None and hum is not None:
                    return round(float(temp), 1), round(float(hum), 1)
            except RuntimeError as e:
                if attempt < 2:
                    time.sleep(0.5)
                else:
                    logger.warning(f"DHT22 failed after 3 attempts: {e}")
        return None, None

    def _read_mq2(self) -> float:
        state = lgpio.gpio_read(self.gpio, MQ2_GPIO)
        if state == lgpio.HIGH:
            return MQ2_PPM_CLEAN
        logger.warning("MQ-2: GAS/SMOKE DETECTED (DO pin LOW)")
        return MQ2_PPM_ALERT

    def _read_pir(self) -> float:
        return float(lgpio.gpio_read(self.gpio, PIR_GPIO))

    def run(self):
        pir_status = f"GPIO {PIR_GPIO} -> {TOPICS['motion']}" if self.pir_enabled else "not connected (plug in to activate)"
        logger.info("=" * 50)
        logger.info("MASS hardware sensor reader started")
        logger.info(f"  DHT22  GPIO {DHT22_GPIO} -> {TOPICS['temperature']}")
        logger.info(f"  MQ-2   GPIO {MQ2_GPIO}  -> {TOPICS['gas']}")
        logger.info(f"  PIR    {pir_status}")
        logger.info("=" * 50)

        while self._running:
            temp, hum = self._read_dht22()
            if temp is not None:
                self._publish("temperature", temp, "celsius",
                              extra={"humidity": hum, "source": "DHT22"})
            else:
                logger.warning("DHT22: skipping (no valid reading)")

            ppm = self._read_mq2()
            self._publish("gas", ppm, "ppm",
                          extra={"source": "MQ2-DO", "digital_only": True})

            if self.pir_enabled:
                motion = self._read_pir()
                self._publish("motion", motion, "boolean",
                              extra={"source": "PIR"})

            time.sleep(READ_INTERVAL)

    def stop(self):
        self._running = False
        try:
            self.dht.exit()
        except Exception:
            pass
        try:
            lgpio.gpiochip_close(self.gpio)
        except Exception:
            pass
        self.mqtt.disconnect()
        logger.info("Hardware sensor reader stopped")


def main():
    parser = argparse.ArgumentParser(description="MASS Hardware Sensor Reader")
    parser.add_argument("--broker", default="localhost")
    parser.add_argument("--port",   type=int, default=1883)
    args = parser.parse_args()

    reader = HardwareSensorReader(broker_host=args.broker, broker_port=args.port)
    try:
        reader.run()
    except KeyboardInterrupt:
        logger.info("Stopped by user")
    finally:
        reader.stop()


if __name__ == "__main__":
    main()
