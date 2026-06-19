#!/usr/bin/env python3
"""
MASS PAC — Camera Agent HEADLESS (final, robust, CPU-friendly)
Run via SSH:
  python3 ~/camera_agent_headless.py

Design:
  - Single-threaded — no race conditions
  - CPU-friendly — 6fps, ~15% CPU
  - Robust against noise — multi-frame confirmation
  - Lower face verify timeout (15s)
  - Smart confidence formula
  - LDAP photo sync on startup — enrolled_faces.json is the offline cache
"""
import os, sys, time, json, uuid, base64, threading
from collections import deque, Counter
import cv2, numpy as np
from datetime import datetime
from pathlib import Path

# ── face_recognition ──────────────────────────────────────────────────────────
try:
    import face_recognition as FR
    print("[FR] face_recognition loaded OK")
except ImportError:
    print("[FR] Not installed — required")
    sys.exit(1)

for d in ("enrolled_photos", "forensic_snapshots", "logs"):
    os.makedirs(d, exist_ok=True)

# ── Kafka ─────────────────────────────────────────────────────────────────────
try:
    from confluent_kafka import Producer
    _producer = Producer({"bootstrap.servers":"192.168.60.10:9092",
                          "socket.timeout.ms":3000,"log_level":0})
    KAFKA_OK = True
    print("[KAFKA] Connected")
except:
    _producer = None; KAFKA_OK = False
    print("[KAFKA] Offline")

# ── Constants ─────────────────────────────────────────────────────────────────
DOOR_ID           = "door_acad_f1_d1"
ENROLLED_PATH     = "/home/pi/enrolled_faces.json"
HISTORY_PATH      = "logs/history.json"
RFID_STATE_FILE   = "/tmp/rfid_state.json"
FACE_GRANT_FILE   = "/tmp/face_grant.json"
CAMERA_ALERT_FILE = "/tmp/camera_alert.json"

LDAP_HOST          = "192.168.60.11"
LDAP_PORT          = 389
LDAP_ADMIN         = "cn=admin,dc=mass,dc=local"
LDAP_PASS          = "CampusSecure2026"
LDAP_BASE          = "dc=mass,dc=local"
LDAP_SYNC_INTERVAL = 300   # re-sync every 5 minutes

# Recognition tuning
EMBED_THRESHOLD        = 0.50
RFID_VERIFY_THRESHOLD  = 0.70  # looser threshold used only when RFID card already confirmed
NUM_JITTERS       = 1          # 1 = fastest; accuracy loss is minimal with HOG model
RECOG_AVG_FRAMES  = 2          # average over 2 frames before deciding
RECOG_INTERVAL    = 8          # every 8 frames when idle
RECOG_INTERVAL_RFID = 3        # every 3 frames when RFID active

# Alert confirmation thresholds (multi-frame to reject noise)
CONFIRM_UNKNOWN   = 15  # recognition frames at unknown before alerting (~18s)
CONFIRM_INSIDER   = 4
CONFIRM_TAILGATE  = 5
CONFIRM_MOTION    = 15  # require ~2.25s of sustained massive motion

# Timeouts
LOITER_SECONDS      = 45   # seconds before loitering alert (unknown only)
UNAUTH_SECONDS      = 30   # seconds of confirmed unknown presence before alert
KNOWN_GRACE_SECONDS = 20   # after seeing a known face, suppress unknown alerts for this long
RFID_TIMEOUT        = 15
AFTER_HOURS         = 22

# Motion threshold — needs ~65% of 640×480 frame to change per frame
MOTION_THRESHOLD  = 200000     # raised: normal movement stays well below this

# Loop pacing — gives CPU to RFID reader
LOOP_SLEEP        = 0.15       # ~6 fps

# Alert cooldowns
COOLDOWNS = {
    "face_mismatch":30, "unknown_person":30, "tailgating":30,
    "unauthorized_presence":30, "after_hours_presence":120,
    "loitering":30, "forced_entry":60,
    "insider_threat_physical_cyber":30,
}
_last_alert = {}

# ── Database ──────────────────────────────────────────────────────────────────
_db_lock = threading.Lock()

