"""
MASS SOAR Executor — soar_executor.py (Final v6 — MAC Tracking + Cooldown + Testing Mode)
"""

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone

import paramiko
from confluent_kafka import Consumer, Producer, KafkaError

# ── Config ────────────────────────────────────────────────────────────────────
KAFKA_BROKER    = "192.168.60.10:9092"
CONSUME_TOPIC   = "soar.commands"
RESPONSE_TOPIC  = "soar.responses"

SWITCH_IP       = "192.168.40.1"
SWITCH_USER     = "massadmin"
SWITCH_PASS     = "Mass@2026"
SSH_TIMEOUT     = 15

VLAN10_ACL      = "VLAN10_POLICY"
VLAN15_ACL      = "VLAN15_POLICY"

ISOLATE_ACTIONS = {"isolate_host", "block_attacker_ip", "block_ip"}
RESTORE_ACTIONS = {"restore_host", "unblock_ip"}

# Testing & Safety
TESTING_MODE = True  # Set False for production auto-execution
RESTORE_COOLDOWN_MINUTES = 5  # Don't re-block same MAC for X minutes after restore

_isolated: dict = {}
_restore_cooldown: dict = {}  # {mac: timestamp_restored}

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] soar_executor — %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("soar_executor")

# ══════════════════════════════════════════════════════════════════════════════
# SSH HELPER (Includes old cipher bypass)
# ══════════════════════════════════════════════════════════════════════════════

def _open_shell():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    # Bypass for Cisco IOS 15.0 legacy key exchanges
    client.connect(
        SWITCH_IP, username=SWITCH_USER, password=SWITCH_PASS, timeout=SSH_TIMEOUT,
        look_for_keys=False, allow_agent=False,
        disabled_algorithms={
            "kex": ["curve25519-sha256", "curve25519-sha256@libssh.org",
                    "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521"],
        }
    )
    shell = client.invoke_shell()
    time.sleep(1.0)
    shell.recv(8192)
    return client, shell

def _run_commands(commands):
    try:
        client, shell = _open_shell()
        output = ""
        for cmd in commands:
            shell.send(cmd + "\n")
            if "write memory" in cmd or "wr mem" in cmd:
                time.sleep(3.0)
            else:
                time.sleep(1.0)
            if shell.recv_ready():
                output += shell.recv(8192).decode(errors="ignore")
        client.close()
        return True, output
    except Exception as e:
        log.error(f"SSH failed: {e}")
        return False, str(e)

def _query_switch(command):
    try:
        client, shell = _open_shell()
        shell.send(command + "\n")
        time.sleep(1.0)
        output = shell.recv(8192).decode(errors="ignore")
        client.close()
        return True, output
    except Exception as e:
        log.error(f"SSH query failed: {e}")
        return False, str(e)

# ══════════════════════════════════════════════════════════════════════════════
# LOOKUP HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _get_mac_from_arp(target_ip):
    success, output = _query_switch(f"show arp {target_ip}")
    if not success: return None
    match = re.search(r"Internet\s+" + re.escape(target_ip) + r"\s+\S+\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})", output)
    return match.group(1).lower() if match else None

def _get_location_from_mac(mac):
    mac_clean = mac.replace(":", "").replace("-", "").replace(".", "").lower()
    mac_cisco = f"{mac_clean[0:4]}.{mac_clean[4:8]}.{mac_clean[8:12]}" if len(mac_clean) == 12 else mac
    success, output = _query_switch(f"show mac address-table address {mac_cisco}")
    if not success: return None, None
    
    match = re.search(r"^\s*(\d+)\s+[0-9a-fA-F\.]+\s+(?:DYNAMIC|STATIC)\s+(\S+)", output, re.MULTILINE)
    if match:
        vlan = match.group(1)
        port = match.group(2)
        return vlan, port
    return None, None

def _get_acl_for_ip(ip):
    return VLAN15_ACL if ip.startswith("192.168.15.") else VLAN10_ACL

# ══════════════════════════════════════════════════════════════════════════════
# ISOLATION & RESTORE (MAC Tracking + Cooldown Protection)
# ══════════════════════════════════════════════════════════════════════════════

def isolate_host(target_ip):
    # Check if this IP is already isolated
    if target_ip in _isolated:
        return True, {"status": "already_isolated", "target_ip": target_ip}
    
    # Get MAC and check if it's already blackholed under different IP
    mac = _get_mac_from_arp(target_ip)
    if mac:
        # Check if same MAC already isolated
        for ip, entry in _isolated.items():
            if entry.get("mac") == mac:
                log.warning(f"MAC {mac} already isolated under IP {ip}, skipping {target_ip}")
                return True, {"status": "already_isolated_by_mac", "target_ip": target_ip, "original_ip": ip}
        
        # Check restore cooldown
        if mac in _restore_cooldown:
            restored_at = _restore_cooldown[mac]
            elapsed = (time.time() - restored_at) / 60  # minutes
            if elapsed < RESTORE_COOLDOWN_MINUTES:
                log.warning(f"MAC {mac} was restored {elapsed:.1f}min ago, cooldown active ({RESTORE_COOLDOWN_MINUTES}min)")
                return True, {"status": "cooldown_active", "target_ip": target_ip, "mac": mac, "minutes_remaining": RESTORE_COOLDOWN_MINUTES - elapsed}

    acl = _get_acl_for_ip(target_ip)
    result = {"target_ip": target_ip, "mac_blackholed": False, "acl_added": False, "errors": []}

    vlan, port = _get_location_from_mac(mac) if mac else (None, None)

    commands = ["configure terminal"]

    # 1. Primary: MAC Blackhole
    mac_cisco = None
    if mac and vlan:
        log.info(f"Blackholing MAC {mac} on VLAN {vlan}...")
        mac_cisco = f"{mac[0:4]}.{mac[4:8]}.{mac[8:12]}"
        commands.append(f"mac address-table static {mac_cisco} vlan {vlan} drop")
        result["mac_blackholed"] = True
    else:
        result["errors"].append("Could not find MAC/VLAN for Blackhole")

    # 2. Backup: SSH ACL Deny
    commands += [
        f"ip access-list extended {acl}",
        f"5 deny ip host {target_ip} any",
        "end", 
        "write memory"
    ]
    
    success, _ = _run_commands(commands)
    if success:
        result["acl_added"] = True
        _isolated[target_ip] = {
            "acl": acl, "seq": 5, "mac": mac, "vlan": vlan, 
            "mac_cisco": mac_cisco
        }
        # Clear cooldown when successfully isolated
        if mac in _restore_cooldown:
            del _restore_cooldown[mac]
        log.warning(f"ISOLATED {target_ip}: MAC Blackholed on VLAN {vlan} + ACL deny added.")

    return success, result

