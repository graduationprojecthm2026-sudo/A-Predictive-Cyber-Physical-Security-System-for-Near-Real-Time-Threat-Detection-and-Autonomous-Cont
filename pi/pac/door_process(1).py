#!/usr/bin/env python3
"""
MASS PAC — RFID + Door Controller (with non-blocking buzzer)
Run in: myenv
  cd ~/mass-pi && source ~/myenv/bin/activate && export LG_CHIP=4
  python3 rfid_door.py

Buzzer plays asynchronously in background thread so it never blocks RFID.
"""
import os, time, json, uuid, threading, queue, lgpio
from mfrc522 import SimpleMFRC522
from datetime import datetime, timezone

LG_CHIP = int(os.environ.get("LG_CHIP", "0"))

# ── Config ────────────────────────────────────────────────────────────────────
KAFKA_BROKER        = "192.168.60.10:9092"
LDAP_HOST           = "192.168.60.11"
LDAP_PORT           = 389
LDAP_ADMIN          = "cn=admin,dc=mass,dc=local"
LDAP_PASS           = "CampusSecure2026"
LDAP_BASE           = "dc=mass,dc=local"
LDAP_CACHE_FILE     = "/tmp/ldap_users_cache.json"

DOOR_ID             = "door_acad_f1_d1"
BUILDING            = "building_a"
FLOOR               = 1
UNLOCK_SEC          = 5
PIN_RELAY           = 23
PIN_BUZZER          = 18
PIN_VIBR            = 24
RFID_STATE_FILE     = "/tmp/rfid_state.json"
FACE_GRANT_FILE     = "/tmp/face_grant.json"
CAMERA_ALERT_FILE   = "/tmp/camera_alert.json"
BLOCKED_CARDS_FILE  = "/tmp/blocked_cards.json"
FACE_VERIFY_TIMEOUT = 12
DEBOUNCE_SEC        = 30.0

# ── SOAR runtime state (updated by soar_listener thread) ─────────────────────
_door_locked = False   # True after lock_door command; blocks every subsequent swipe
_blocked_mem = set()   # in-memory mirror of blocked_cards file — O(1) lookup

# ── Hardcoded fallback (used immediately, replaced by LDAP later) ─────────────
AUTHORIZED_USERS = {
    719386707477: {"name": "Malak",       "role": "student"},
    491971544629: {"name": "Arwa",        "role": "staff"},
    164618897017: {"name": "Menna_Salem", "role": "student"},
    # 194566227563: {"name": "Hala",        "role": "student"},  # commented out — treated as unknown
}

# ── LDAP cache ────────────────────────────────────────────────────────────────
_ldap_cache = {}
_ldap_lock  = threading.Lock()
_ldap_ok    = False

def lookup_user(uid):
    """Look up card UID — LDAP cache first, then hardcoded fallback."""
    with _ldap_lock:
        if _ldap_cache:
            return _ldap_cache.get(uid)
    return AUTHORIZED_USERS.get(uid)

def _load_ldap_background():
    """Load LDAP users in background thread — doesn't block RFID startup."""
    global _ldap_cache, _ldap_ok
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
        server = Server(LDAP_HOST, port=LDAP_PORT, get_info=ALL, connect_timeout=5)
        conn   = Connection(server, LDAP_ADMIN, LDAP_PASS, auto_bind=True, receive_timeout=5)
        conn.search(
            search_base   = LDAP_BASE,
            search_filter = "(employeeNumber=*)",
            search_scope  = SUBTREE,
            attributes    = ["cn", "employeeNumber", "employeeType"],
        )
        users = {}
        for entry in conn.entries:
            try:
                uid  = int(str(entry.employeeNumber))
                name = str(entry.cn)
                if name == "Hala":  # commented out — treated as unknown
                    continue
                role = str(entry.employeeType) if entry.employeeType else "student"
                users[uid] = {"name": name, "role": role}
            except:
                continue
        conn.unbind()
        if users:
            with _ldap_lock:
                _ldap_cache = users
                _ldap_ok    = True
            try:
                with open(LDAP_CACHE_FILE, "w") as f:
                    json.dump({str(k): v for k, v in users.items()}, f)
            except:
                pass
            print(f"[LDAP] Loaded {len(users)} users from LDAP")
        else:
            print("[LDAP] LDAP returned no users — using hardcoded")
    except Exception as e:
        print(f"[LDAP] Failed: {e}")
        try:
            with open(LDAP_CACHE_FILE, "r") as f:
                raw = json.load(f)
            users = {int(k): v for k, v in raw.items()}
            with _ldap_lock:
                _ldap_cache = users
            print(f"[LDAP] Loaded {len(users)} users from disk cache")
        except:
            print("[LDAP] No disk cache — using hardcoded fallback")

