from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from collections import deque
from datetime import datetime, timedelta
from typing import Dict, Tuple
from common.models import SensorReading, SeverityLevel
from common.sensor_types import canonical_sensor_type


class RiskClassifier:
    def __init__(self, config: Dict):
        self.thresholds = config.get("thresholds", {})
        self.window_sec_default = 10
        self.min_points_default = 3
        self.history = {}

    def _cfg(self, sensor_type: str) -> Dict:
        return self.thresholds.get(sensor_type.lower(), {})

    def _push(self, reading: SensorReading):
        dq = self.history.setdefault(reading.device_id, deque(maxlen=50))
        dq.append((reading.timestamp, reading.value))

    def _is_sustained_high(self, reading: SensorReading, high_thr: float, window_sec: int, min_points: int) -> Tuple[bool, int]:
        dq = self.history.get(reading.device_id, deque())
        now = reading.timestamp
        window_start = now - timedelta(seconds=window_sec)
        points = [1 for (t, v) in dq if t >= window_start and v >= high_thr]
        return (len(points) >= min_points, len(points))

    def classify(self, reading: SensorReading) -> Tuple[SeverityLevel, float, Dict]:
        # Normalize real-hardware labels (DHT22/MQ2/PIR) onto the threshold keys
        # (temperature/gas/motion) so real readings classify like any other.
        sensor_type = canonical_sensor_type(reading.device_type, reading.unit) or reading.device_type.lower()
        cfg = self._cfg(sensor_type)
        high_thr   = float(cfg.get("high",   1e18))
        med_thr    = float(cfg.get("medium",  1e18))
        window_sec = int(cfg.get("sustained_duration_sec",   self.window_sec_default))
        min_points = int(cfg.get("min_sustained_points", self.min_points_default))
        self._push(reading)

        if reading.value < med_thr:
            return SeverityLevel.LOW, 0.6, {"reason": "normal_or_low"}
        if reading.value < high_thr:
            return SeverityLevel.MEDIUM, 0.75, {"reason": "medium_threshold", "threshold": med_thr, "value": reading.value}

        sustained, count = self._is_sustained_high(reading, high_thr, window_sec, min_points)
        if sustained:
            return SeverityLevel.HIGH, 0.90, {
                "reason": "sustained_high_threshold", "high": high_thr,
                "value": reading.value, "sustained_window_sec": window_sec,
                "high_points_in_window": count,
            }
        return SeverityLevel.MEDIUM, 0.65, {
            "reason": "high_spike_downgraded", "high": high_thr,
            "value": reading.value, "sustained_window_sec": window_sec,
            "high_points_in_window": count,
        }
