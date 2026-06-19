import json, time, os, psutil, subprocess
from datetime import datetime, timezone
from confluent_kafka import Producer
from pathlib import Path
import socket

# Detect IP dynamically
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("192.168.60.10", 9092))
HOST_ID = s.getsockname()[0]
s.close()

KAFKA_BROKER = "192.168.60.10:9092"
TOPIC = "data.telemetry"

SUSPICIOUS = {"nmap","hydra","hping3","masscan","sqlmap","nikto","aircrack","john","hashcat"}
RANSOM_EXTENSIONS = {".locked",".encrypted",".enc",".crypted",".crypt",".cerber",".locky"}
PERSISTENCE_PATHS = ["/etc/cron","/var/spool/cron","/etc/init.d","/etc/rc.local","/etc/cron.d"]
MONITOR_DIRS = [str(Path.home()),"/tmp"]

producer = Producer({"bootstrap.servers": KAFKA_BROKER})

def publish(event):
    event["host_id"] = HOST_ID
    event["src_ip"] = HOST_ID
    event["building"] = "a1"
    event["floor"] = "1"
    event["timestamp"] = datetime.now(timezone.utc).isoformat()
    producer.produce(TOPIC, json.dumps(event).encode())
    producer.flush()
    print(f"[{event['event_type']}] {event.get('process_name', event.get('file_path', ''))}")

file_states = {}

def scan_files():
    for directory in MONITOR_DIRS:
        try:
            for root, dirs, files in os.walk(directory):
                depth = root.replace(directory, '').count(os.sep)
                if depth > 2:
                    dirs.clear()
                    continue
                for fname in files:
                    fpath = os.path.join(root, fname)
                    try:
                        stat = os.stat(fpath)
                        mtime = stat.st_mtime
                        ext = os.path.splitext(fname)[1].lower()
                        if ext in RANSOM_EXTENSIONS:
                            if fpath not in file_states:
                                publish({"event_type":"file_op","file_path":fpath,"operation":"create","process_name":"unknown"})
                        if any(p in fpath for p in PERSISTENCE_PATHS):
                            prev_mtime = file_states.get(fpath, 0)
                            if mtime != prev_mtime and prev_mtime != 0:
                                publish({"event_type":"file_op","file_path":fpath,"operation":"write","process_name":"unknown"})
                        file_states[fpath] = mtime
                    except (PermissionError, FileNotFoundError):
                        pass
        except (PermissionError, FileNotFoundError):
            pass

seen_pids = set()
alerted_procs = set()

print(f"Telemetry collector running... HOST_ID={HOST_ID}")

while True:
    try:
        for proc in psutil.process_iter(["pid","name","username","cmdline"]):
            try:
                info = proc.info
                pid = info["pid"]
                name = info["name"] or ""
                cmdline = " ".join(info["cmdline"] or [])
                username = info["username"] or ""

                if username == "root" and (pid < 200 or name.startswith("k") or
                    name in {"systemd","sshd","lightdm","Xorg","cron","snapd","NetworkManager","wpa_supplicant","cupsd"}):
                    parent_user = "root"
                else:
                    parent_user = "root" if username == "root" else "user"

                if pid not in seen_pids:
                    seen_pids.add(pid)
                    publish({"event_type":"process","process_name":name,"username":username,"command_line":cmdline,"pid":pid,"parent_username":parent_user})
                    if cmdline:
                        publish({"event_type":"command","cmdline":cmdline,"command_line":cmdline,"process_name":name,"username":username})

                if name.lower() in SUSPICIOUS and name not in alerted_procs:
                    alerted_procs.add(name)
                    publish({"event_type":"process","process_name":name,"username":username,"command_line":cmdline,"pid":pid,"parent_username":"user"})

            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        alerted_procs.clear()

        try:
            # macOS uses /var/log/system.log instead of auth.log
            result = subprocess.run(["tail","-5","/var/log/system.log"],capture_output=True,text=True)
            for line in result.stdout.splitlines():
                if "Failed" in line or "Invalid" in line:
                    publish({"event_type":"auth","file_path":"/var/log/system.log","log_line":line.strip(),"username":"unknown","dst_port":22,"status":"failed"})
        except:
            pass

        scan_files()

    except Exception as e:
        print(f"Error: {e}")

    time.sleep(2)