# ── Kafka ─────────────────────────────────────────────────────────────────────
try:
    from confluent_kafka import Producer, Consumer
    _producer = Producer({
        "bootstrap.servers": KAFKA_BROKER,
        "acks": "1",
        "socket.timeout.ms": 2000,
        "log_level": 0,
    })
    KAFKA_OK = True
    print(f"[KAFKA] Connected to {KAFKA_BROKER}")
except Exception as e:
    _producer = None
    KAFKA_OK  = False
    print(f"[KAFKA] Not available: {e}")

# ── GPIO ──────────────────────────────────────────────────────────────────────
h = lgpio.gpiochip_open(LG_CHIP)
lgpio.gpio_claim_output(h, PIN_BUZZER)
lgpio.gpio_write(h, PIN_BUZZER, 0)
lgpio.gpio_claim_input(h, PIN_VIBR, lgpio.SET_PULL_UP)

def _lock():
    try:
        lgpio.gpio_free(h, PIN_RELAY)
        lgpio.gpio_claim_input(h, PIN_RELAY, lgpio.SET_PULL_UP)
        print("[DOOR] LOCKED")
    except Exception as e:
        print(f"[DOOR] Lock error: {e}")

def _unlock():
    try:
        lgpio.gpio_free(h, PIN_RELAY)
    except:
        pass
    lgpio.gpio_claim_output(h, PIN_RELAY)
    lgpio.gpio_write(h, PIN_RELAY, 0)
    print("[DOOR] UNLOCKED — pulsing solenoid")
    time.sleep(0.5)
    lgpio.gpio_free(h, PIN_RELAY)
    lgpio.gpio_claim_input(h, PIN_RELAY, lgpio.SET_PULL_UP)
    print("[DOOR] SOLENOID CUT — door open")

# ── BUZZER — non-blocking queue-based ─────────────────────────────────────────
_beep_queue = queue.Queue()

def beep(times, speed=0.1):
    """Queue a beep pattern — returns instantly, doesn't block."""
    _beep_queue.put((times, speed))

def _beep_worker():
    """Background thread that actually plays beeps from the queue."""
    while True:
        try:
            times, speed = _beep_queue.get(timeout=1.0)
            for _ in range(times):
                lgpio.gpio_write(h, PIN_BUZZER, 1)
                time.sleep(speed)
                lgpio.gpio_write(h, PIN_BUZZER, 0)
                time.sleep(speed)
        except queue.Empty:
            continue
        except Exception as e:
            print(f"[BUZZER] Error: {e}")

# ── State files ───────────────────────────────────────────────────────────────
_EMPTY = {"person": None, "uid": None, "time": 0, "timestamp": ""}

def _ipc_write(path, content):
    """Always remove then recreate — avoids sticky-bit PermissionError regardless of owner."""
    try:
        os.remove(path)
    except OSError:
        pass
    with open(path, "w") as f:
        json.dump(content, f)
    try:
        os.chmod(path, 0o666)
    except OSError:
        pass

def write_rfid_state(person, uid):
    _ipc_write(RFID_STATE_FILE, {
        "person":    person,
        "uid":       uid,
        "time":      time.time(),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })

