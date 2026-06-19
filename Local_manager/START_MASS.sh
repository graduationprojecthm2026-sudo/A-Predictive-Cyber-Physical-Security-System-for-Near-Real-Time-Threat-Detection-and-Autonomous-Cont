#!/bin/bash

REPO_DIR="$HOME/Desktop/agents-test-main/agents-test-main"

echo "============================================"
echo "  MASS - Local Manager Startup (Malak)"
echo "  Building A - 192.168.40.10"
echo "============================================"
echo ""

# ── 1. Verify network connectivity ───────────────────────────────────────────
echo "[1/5] Checking network..."
if ! ping -c 1 -W 2 192.168.60.10 > /dev/null 2>&1; then
    echo "ERROR: Cannot reach Menna server room (192.168.60.10)"
    echo "       Make sure Menna's Docker stack is running first."
    exit 1
fi
if ! nc -z -w 3 192.168.60.10 9092 > /dev/null 2>&1; then
    echo "ERROR: Kafka not reachable at 192.168.60.10:9092"
    echo "       Ask Menna to confirm campus-kafka container is running."
    exit 1
fi
echo "OK - Menna reachable, Kafka up"
echo ""

# ── 2. Start local manager containers ────────────────────────────────────────
# IoT and Data run via Docker (image is stable).
# PAC runs as Python directly so it always uses the latest main.py
# with KNOWN_DOORS whitelist and spoofed-door-injection detection.
echo "[2/5] Starting Local Manager containers..."
cd "$REPO_DIR/docker"
docker compose up -d campus-data-local-manager campus-iot-local-manager
echo "  Waiting 10 seconds for IoT/Data containers..."
sleep 10

echo "  Starting PAC local manager (Python direct — uses latest security fixes)..."
pkill -f "managers.pac_local_manager" 2>/dev/null
fuser -k 8011/tcp 2>/dev/null
sleep 1
cd "$REPO_DIR"
MANAGER_ID=pac-local-manager-01 \
KAFKA_BOOTSTRAP=192.168.60.10:9092 \
HEALTH_PORT=8011 \
APPROVAL_WINDOW_SEC=60 \
PG_HOST=192.168.60.10 PG_PORT=5432 PG_DB=massdb \
PG_USER=massadmin PG_PASS=mass2026 \
python3 -m managers.pac_local_manager.main > /tmp/pac_mgr.log 2>&1 &
PAC_PID=$!
echo "  PAC manager PID=$PAC_PID — logs: /tmp/pac_mgr.log"
sleep 5
echo ""

# ── 3. Verify containers are healthy ─────────────────────────────────────────
echo "[3/5] Verifying container health..."
DATA_HEALTH=$(curl -s http://localhost:8012/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
IOT_HEALTH=$(curl -s http://localhost:8010/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
PAC_HEALTH=$(curl -s http://localhost:8011/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)

echo "  Data Local Manager (8012): ${DATA_HEALTH:-UNREACHABLE}"
echo "  IoT  Local Manager (8010): ${IOT_HEALTH:-UNREACHABLE}"
echo "  PAC  Local Manager (8011): ${PAC_HEALTH:-UNREACHABLE}"
echo ""

# ── 4. Start SOAR Executor ────────────────────────────────────────────────────
echo "[4/5] Starting SOAR Executor (SSH enforcement to Core-SW)..."
if [ -f ~/soar_executor.py ]; then
    python3 ~/soar_executor.py &
    SOAR_PID=$!
    sleep 3
    if kill -0 $SOAR_PID 2>/dev/null; then
        echo "OK - SOAR Executor running (PID $SOAR_PID)"
        echo "     Listening on soar.commands -> will SSH to Core-SW on isolation trigger"
    else
        echo "WARNING: SOAR Executor failed to start - check ~/soar_executor.py"
    fi
else
    echo "WARNING: ~/soar_executor.py not found - isolation will not be automatic"
fi
echo ""

# ── 5. Start heartbeat ────────────────────────────────────────────────────────
echo "[5/5] Starting agent heartbeat publisher..."
python3 - << 'PYEOF' &
import sys, time, os
sys.path.insert(0, os.path.expanduser('~/Desktop/agents-test-main/agents-test-main'))
try:
    from common.kafka_client import KafkaProducerClient, Topics
    from datetime import datetime, timezone

    agents = [
        "iot-local-manager-01",
        "pac-local-manager-01",
        "data-local-manager-01",
    ]

    producer = KafkaProducerClient("192.168.60.10:9092")
    print("Heartbeat running for local managers...")

    while True:
        for a in agents:
            producer.publish(Topics.HEARTBEATS, {
                "agent_id": a,
                "status": "running",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stats": {}
            }, key=a)
        producer.flush()
        time.sleep(10)

except Exception as e:
    print(f"Heartbeat error: {e}")
PYEOF

sleep 2
echo "OK - Heartbeat running"
echo ""

# ── 6 (was missing). Start dashboard proxy ───────────────────────────────────
echo "[6/6] Starting dashboard proxy (server.py)..."
pkill -f server.py 2>/dev/null
sleep 1
cd "$REPO_DIR"
python3 server.py > /tmp/server.log 2>&1 &
SRV_PID=$!
sleep 2
if kill -0 $SRV_PID 2>/dev/null; then
    echo "OK - Dashboard running (PID $SRV_PID)"
    echo "     http://192.168.40.10:8080/local_manager.html"
else
    echo "WARNING: server.py failed to start - check /tmp/server.log"
fi
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "============================================"
echo "  MASS Local Manager is LIVE"
echo "============================================"
echo ""
echo "  Dashboard:     http://192.168.40.10:8080/local_manager.html"
echo ""
echo "  Endpoints:"
echo "    Data alerts : http://192.168.40.10:8012/alerts"
echo "    Data pending: http://192.168.40.10:8012/pending"
echo "    IoT alerts  : http://192.168.40.10:8010/alerts"
echo "    PAC alerts  : http://192.168.40.10:8011/alerts"
echo ""
echo "  NOTE: Pi EDA agents (pac-eda-agent-01, credential-anomaly-agent-01)"
echo "  must be running on the Raspberry Pi for RFID event enrichment."
echo "  Without them, /events will show raw events with empty door_id."
echo ""
echo "  To approve an incident manually:"
echo "    curl -X POST http://localhost:8012/approve/{incident_id}"
echo ""
echo "  To watch live alerts:"
echo "    curl http://localhost:8012/alerts"
echo "    curl http://localhost:8012/pending"
echo ""
echo "  To stop everything:"
echo "    pkill -f 'server.py|soar_executor.py|managers.pac_local_manager'"
echo "    docker compose stop campus-data-local-manager campus-iot-local-manager"
echo "    Logs: /tmp/pac_mgr.log  /tmp/server.log  /tmp/soar.log"
echo ""
