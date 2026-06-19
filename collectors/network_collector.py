import json, subprocess, re, time
from datetime import datetime, timezone
from confluent_kafka import Producer
import socket

# Detect IP dynamically
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("192.168.60.10", 9092))
HOST_ID = s.getsockname()[0]
s.close()

KAFKA_BROKER = "192.168.60.10:9092"
TOPIC = "data.telemetry"

SKIP_DST_PORTS = {9092,27017,1883,389,2181,3000,8086,5432}
SKIP_DST_IPS = {"192.168.60.10","192.168.60.11","192.168.60.13","8.8.8.8","8.8.4.4"}

producer = Producer({"bootstrap.servers": KAFKA_BROKER})

def publish(event):
    event["host_id"] = HOST_ID
    event["building"] = "a1"
    event["floor"] = "1"
    event["timestamp"] = datetime.now(timezone.utc).isoformat()
    producer.produce(TOPIC, json.dumps(event).encode())
    producer.flush()
    print(f"[flow] {event.get('src_ip','')} -> {event.get('dst_ip','')}:{event.get('dst_port','')}")

# Use en5 for Mac ethernet interface
INTERFACE = "en5"
print(f"Network collector running on {INTERFACE}... HOST_ID={HOST_ID}")

proc = subprocess.Popen(
    ["tcpdump","-i",INTERFACE,"-n","-l","-q","tcp"],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True
)

for line in proc.stdout:
    try:
        match = re.search(r"IP (\d+\.\d+\.\d+\.\d+)\.(\d+) > (\d+\.\d+\.\d+\.\d+)\.(\d+)",line)
        if not match:
            continue
        src_ip = match.group(1)
        src_port = int(match.group(2))
        dst_ip = match.group(3)
        dst_port = int(match.group(4))

        if dst_port in SKIP_DST_PORTS or dst_ip in SKIP_DST_IPS:
            continue
        if src_port in SKIP_DST_PORTS:
            continue

        status = "S0"
        if " R " in line or " RA " in line:
            status = "REJ"
        elif " FA " in line or " F " in line:
            status = "reset"

        publish({"event_type":"flow","src_ip":src_ip,"dst_ip":dst_ip,"dst_port":dst_port,"src_port":src_port,"proto":"tcp","status":status,"bytes_out":64})

    except Exception:
        pass