# _recreate kept as alias so existing startup calls still work
_recreate = _ipc_write

def clear_rfid_state():
    _ipc_write(RFID_STATE_FILE, _EMPTY)

def read_face_grant(expected_person):
    try:
        with open(FACE_GRANT_FILE, "r") as f:
            g = json.load(f)
        if (g.get("person") == expected_person
                and g.get("granted") is True
                and time.time() - g.get("time", 0) < 30):
            return True
    except:
        pass
    return False

def clear_face_grant():
    _ipc_write(FACE_GRANT_FILE, {"person": None, "granted": False, "time": 0})

def clear_camera_alert():
    _ipc_write(CAMERA_ALERT_FILE, {"alert_type": None, "time": 0})

# ── Blocked cards ────────────────────────────────────────────────────────────
def is_card_blocked(uid):
    try:
        with open(BLOCKED_CARDS_FILE, "r") as f:
            data = json.load(f)
        return str(uid) in data.get("blocked_uids", [])
    except:
        return False

def block_card(uid, reason="soar_command"):
    try:
        try:
            with open(BLOCKED_CARDS_FILE, "r") as f:
                data = json.load(f)
        except:
            data = {"blocked_uids": [], "log": []}
        if str(uid) not in data["blocked_uids"]:
            data["blocked_uids"].append(str(uid))
            data["log"].append({
                "uid": str(uid), "reason": reason,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
        with open(BLOCKED_CARDS_FILE, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[BLOCK] Card {uid} blocked ({reason})")
    except Exception as e:
        print(f"[BLOCK] Error blocking {uid}: {e}")

def unblock_card(uid):
    try:
        with open(BLOCKED_CARDS_FILE, "r") as f:
            data = json.load(f)
        data["blocked_uids"] = [u for u in data["blocked_uids"] if u != str(uid)]
        with open(BLOCKED_CARDS_FILE, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[BLOCK] Card {uid} unblocked")
    except Exception as e:
        print(f"[BLOCK] Error unblocking {uid}: {e}")

# ── Kafka publish ─────────────────────────────────────────────────────────────
_seq = 0

def publish_event(uid, access, user=None, reason=None):
    global _seq; _seq += 1
    now    = datetime.now(timezone.utc)
    reason = reason or ("normal" if user else "unknown_card")
    payload = {
        "event_id":    str(uuid.uuid4()),
        "device_id":   f"RFID-ACADEMIC-F{FLOOR}-DOOR1-01",
        "device_type": "rfid_reader",
        "zone":        f"Academic/Floor{FLOOR}/Door1",
        "gateway_id":  "GW-PAC-ACADEMIC-F1-01",
        "card_uid":    str(uid),
        "access":      access,
        "reason":      reason,
        "ldap_result": "AUTHORIZED" if user else "NOT_FOUND",
        "ldap_source": "ldap" if _ldap_ok else "hardcoded",
        "hour":        now.hour,
        "building":    BUILDING,
        "floor":       FLOOR,
        "door_id":     DOOR_ID,
        "seq":         _seq,
        "timestamp":   now.isoformat(),
    }
    if user:
        payload["user_name"] = user.get("name", "")
        payload["user_role"] = user.get("role", "")
    if _producer:
        try:
            _producer.produce("pac.events", value=json.dumps(payload).encode())
            _producer.poll(0)
            print(f"[KAFKA] pac.events → {access} | {reason}")
        except Exception as e:
            print(f"[KAFKA] Error: {e}")
    else:
        print(f"[LOCAL] pac.events → {access} | {reason}")

# ── Background threads ────────────────────────────────────────────────────────
def vibration_monitor():
    cooldown = 0
    while True:
        try:
            if lgpio.gpio_read(h, PIN_VIBR) == 0 and time.time() > cooldown:
                cooldown = time.time() + 5.0
                print("[TAMPER] Vibration detected!")
                beep(5, 0.05)
                publish_event("TAMPER", "tamper_alert")
        except:
            pass
        time.sleep(0.1)

def camera_alert_monitor():
    """Reads camera alerts from /tmp/camera_alert.json and plays buzzer patterns."""
    last_handled = 0
    clear_camera_alert()
    BEEP_PATTERNS = {
        "forced_entry":                  (8, 0.04),
        "unknown_person":                (3, 0.15),
        "tailgating":                    (4, 0.08),
        "unauthorized_presence":         (2, 0.30),
        "insider_threat":                (6, 0.05),
        "insider_threat_physical_cyber": (6, 0.05),
        "loitering":                     (1, 0.20),
        "after_hours_presence":          (3, 0.10),
        "face_mismatch":                 (3, 0.15),
        "spoof_detected":                (5, 0.05),
    }
    while True:
        try:
            with open(CAMERA_ALERT_FILE, "r") as f:
                a = json.load(f)
            alert_type = a.get("alert_type")
            alert_time = a.get("time", 0)
            if alert_type and alert_time > last_handled:
                last_handled = alert_time
                print(f"[CAMERA] {alert_type} → queuing buzzer")
                pattern = BEEP_PATTERNS.get(alert_type, (2, 0.1))
                beep(pattern[0], pattern[1])   # queued, non-blocking
                clear_camera_alert()
        except:
            pass
        time.sleep(0.2)

def soar_listener():
    if not KAFKA_OK:
        return
    try:
        consumer = Consumer({
            "bootstrap.servers": KAFKA_BROKER,
            "group.id":          f"door-{DOOR_ID}",
            "auto.offset.reset": "latest",
            "log_level":         0,
        })
        consumer.subscribe(["soar.commands"])
        print("[SOAR] Listener ready on soar.commands")
        while True:
            msg = consumer.poll(1.0)
            if msg is None or msg.error():
                continue
            try:
                cmd       = json.loads(msg.value().decode())
                issued_by = cmd.get("issued_by", "")
                action    = cmd.get("action", "")
                door_id   = cmd.get("door_id", "")

                if action not in ("lock_door", "block_card", "unblock_card"):
                    continue
                if door_id and door_id != DOOR_ID:
                    continue
                print(f"[SOAR] cmd from={issued_by!r} action={action!r} door={door_id!r}")

                if action == "lock_door":
                    global _door_locked
                    _door_locked = True
                    print(f"[SOAR] Door LOCKED permanently — {cmd.get('reason', '')}")
                    _lock(); beep(5, 0.05)
                elif action == "block_card":
                    uid = cmd.get("card_uid", "")
                    if uid:
                        _blocked_mem.add(str(uid))
                        block_card(uid, cmd.get("reason", "soar_block"))
                        beep(3, 0.1)
                elif action == "unblock_card":
                    uid = cmd.get("card_uid", "")
                    if uid:
                        _blocked_mem.discard(str(uid))
                        unblock_card(uid)
                        beep(1, 0.2)
            except Exception as e:
                print(f"[SOAR] Parse error: {e}")
    except Exception as e:
        print(f"[SOAR] Failed: {e}")

# ── Door access logic ─────────────────────────────────────────────────────────
def handle_card(uid):
    if _door_locked:
        user = lookup_user(uid)
        name = user["name"] if user else str(uid)
        print(f"\n[SOAR] Door is LOCKED — denying {name} ({uid})")
        beep(3, 0.1)
        publish_event(uid, "denied", user, "door_locked_by_soar")
        return

    if str(uid) in _blocked_mem or is_card_blocked(uid):
        user = lookup_user(uid)
        name = user["name"] if user else str(uid)
        print(f"\n[BLOCK] Card {uid} ({name}) is BLOCKED — access denied")
        beep(5, 0.05)
        publish_event(uid, "denied", user, "card_blocked_by_soar")
        return

    user = lookup_user(uid)
    if user:
        name = user["name"]
        src  = "LDAP" if _ldap_ok else "hardcoded"
        print(f"\n[RFID] Card:{uid} → {name} ({user['role']}) [{src}]")
        beep(1, 0.3)
        publish_event(uid, "pending", user, "awaiting_face_verification")
        write_rfid_state(name, uid)
        clear_face_grant()

        print(f"[DOOR] Waiting for face verification (max {FACE_VERIFY_TIMEOUT}s)...")
        start   = time.time()
        granted = False
        while time.time() - start < FACE_VERIFY_TIMEOUT:
            if read_face_grant(name):
                granted = True
                break
            time.sleep(0.1)

        clear_rfid_state()
        clear_face_grant()

        if granted:
            print(f"[DOOR] Face VERIFIED for {name} → ACCESS GRANTED")
            beep(2, 0.15)
            _unlock()
            publish_event(uid, "granted", user, "face_verified")
            time.sleep(UNLOCK_SEC)
            _lock()
        else:
            print(f"[DOOR] Face NOT verified for {name} → ACCESS DENIED")
            beep(3, 0.15)
            publish_event(uid, "denied", user, "face_verification_timeout")
    else:
        print(f"\n[RFID] Unknown card: {uid}")
        beep(5, 0.05)
        publish_event(uid, "denied", None, "unknown_card")
        clear_rfid_state()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    try:
        lgpio.gpio_free(h, PIN_RELAY)
    except:
        pass
    lgpio.gpio_claim_input(h, PIN_RELAY, lgpio.SET_PULL_UP)
    _lock()
    # Take ownership of IPC files so container can write freely (sticky-bit fix)
    _recreate(RFID_STATE_FILE,   _EMPTY)
    _recreate(FACE_GRANT_FILE,   {"person": None, "granted": False, "time": 0})
    _recreate(CAMERA_ALERT_FILE, {"alert_type": None, "time": 0})
    # Blocked cards: preserve existing list across restarts, just take ownership
    try:
        existing = json.load(open(BLOCKED_CARDS_FILE))
    except:
        existing = {"blocked_uids": [], "log": []}
    _recreate(BLOCKED_CARDS_FILE, existing)
    _blocked_mem.update(existing.get("blocked_uids", []))
    if _blocked_mem:
        print(f"[BLOCK] Restored {len(_blocked_mem)} blocked card(s) from disk: {_blocked_mem}")

    # start non-blocking buzzer worker FIRST
    threading.Thread(target=_beep_worker, daemon=True).start()

    # start other background threads
    threading.Thread(target=vibration_monitor,    daemon=True).start()
    threading.Thread(target=camera_alert_monitor, daemon=True).start()
    threading.Thread(target=soar_listener,        daemon=True).start()
    threading.Thread(target=_load_ldap_background, daemon=True).start()



    print("=" * 45)
    print("  MASS PAC — RFID DOOR CONTROLLER")
    print(f"  Door   : {DOOR_ID}")
    print(f"  Kafka  : {'OK' if KAFKA_OK else 'OFFLINE'}")
    print(f"  LDAP   : loading in background...")
    print(f"  Buzzer : non-blocking queue mode")
    print("=" * 45)
    print("Scanning for cards...\n")

    last_uid      = None
    last_uid_time = 0

    reader = SimpleMFRC522()
    print("[RFID] Ready — waiting for card...")

    try:
        while True:
            uid, _ = reader.read()

            if uid is None:
                continue

            # debounce
            now = time.time()
            if uid == last_uid and (now - last_uid_time) < DEBOUNCE_SEC:
                time.sleep(1.0)
                continue

            last_uid      = uid
            last_uid_time = now

            handle_card(uid)
            last_uid_time = time.time()  # restart debounce window after full processing
            time.sleep(1.5)

    except KeyboardInterrupt:
        print("\n[RFID] Shutting down...")
    finally:
        _lock()
        if _producer:
            _producer.flush(3)
        lgpio.gpiochip_close(h)
        print("[RFID] Locked and stopped.")

if __name__ == "__main__":
    main()
