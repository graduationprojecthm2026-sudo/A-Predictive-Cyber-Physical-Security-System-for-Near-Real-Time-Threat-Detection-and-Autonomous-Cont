"""
test_hardware.py
─────────────────────────────────────────────────────
STEP 1 — run this FIRST, before starting Docker.
Tests DHT22 and MQ-2 directly from GPIO with no MQTT,
no Kafka, no Docker needed at all.

Run:
    cd ~/agents-test
    source .venv/bin/activate
    unset BLINKA_MCP2221
    python3 test_hardware.py

What you should see every 3 seconds:
    [DHT22] temp=24.1C  humidity=58.3%
    [MQ-2 ] state=CLEAN  ppm=120.0  (DO pin HIGH)

If you hold your hand near DHT22, temp rises.
If you wave smoke near MQ-2, state changes to GAS DETECTED.
"""

import time
import sys

print("=" * 50)
print("MASS Hardware Test — DHT22 + MQ-2")
print("=" * 50)

# ── import GPIO libraries ──────────────────────────
try:
    import board
    import adafruit_dht
    import lgpio
except ImportError as e:
    print(f"\nMissing library: {e}")
    print("Fix with:")
    print("  pip install adafruit-circuitpython-dht board")
    print("  sudo apt install python3-lgpio")
    sys.exit(1)

# ── pin config ─────────────────────────────────────
DHT22_GPIO = 17   # Pi PIN 11
MQ2_GPIO   = 27   # Pi PIN 13

# ── init DHT22 ─────────────────────────────────────
print(f"\nInitialising DHT22 on GPIO {DHT22_GPIO}...")
try:
    dht = adafruit_dht.DHT22(board.D17, use_pulseio=False)
    print("  DHT22 ready")
except Exception as e:
    print(f"  DHT22 init failed: {e}")
    sys.exit(1)

# ── init MQ-2 via lgpio ────────────────────────────
print(f"Initialising MQ-2 on GPIO {MQ2_GPIO}...")
try:
    h = lgpio.gpiochip_open(0)   # /dev/gpiochip0 on Pi 5
    lgpio.gpio_claim_input(h, MQ2_GPIO)
    print("  MQ-2 GPIO ready")
except Exception as e:
    print(f"  MQ-2 init failed: {e}")
    sys.exit(1)

# ── MQ-2 warm-up ───────────────────────────────────
print("\nMQ-2 warming up (30s) — do not blow smoke yet...")
for i in range(30, 0, -5):
    print(f"  {i}s remaining...")
    time.sleep(5)
print("  Warm-up done. Calibrate potentiometer now if needed.")
print("  (Turn pot until red DO LED just turns OFF in clean air)")
print()

# ── read loop ──────────────────────────────────────
print("Reading sensors every 3s — Ctrl+C to stop\n")
seq = 0
while True:
    seq += 1
    print(f"── Reading #{seq} ──────────────────────────")

    # DHT22
    temp = hum = None
    for attempt in range(3):
        try:
            temp = dht.temperature
            hum  = dht.humidity
            if temp is not None and hum is not None:
                break
        except RuntimeError as e:
            if attempt < 2:
                time.sleep(0.5)
            else:
                print(f"  [DHT22] ERROR after 3 attempts: {e}")

    if temp is not None:
        status = ""
        if temp >= 40:
            status = "  <-- ALERT: above 40C threshold!"
        elif temp >= 35:
            status = "  <-- WARNING: above 35C threshold"
        print(f"  [DHT22] temp={temp:.1f}C  humidity={hum:.1f}%{status}")
    else:
        print("  [DHT22] no reading")

    # MQ-2
    try:
        state = lgpio.gpio_read(h, MQ2_GPIO)
        if state == lgpio.HIGH:
            ppm = 120.0
            label = "CLEAN AIR"
        else:
            ppm = 520.0
            label = "GAS DETECTED  <-- ALERT!"
        print(f"  [MQ-2 ] state={label}  DO pin={'HIGH' if state else 'LOW'}  ppm={ppm}")
    except Exception as e:
        print(f"  [MQ-2 ] ERROR: {e}")

    print()
    time.sleep(3)
