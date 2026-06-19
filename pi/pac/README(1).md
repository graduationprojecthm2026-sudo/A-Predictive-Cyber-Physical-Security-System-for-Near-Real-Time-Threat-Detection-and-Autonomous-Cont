# MASS PAC — Raspberry Pi 5 Deployment Guide

**Galala University — Multi-Agent Security System**
Physical Access Control Node (Pi #2)

---

## What This Does

```
RC522 (RFID) ──► door_process.py ──► Kafka (pac.events) ──► pac_eda_agent
SW-420 (Vibr) ──►      │                                  ──► cred_anomaly_agent
Relay + Buzzer ◄────────┘ (grant/deny)                    ──► pac_local_manager
                                                           ──► HQ / SOAR
```

The Pi runs `door_process.py` directly on hardware. The PAC-EDA and Credential Anomaly agents can run either on the Pi (Docker) or on the server room (recommended for PoC).

---

## Hardware Wiring (confirmed working)

| Component     | Pi Pin | GPIO | Notes |
|--------------|--------|------|-------|
| RC522 VCC    | Pin 1  | 3.3V | Native 3.3V — do NOT use 5V |
| RC522 GND    | Pin 6  | GND  | |
| RC522 MOSI   | Pin 19 | 10   | SPI0 |
| RC522 MISO   | Pin 21 | 9    | SPI0 |
| RC522 SCK    | Pin 23 | 11   | SPI0 |
| RC522 SDA/CS | Pin 24 | 8    | CE0  |
| RC522 RST    | Pin 22 | 25   | |
| Relay IN     | Pin 16 | 23   | Active-LOW (0=unlock, 1=lock) |
| Relay VCC    | Pin 2  | 5V   | |
| Relay GND    | Pin 6  | GND  | |
| Buzzer       | Pin 12 | 18   | |
| SW-420 DO    | Pin 18 | 24   | LOW = vibration detected |
| SW-420 VCC   | Pin 1  | 3.3V | |
| SW-420 GND   | Pin 9  | GND  | |

**Solenoid:** 12V adapter (+) → Relay COM → Relay NO → Solenoid (+) → Solenoid (-) → 12V GND → Pi GND

---

## Quick Start (No Docker)

```bash
# 1. Clone and setup
cd /home/pi
git clone <your-repo> mass-pi
cd mass-pi
bash setup_pi.sh     # sets up venv, systemd, enables SPI/UART
sudo reboot

# 2. After reboot — run directly
cd ~/mass-pi
source myenv/bin/activate
python door_process.py

# 3. Or as a service
sudo systemctl start mass-pac
sudo journalctl -u mass-pac -f
```

---

## Docker Deployment

```bash
# Build image
cd ~/mass-pi
docker build -f docker/Dockerfile.pac -t mass-pac:latest .

# Run all PAC containers
docker compose -f docker/docker-compose.pi.yml up -d

# Check logs
docker logs mass-door-process -f
docker logs mass-pac-eda-agent -f

# Health check
curl http://localhost:8002/health
curl http://localhost:8003/health
```

---

## Add Authorized Cards

Edit `door_process.py` → `AUTHORIZED_USERS` dict:

```python
AUTHORIZED_USERS = {
    491971544629: {
        "name":   "Alice Student",
        "role":   "student",
        "floors": [1],
        "hours":  (8, 20),   # 8AM–8PM only
    },
    # Add more UIDs here — scan with: python3 scan_uid.py
}
```

To scan a new UID:
```bash
python3 - << 'EOF'
from mfrc522 import SimpleMFRC522
r = SimpleMFRC522()
print("Present card...")
uid, _ = r.read()
print(f"UID: {uid}")
EOF
```

---

## Fingerprint Sensor (R305) — Pending

The R305 fingerprint sensor code is stubbed in `door_process.py` → `_check_fingerprint()`.
Once UART is confirmed working, uncomment the full implementation in that function.

Current status: loopback test and port detection ongoing.

---

## Kafka Topics Used

| Topic        | Direction | Content |
|-------------|-----------|---------|
| `pac.events` | Pi → HQ   | All RFID events (grant/deny/tamper) |
| `pac.alerts` | Agent → HQ | Detected anomalies |
| `soar.commands` | HQ → Pi | Remote lock/unlock commands |

---

## Environment Variables (.env)

```env
KAFKA_BROKER=192.168.20.200:9092
BUILDING=building_a
FLOOR=1
DOOR_ID=door_acad_f1_d1
GATEWAY_ID=GW-PAC-ACADEMIC-F1-01
UNLOCK_SEC=5
```
