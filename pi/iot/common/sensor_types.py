"""
common/sensor_types.py — canonical sensor-type normalization.

The system ingests telemetry from two sources that label sensors differently:
  • real Raspberry Pi reader → device_type "DHT22" / "MQ2" / "PIR" / "TELEMETRY"
  • (legacy) simulator        → device_type "temperature" / "gas" / "motion"

Every consumer (gateway classifier, behavioral agent, fire agent) must reduce
both conventions to ONE canonical class so real hardware data is processed
exactly like any other. Keep this the single source of truth — do not re-map
device types ad hoc inside agents.
"""
from __future__ import annotations

from typing import Optional

TEMP_TYPES     = {"temperature", "temp", "dht22", "dht11"}
GAS_TYPES      = {"gas", "smoke", "mq2", "mq-2", "mq135", "mq-135"}
MOTION_TYPES   = {"motion", "pir", "occupancy"}
HUMIDITY_TYPES = {"humidity", "hum"}

# Canonical classes the monitors act on
CANONICAL = {"temperature", "gas", "motion", "humidity"}


def canonical_sensor_type(device_type: str, unit: str = "") -> Optional[str]:
    """
    Map a raw (device_type, unit) pair to a canonical sensor class, or None when
    it is not a room sensor we act on (e.g. node CPU "TELEMETRY"/"C_CPU").

    `unit` disambiguates DHT sensors that report temperature *and* humidity under
    the same device_type ("DHT22"): a "%" unit is humidity, otherwise temperature.
    """
    dt = (device_type or "").strip().lower()
    u  = (unit or "").strip().lower()

    # Humidity first — a DHT22 humidity reading shares the device_type with temp.
    if dt in HUMIDITY_TYPES or u in ("%", "percent", "rh"):
        return "humidity"
    if dt in TEMP_TYPES:
        return "temperature"
    if dt in GAS_TYPES:
        return "gas"
    if dt in MOTION_TYPES:
        return "motion"
    # Already canonical?
    if dt in CANONICAL:
        return dt
    return None
