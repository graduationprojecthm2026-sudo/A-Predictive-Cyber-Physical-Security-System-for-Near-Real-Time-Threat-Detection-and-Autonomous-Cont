from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from typing import Dict, Optional, Tuple
from common.models import SensorReading


class SensorValidator:
    def __init__(self, config: Dict):
        self.whitelist = set(config.get("sensors", {}).get("whitelist", []))
        self.last_seq: Dict[str, int] = {}

    def validate(self, payload: Dict) -> Tuple[bool, Optional[str], Optional[SensorReading]]:
        try:
            reading = SensorReading(**payload)
        except Exception as e:
            return False, f"schema_invalid: {e}", None

        if self.whitelist and reading.device_id not in self.whitelist:
            return False, "unauthorized_device", reading

        last = self.last_seq.get(reading.device_id)
        if last is not None and reading.seq <= last:
            # seq=1 (or a dramatic drop) signals a device restart — reset tracking
            # instead of flagging as an attack so normal reboots don't drop data.
            if reading.seq == 1 or reading.seq < (last - 100):
                self.last_seq[reading.device_id] = reading.seq
                return True, None, reading
            return False, "sequence_anomaly", reading

        self.last_seq[reading.device_id] = reading.seq
        return True, None, reading