def load_db():
    if not Path(ENROLLED_PATH).exists():
        return {}, {}
    raw = json.load(open(ENROLLED_PATH))
    embs = {}
    for name, data in raw.items():
        if data.get("embedding"):
            embs[name] = np.array(data["embedding"], dtype=np.float32)
    return raw, embs

_raw_db, _embeddings = load_db()
_db_source = "cache"  # updated to "ldap" after a successful LDAP sync
history = json.load(open(HISTORY_PATH)) if Path(HISTORY_PATH).exists() else []

def save_db():
    with _db_lock:
        data = dict(_raw_db)
    with open(ENROLLED_PATH,"w") as f: json.dump(data,f,indent=2)
def save_hist():
    with open(HISTORY_PATH,"w") as f: json.dump(history,f,indent=2)

# ── LDAP photo sync ───────────────────────────────────────────────────────────
def _sync_ldap_photos():
    """
    Fetch jpegPhoto + employeeNumber from LDAP and build face embeddings.
    Saves results to enrolled_faces.json (the offline cache).
    Falls back silently if LDAP is unreachable.
    """
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
        server = Server(LDAP_HOST, port=LDAP_PORT, get_info=ALL, connect_timeout=5)
        conn   = Connection(server, LDAP_ADMIN, LDAP_PASS,
                            auto_bind=True, receive_timeout=10)
        conn.search(
            search_base   = LDAP_BASE,
            search_filter = "(employeeNumber=*)",
            search_scope  = SUBTREE,
            attributes    = ["cn", "employeeNumber", "employeeType", "jpegPhoto"],
        )
        updated = 0
        for entry in conn.entries:
            try:
                name     = str(entry.cn)
                if name == "Hala":  # commented out — treated as unknown
                    continue
                card_uid = int(str(entry.employeeNumber))
                role     = str(entry.employeeType) if entry.employeeType else "student"

                with _db_lock:
                    existing = _raw_db.get(name, {})

                # Build embedding from LDAP photo if present
                embedding = None
                if entry.jpegPhoto and entry.jpegPhoto.value:
                    img_arr = np.frombuffer(entry.jpegPhoto.value, dtype=np.uint8)
                    bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
                    if bgr is not None:
                        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                        locs = FR.face_locations(rgb, model="hog")
                        if locs:
                            encs = FR.face_encodings(rgb,
                                                     known_face_locations=locs,
                                                     num_jitters=NUM_JITTERS)
                            if encs:
                                embedding = encs[0]
                                cv2.imwrite(f"enrolled_photos/{name}_ldap.jpg", bgr)

                entry_data = {
                    "card_uid":       card_uid,
                    "role":           role,
                    "access_history": existing.get("access_history", []),
                    "samples":        existing.get("samples", 0),
                    "status":         "active",
                    "enrolled_at":    existing.get("enrolled_at",
                                          datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
                    "ldap_synced":    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "ldap_source":    "photo" if embedding is not None else "no_photo",
                }
                # Prefer manually enrolled embedding (samples > 1 = captured live from camera)
                # over LDAP photo — LDAP photos are often passport-style and match poorly
                manually_enrolled = existing.get("samples", 0) > 1 and existing.get("embedding")
                if manually_enrolled:
                    entry_data["embedding"]   = existing["embedding"]
                    entry_data["samples"]     = existing["samples"]
                    entry_data["ldap_source"] = "manual"
                elif embedding is not None:
                    entry_data["embedding"] = embedding.tolist()
                    entry_data["samples"]   = max(1, existing.get("samples", 0))
                elif existing.get("embedding"):
                    entry_data["embedding"] = existing["embedding"]

                with _db_lock:
                    _raw_db[name] = entry_data
                    use_emb = np.array(entry_data["embedding"], dtype=np.float32) if entry_data.get("embedding") else None
                    if use_emb is not None:
                        _embeddings[name] = use_emb
                    elif existing.get("embedding"):
                        _embeddings[name] = np.array(existing["embedding"],
                                                      dtype=np.float32)
                updated += 1
            except Exception as e:
                print(f"[LDAP] Entry error: {e}")
                continue
        conn.unbind()
        save_db()
        global _db_source
        _db_source = "ldap"
        with_photos = sum(1 for v in _raw_db.values() if v.get("ldap_source") == "photo")
        print(f"[LDAP] Sync OK — {updated} users, {with_photos} with photos")
        return True
    except Exception as e:
        print(f"[LDAP] Sync failed: {e} — using cached DB")
        return False  # _db_source stays "cache"

def _ldap_sync_worker():
    """Background thread: sync on startup then every LDAP_SYNC_INTERVAL seconds."""
    _sync_ldap_photos()
    while True:
        time.sleep(LDAP_SYNC_INTERVAL)
        _sync_ldap_photos()

# ── Logging ───────────────────────────────────────────────────────────────────
def log(msg, level="INFO"):
    c = {"OK":"\033[92m","ALERT":"\033[93m","CRITICAL":"\033[91m"}.get(level,"")
    print(f"{c}[{datetime.now().strftime('%H:%M:%S')}] {msg}\033[0m", flush=True)

# ── Alert helpers ─────────────────────────────────────────────────────────────
def can_fire(t):
    now = time.time()
    if now - _last_alert.get(t,0) >= COOLDOWNS.get(t,30):
        _last_alert[t] = now; return True
    return False

def pub_alert(alert_type, severity, person, details=None, silent=False):
    """Publish alert. silent=True logs locally but suppresses Kafka — used for passive camera
    surveillance when no RFID scan is active, preventing alert flooding."""
    if not can_fire(alert_type): return None
    a = {"alert_type":alert_type,"severity":severity,"person":person,
         "door_id":DOOR_ID,"timestamp":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
         "sensor":"camera-agent-01","details":details or {}}
    if _producer and not silent:
        try: _producer.produce("pac.alerts",json.dumps(a).encode()); _producer.poll(0)
        except: pass
    prefix = "PASSIVE" if silent else "ALERT"
    log(f"{prefix}: {alert_type} | {severity} | {person}",
        "CRITICAL" if severity=="CRITICAL" else "ALERT")
    history.append(a); save_hist()
    return a

def pub_pac_event(uid, access, person, reason):
    p = {"event_id":str(uuid.uuid4()),"device_id":"RFID-ACADEMIC-F1-DOOR1-01",
         "device_type":"rfid_reader","zone":"Academic/Floor1/Door1",
         "gateway_id":"GW-PAC-ACADEMIC-F1-01","card_uid":str(uid),
         "access":access,"reason":reason,
         "ldap_result":"AUTHORIZED" if person else "NOT_FOUND",
         "hour":datetime.now().hour,"building":"building_a","floor":1,
         "door_id":DOOR_ID,"timestamp":datetime.now().isoformat()}
    if person: p["user_name"] = person
    if _producer:
        try: _producer.produce("pac.events",json.dumps(p).encode()); _producer.poll(0)
        except: pass

_cap = None  # global camera handle set after open — used by save_snap for fresh capture

def grab_best_frame(fallback, flush=8, samples=8):
    """Flush stale buffer, let AE settle, then pick sharpest frame by Laplacian variance."""
    if _cap is None:
        return fallback
    try:
        # Drain the buffer completely — MJPEG buffers can hold several stale frames
        for _ in range(flush):
            _cap.read()
            time.sleep(0.04)   # 40ms between reads @ 30fps = one new frame each time
        time.sleep(0.25)       # let auto-exposure settle after scene change
        best, best_score = fallback, -1.0
        for _ in range(samples):
            ret, f = _cap.read()
            if not ret or f is None:
                time.sleep(0.04)
                continue
            score = cv2.Laplacian(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
            if score > best_score:
                best, best_score = f.copy(), score
            time.sleep(0.04)   # one frame apart — don't grab duplicates
        log(f"Snap sharpness score: {best_score:.1f}")
        return best
    except:
        return fallback

def save_snap(frame, reason, person, publish=False, severity="HIGH", details=None):
    snap  = grab_best_frame(frame)   # always grab a fresh sharp frame
    ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"forensic_snapshots/{reason}_{person}_{ts}.jpg"
    cv2.imwrite(fname, snap)
    log(f"SNAP saved: {fname}")
    if publish and _producer:
        try:
            _, buf = cv2.imencode(".jpg", snap, [cv2.IMWRITE_JPEG_QUALITY, 85])
            b64 = base64.b64encode(buf.tobytes()).decode()
            payload = {"event_id":str(uuid.uuid4()),"alert_type":reason,
                       "person":person,"door_id":DOOR_ID,"severity":severity,
                       "timestamp":datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                       "sensor":"camera-agent-01","image_b64":b64,
                       "image_format":"jpeg","details":details or {}}
            _producer.produce("pac.alerts", json.dumps(payload).encode())
            _producer.poll(0)
            log(f"Snapshot→pac.alerts [{reason}|{person}] {len(b64)//1024}KB","OK")
        except Exception as e:
            log(f"Snap publish error:{e}","ALERT")
    return fname

# ── IPC ───────────────────────────────────────────────────────────────────────
def get_rfid_state():
    try:
        with open(RFID_STATE_FILE,"r") as f: s = json.load(f)
        if s.get("person") and (time.time()-s.get("time",0)) < RFID_TIMEOUT:
            return s["person"], s.get("uid"), s["time"]
    except: pass
    return None, None, 0

def write_face_grant(person, granted):
    try:
        with open(FACE_GRANT_FILE,"w") as f:
            json.dump({"person":person,"granted":granted,"time":time.time()},f)
        log(f"Grant→{person}: {'YES' if granted else 'NO'}",
            "OK" if granted else "ALERT")
    except: pass

def write_camera_alert(alert_type):
    try:
        with open(CAMERA_ALERT_FILE,"w") as f:
            json.dump({"alert_type":alert_type,"time":time.time()},f)
    except: pass

# ── Recognition ───────────────────────────────────────────────────────────────
def detect_and_recognize(bgr_frame, rfid_expected=None):
    """
    Face detection via dlib HOG (same backend as face_recognition — far more
    reliable than Haar cascade). Detects at half-resolution for speed, then
    encodes at full resolution for accuracy.
    Returns (name, confidence, distance, face_count, main_box).
    """
    with _db_lock:
        embs = dict(_embeddings)
    if not embs:
        return None, 0.0, 1.0, 0, None

    # Half-res for faster HOG detection (~4x speedup on Pi)
    small    = cv2.resize(bgr_frame, (0, 0), fx=0.5, fy=0.5)
    rgb_small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    rgb_full  = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)

    locs_small = FR.face_locations(rgb_small, model="hog")
    fcount = len(locs_small)
    if fcount == 0:
        return None, 0.0, 1.0, 0, None

    # Scale locations back to full resolution
    locs_full = [(top*2, right*2, bottom*2, left*2)
                 for (top, right, bottom, left) in locs_small]

    # Largest face for recognition
    main_loc = max(locs_full, key=lambda l: (l[2]-l[0]) * (l[1]-l[3]))
    top, right, bottom, left = main_loc
    main_box = (left, top, right-left, bottom-top)  # (x, y, w, h)

    try:
        encs = FR.face_encodings(rgb_full, known_face_locations=[main_loc],
                                 num_jitters=NUM_JITTERS)
        if not encs:
            return None, 0.0, 1.0, fcount, main_box
    except Exception as e:
        log(f"Encoding error: {e}", "ALERT")
        return None, 0.0, 1.0, fcount, main_box

    emb    = encs[0]
    names  = list(embs.keys())
    stored = np.stack(list(embs.values()))
    dists  = np.linalg.norm(stored - emb, axis=1)
    idx    = int(np.argmin(dists))
    dist   = float(dists[idx])

    if dist < 0.30:
        conf = 0.95
    elif dist < 0.40:
        conf = round(0.95 - (dist - 0.30) * 2.0, 4)
    elif dist < 0.50:
        conf = round(0.75 - (dist - 0.40) * 2.5, 4)
    else:
        conf = round(max(0.0, 0.50 - (dist - 0.50) * 5.0), 4)

    name = names[idx] if dist < EMBED_THRESHOLD else None
    # RFID-assisted: card already confirmed identity, so accept a looser face match
    # against the specific expected person — prevents a bad LDAP photo from blocking access
    if name is None and rfid_expected and names[idx] == rfid_expected and dist < RFID_VERIFY_THRESHOLD:
        name = rfid_expected
        conf = 0.60  # fixed sentinel: RFID-confirmed, not purely face-based
    return name, conf, dist, fcount, main_box

# ── Main loop ─────────────────────────────────────────────────────────────────
def run():
    log("="*45)
    log(f"  MASS Camera HEADLESS — final build")
    log(f"  Enrolled: {list(_raw_db.keys())}  src={_db_source}")
    log(f"  CPU-friendly: ~6fps, single thread")
    log(f"  RFID timeout: {RFID_TIMEOUT}s | known-grace: {KNOWN_GRACE_SECONDS}s")
    log(f"  LDAP sync: {LDAP_HOST} every {LDAP_SYNC_INTERVAL}s")
    log("="*45)

    # Start LDAP sync in background (updates _raw_db / _embeddings live)
    threading.Thread(target=_ldap_sync_worker, daemon=True).start()



    # Open USB camera — retry until available and warmed up
    # USB camera is at /dev/video1 on this Pi (video0 does not exist)
    CAMERA_PATHS = ['/dev/video1', '/dev/video2'] + [f'/dev/video{i}' for i in range(36) if i not in (1, 2)]
    cap = None
    while True:
        for path in CAMERA_PATHS:
            c = cv2.VideoCapture(path, cv2.CAP_V4L2)
            if not c.isOpened():
                c.release()
                continue
            # Set MJPEG + 1280x720 BEFORE first read so driver locks in the format
            c.set(cv2.CAP_PROP_FOURCC,       cv2.VideoWriter_fourcc(*'MJPG'))
            c.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
            c.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            c.set(cv2.CAP_PROP_BUFFERSIZE,   1)
            c.set(cv2.CAP_PROP_FPS,          30)
            time.sleep(0.5)
            ret, f = c.read()
            if ret and f is not None:
                cap = c
                global _cap
                _cap = cap
                log(f"Camera opened: {path} MJPG 1280x720 @ 30fps", "OK")
                break
            c.release()
        if cap is None:
            log("Camera not ready — retrying in 10s", "ALERT")
            time.sleep(10)
            continue

        log("Warming up camera...")
        for _ in range(20):
            cap.read()
            time.sleep(0.05)
        ret, test = cap.read()
        if not ret:
            log("Camera warmup failed — retrying in 5s", "ALERT")
            cap.release()
            cap = None
            time.sleep(5)
            continue
        log(f"Camera OK: {test.shape}", "OK")
        break

    # State
    lrp_person           = None
    lrp_time             = 0.0
    session_uid          = 0      # card UID for the current access session — persists after rfid_state is cleared by door process
    grace_start          = 0.0
    tailgate_immune_until = 0.0   # suppress tailgate check briefly after grant
    loiter        = {}
    unauth_start  = None
    tg_count      = 0
    fc            = 0
    prev_gray     = None
    motion_hc     = 0

    recog_history       = deque(maxlen=RECOG_AVG_FRAMES)
    unknown_count       = 0
    unknown_first_seen  = None
    insider_count       = 0
    last_status_fc      = 0
    fcount              = 0     # persisted — only updated on recognition frames
    face_stable         = False
    last_known_name     = None  # tracks last stable recognized name for change-reset
    last_recognized_time = 0.0  # timestamp of last successful is_low recognition

    log("Running! Ctrl+C to stop","OK")

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.05); continue

            now = datetime.now()
            bgr = frame.copy()

            # ── RFID state ────────────────────────────────────────────────────
            rfid_person, rfid_uid, rfid_time = get_rfid_state()
            if rfid_person:
                if rfid_person != lrp_person:
                    # New person scanned
                    lrp_person  = rfid_person
                    lrp_time    = rfid_time
                    session_uid = session_uid
                    recog_history.clear()
                    insider_count = 0
                    log(f"RFID detected: {lrp_person} uid={session_uid}", "OK")
                elif rfid_time != lrp_time:
                    # Same person re-scanned — reset 15 s window
                    lrp_time    = rfid_time
                    session_uid = rfid_uid or session_uid
                    log(f"RFID re-scan: {lrp_person} — timer reset", "OK")

            rfid_active = bool(lrp_person and (time.time() - lrp_time) < RFID_TIMEOUT)
            in_grace    = (time.time() - grace_start) < 30

            # Clear stale RFID session once its window expires
            if lrp_person and not rfid_active:
                log(f"RFID expired: {lrp_person} — cleared", "INFO")
                lrp_person = None; lrp_time = 0; session_uid = 0
                recog_history.clear()

            # ── Recognition (throttled) ──────────────────────────────────────
            mn_name  = None
            conf     = 0.0
            dist     = 1.0
            main_box = None
            # fcount is NOT reset here — it persists from last recognition frame

            interval = RECOG_INTERVAL_RFID if rfid_active else RECOG_INTERVAL
            if fc % interval == 0:
                _mn, _cf, _ds, _fc, _box = detect_and_recognize(
                    bgr, rfid_expected=lrp_person if rfid_active else None)
                mn_name, conf, dist, fcount, main_box = _mn, _cf, _ds, _fc, _box
                if fcount > 0:
                    recog_history.append((mn_name, conf, dist))
                else:
                    recog_history.clear()

            # Use averaged result for stability
            if len(recog_history) >= RECOG_AVG_FRAMES:
                names = [r[0] for r in recog_history]
                voted = Counter(names).most_common(1)[0][0]
                matching = [r for r in recog_history if r[0] == voted]
                mn_name = voted
                conf    = sum(r[1] for r in matching) / len(matching)
                dist    = sum(r[2] for r in matching) / len(matching)

            is_match = mn_name is not None and conf >= 0.50
            is_low   = mn_name is not None and conf >= 0.30

            # face_stable: recognition has been consistent for RECOG_AVG_FRAMES runs
            face_stable = len(recog_history) >= RECOG_AVG_FRAMES
            # reset alert counters when the recognised name changes (person moved/switched)
            if face_stable and mn_name != last_known_name:
                last_known_name = mn_name
                unknown_count   = 0
                unauth_start    = None

            # Track time of last successful recognition (any known person)
            if is_low:
                last_recognized_time = time.time()

            # ── Status log every 30 frames (~5 sec) ───────────────────────────
            if fc - last_status_fc >= 30:
                last_status_fc = fc
                grace_ago = int(time.time() - last_recognized_time) if last_recognized_time else 999
                log(f"STATUS faces={fcount} match={mn_name or 'NONE'} "
                    f"conf={conf*100:.0f}% dist={dist:.3f} "
                    f"rfid={lrp_person or 'none'} src={_db_source} "
                    f"stable={'Y' if face_stable else 'N'} "
                    f"known_ago={grace_ago}s")

            # ── CAP 3: TAILGATING ────────────────────────────────────────────
            # Fire during RFID session (person scanning) OR during grace (door open)
            # Skip for a few seconds after grant so the verified person can walk through
            tailgating_active = False
            if fcount > 1 and (rfid_active or in_grace) \
                    and time.time() > tailgate_immune_until:
                tg_count += 1
                if tg_count >= CONFIRM_TAILGATE:
                    tailgating_active = True
                    a = pub_alert("tailgating","HIGH",mn_name or "UNKNOWN",
                                  {"face_count":fcount})
                    if a:
                        save_snap(bgr,"tailgating",mn_name or "UNKNOWN",
                                  publish=True,severity="HIGH",
                                  details={"face_count":fcount,"card_owner":lrp_person})
                        write_camera_alert("tailgating")
                    tg_count = 0
            else:
                tg_count = 0

            # ── CAP 1: FACE VERIFY ────────────────────────────────────────────
            if rfid_active and not tailgating_active and fcount > 0 and mn_name:
                if mn_name == lrp_person and is_match:
                    # CORRECT person
                    log(f"✓ ACCESS GRANTED: {lrp_person} conf={conf*100:.0f}% dist={dist:.3f}","OK")
                    write_face_grant(lrp_person, True)
                    pub_pac_event(session_uid,"granted",lrp_person,"face_verified")
                    save_snap(bgr,"access_granted",lrp_person,
                              publish=True,severity="INFO",
                              details={"confidence":round(conf,3),"distance":round(dist,3)})
                    with _db_lock:
                        _raw_db[lrp_person].setdefault("access_history",[]).append(
                            {"timestamp":now.strftime("%Y-%m-%d %H:%M:%S"),
                             "result":"GRANTED","confidence":conf})
                    save_db()
                    grace_start           = time.time()
                    tailgate_immune_until = grace_start + 7  # 7s for person to walk through
                    lrp_person  = None; lrp_time = 0
                    recog_history.clear()
                    insider_count = 0
                    unknown_count = 0
                    fcount   = 0
                    tg_count = 0
                    # Wait for door to read the grant before continuing
                    log("Waiting for door to process grant...","OK")
                    time.sleep(3)

                elif mn_name != lrp_person and is_match:
                    # WRONG person — insider threat
                    insider_count += 1
                    if insider_count >= CONFIRM_INSIDER:
                        log(f"✗ INSIDER THREAT: card={lrp_person} face={mn_name} conf={conf*100:.0f}%","CRITICAL")
                        a = pub_alert("insider_threat_physical_cyber","CRITICAL",
                                      lrp_person,
                                      {"card_owner":lrp_person,
                                       "face_detected":mn_name,
                                       "confidence":round(conf,3)})
                        if a:
                            save_snap(bgr,"insider_threat_physical_cyber",lrp_person,
                                      publish=True,severity="CRITICAL",
                                      details={"card_owner":lrp_person,
                                               "face_detected":mn_name,
                                               "confidence":round(conf,3)})
                            write_camera_alert("insider_threat_physical_cyber")
                        pub_pac_event(session_uid, "denied", lrp_person,
                                      "insider_threat_detected")
                        write_face_grant(lrp_person, False)
                        lrp_person = None; lrp_time = 0; session_uid = 0
                        recog_history.clear()
                        insider_count = 0

            # ── CAP 1b: face_mismatch when RFID timeout approaching ──────────
            elif rfid_active and not tailgating_active:
                rem = RFID_TIMEOUT - (time.time()-lrp_time)
                if rem < 3 and fcount > 0 and not is_match:
                    a = pub_alert("face_mismatch","HIGH",lrp_person,
                                  {"expected":lrp_person,"detected":mn_name,
                                   "confidence":round(conf,3)})
                    if a:
                        save_snap(bgr,"face_mismatch",lrp_person or "?",
                                  publish=True,severity="HIGH",
                                  details={"expected":lrp_person,"detected":mn_name})
                        write_camera_alert("face_mismatch")
                    # Face detected but doesn't match card owner → block the card
                    pub_pac_event(session_uid, "denied", lrp_person,
                                  "insider_threat_detected")
                    write_face_grant(lrp_person, False)
                    lrp_person = None; lrp_time = 0; session_uid = 0

            # ── CAP 2 / 4 / 6 gate ────────────────────────────────────────────
            # Passive surveillance alerts are silent (no Kafka) unless there is
            # an active scan session or grace window. Prevents alert flooding when
            # people simply walk past the camera without any access attempt.
            with _db_lock:
                has_db = bool(_raw_db)
            _known_recently   = (time.time() - last_recognized_time) < KNOWN_GRACE_SECONDS
            _in_access_event  = rfid_active or in_grace   # real scan happening

            # ── CAP 2: UNKNOWN PERSON ─────────────────────────────────────────
            if has_db and fcount > 0 and face_stable and not is_low \
                    and not rfid_active and not in_grace and not _known_recently:
                if unknown_first_seen is None:
                    unknown_first_seen = time.time()
                unknown_count += 1
                if unknown_count >= CONFIRM_UNKNOWN:
                    elapsed  = time.time() - unknown_first_seen
                    severity = "HIGH" if elapsed >= 120 else "MEDIUM"
                    a = pub_alert("unknown_person", severity, "UNKNOWN",
                                  {"best_match":mn_name,"confidence":round(conf,3)},
                                  silent=not _in_access_event)
                    if a:
                        save_snap(bgr,"unknown_person","UNKNOWN",
                                  publish=_in_access_event, severity=severity,
                                  details={"best_match":mn_name,"confidence":round(conf,3)})
                        write_camera_alert("unknown_person")
                    unknown_count = 0
            else:
                unknown_count      = 0
                unknown_first_seen = None

            # ── CAP 4: UNAUTHORIZED PRESENCE ──────────────────────────────────
            if fcount > 0 and face_stable and not is_low \
                    and not rfid_active and not in_grace and not _known_recently:
                if unauth_start is None: unauth_start = time.time()
                el = time.time() - unauth_start
                if el >= UNAUTH_SECONDS:
                    a = pub_alert("unauthorized_presence","MEDIUM",
                                  mn_name or "UNKNOWN",{"seconds":int(el)},
                                  silent=not _in_access_event)
                    if a:
                        save_snap(bgr,"unauthorized",mn_name or "UNKNOWN",
                                  publish=_in_access_event,severity="MEDIUM",
                                  details={"seconds":int(el)})
                        write_camera_alert("unauthorized_presence")
            else:
                unauth_start = None

            # ── CAP 5: AFTER HOURS — only publish when scan is active ───────
            if fcount > 0 and now.hour >= AFTER_HOURS:
                a = pub_alert("after_hours_presence","HIGH",
                              mn_name or "UNKNOWN",{"hour":now.hour},
                              silent=not _in_access_event)
                if a:
                    save_snap(bgr,"after_hours",mn_name or "UNKNOWN",
                              publish=_in_access_event,severity="HIGH",
                              details={"hour":now.hour})
                    write_camera_alert("after_hours_presence")

            # ── CAP 6: LOITERING — unknown faces only, silent without scan ────
            if fcount > 0 and face_stable and not is_low and not in_grace and not _known_recently:
                if "UNKNOWN" not in loiter: loiter["UNKNOWN"] = time.time()
                el = time.time() - loiter["UNKNOWN"]
                if el >= LOITER_SECONDS:
                    a = pub_alert("loitering","MEDIUM","UNKNOWN",{"seconds":int(el)},
                                  silent=not _in_access_event)
                    if a:
                        save_snap(bgr,"loitering","UNKNOWN",
                                  publish=_in_access_event,severity="MEDIUM",
                                  details={"seconds":int(el)})
                        write_camera_alert("loitering")
            else:
                loiter.clear()

            # ── CAP 7: FORCED ENTRY (motion) — needs many frames ─────────────
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            if prev_gray is not None:
                diff = cv2.absdiff(prev_gray, gray)
                _, th = cv2.threshold(diff, 30, 255, cv2.THRESH_BINARY)
                mpx = int(np.sum(th) / 255)
                if mpx > MOTION_THRESHOLD:
                    motion_hc += 1
                    if motion_hc >= CONFIRM_MOTION:
                        a = pub_alert("forced_entry","CRITICAL",
                                      mn_name or "UNKNOWN",{"motion_pixels":mpx},
                                      silent=not _in_access_event)
                        if a:
                            save_snap(bgr,"forced_entry",mn_name or "UNKNOWN",
                                      publish=_in_access_event,severity="CRITICAL",
                                      details={"motion_pixels":mpx,
                                               "face_detected":mn_name or "UNKNOWN"})
                            write_camera_alert("forced_entry")
                        motion_hc = 0
                else:
                    motion_hc = 0  # any quiet frame resets — requires consecutive frames
            prev_gray = gray.copy()

            fc += 1
            time.sleep(LOOP_SLEEP)   # gives CPU to RFID reader

    except KeyboardInterrupt:
        log("Stopping...")
    finally:
        cap.release()
        log("Camera agent stopped.")

run()