def restore_host(target_ip):
    if target_ip not in _isolated:
        return True, {"errors": ["Host not isolated"]}

    entry = _isolated[target_ip]
    acl, seq = entry["acl"], entry["seq"]
    mac_cisco, vlan, mac = entry.get("mac_cisco"), entry.get("vlan"), entry.get("mac")
    
    result = {"target_ip": target_ip, "mac_restored": False, "acl_removed": False, "errors": []}
    commands = ["configure terminal"]

    # 1. Primary: Remove MAC Blackhole
    if mac_cisco and vlan:
        log.info(f"Removing blackhole for MAC {mac_cisco} on VLAN {vlan}...")
        commands.append(f"no mac address-table static {mac_cisco} vlan {vlan}")
        result["mac_restored"] = True

    # 2. Backup: Remove SSH ACL
    commands += [
        f"ip access-list extended {acl}",
        f"no {seq}",
        "end", 
        "write memory"
    ]
    
    success, _ = _run_commands(commands)
    if success:
        result["acl_removed"] = True
        
        # Add MAC to cooldown
        if mac:
            _restore_cooldown[mac] = time.time()
            log.info(f"Added {RESTORE_COOLDOWN_MINUTES}min cooldown for MAC {mac}")
        
        del _isolated[target_ip]
        log.info(f"RESTORED {target_ip}: MAC allowed + ACL removed.")

    return success, result

# ══════════════════════════════════════════════════════════════════════════════
# PRE-FLIGHT CHECKS & KAFKA PUBLISHER
# ══════════════════════════════════════════════════════════════════════════════

def test_ssh():
    """
    Standalone function to test SSH connectivity to the switch.
    Run via: python3 -c "import soar_executor; soar_executor.test_ssh()"
    """
    log.info("Testing SSH connection to Core-SW...")
    ssh_ok, output = _query_switch("show clock")
    
    if ssh_ok:
        log.info("✅ SSH to Core-SW is working perfectly.")
        print(f"\nSwitch Time: {output.strip().split()[-1]}")
    else:
        log.error("❌ Cannot reach Core-SW via SSH — check network and credentials.")

def _publish_response(producer, command, success, detail):
    response = {
        "response_id": str(uuid.uuid4()),
        "command_id": command.get("command_id", "unknown"),
        "action": command.get("action", "unknown"),
        "target": command.get("target", "unknown"),
        "status": "executed" if success else "failed",
        "detail": detail,
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
    producer.produce(RESPONSE_TOPIC, json.dumps(response).encode(), key=response["command_id"])
    producer.flush()

# ══════════════════════════════════════════════════════════════════════════════
# MAIN KAFKA LOOP
# ══════════════════════════════════════════════════════════════════════════════

def main():
    mode_str = "TESTING MODE (manual confirmation required)" if TESTING_MODE else "PRODUCTION MODE (auto-execution)"
    log.info(f"Starting SOAR Executor — {mode_str}")
    log.info(f"Restore cooldown: {RESTORE_COOLDOWN_MINUTES} minutes")
    
    consumer = Consumer({"bootstrap.servers": KAFKA_BROKER, "group.id": "soar-executor-malak", "auto.offset.reset": "latest"})
    consumer.subscribe([CONSUME_TOPIC])
    producer = Producer({"bootstrap.servers": KAFKA_BROKER})

    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None or msg.error(): continue
            
            try:
                command = json.loads(msg.value().decode())
                action, target = command.get("action", "").lower(), command.get("target", "")
                
                if TESTING_MODE and action in ISOLATE_ACTIONS:
                    log.warning(f"🧪 TESTING MODE: Would isolate {target} — command ignored (set TESTING_MODE=False to enable)")
                    _publish_response(producer, command, True, {"status": "skipped_testing_mode", "target": target})
                    continue
                
                if action in ISOLATE_ACTIONS and target:
                    success, detail = isolate_host(target)
                    _publish_response(producer, command, success, detail)
                elif action in RESTORE_ACTIONS and target:
                    success, detail = restore_host(target)
                    _publish_response(producer, command, success, detail)
            except Exception as e:
                log.error(f"Error processing message: {e}")
    except KeyboardInterrupt:
        log.info("SOAR Executor stopped.")
    finally:
        consumer.close()

if __name__ == "__main__":
    main()
