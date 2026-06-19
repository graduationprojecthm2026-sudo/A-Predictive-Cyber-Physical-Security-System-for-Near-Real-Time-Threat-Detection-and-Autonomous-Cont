#!/bin/bash
# ============================================================
#  MASS — Malak's VM Startup Script
#  Run this every time you open the VM:
#    chmod +x start_localmanager.sh   (first time only)
#    ./start_localmanager.sh
#
#  What this does:
#    • Starts IoT + Data local managers via Docker
#    • Starts PAC local manager as Python (not Docker) so it
#      uses the fixed code with Postgres and whitelist support
#    • Pi EDA agents (pac-eda-agent, credential-anomaly-agent)
#      run on the Pi — do NOT start them here (consumer group conflict)
#    • Starts server.py dashboard on :8080
# ============================================================

REPO_DIR="$HOME/Desktop/agents-test-main (Copy 9)/agents-test-main"

echo "======================================================"
echo "  MASS — VM Startup"
echo "======================================================"

# ── Step 1: Kill any old running instances ─────────────────
echo "[1/5] Cleaning up old processes..."
pkill -f server.py 2>/dev/null
pkill -f soar_executor.py 2>/dev/null
pkill -f "managers.pac_local_manager" 2>/dev/null
fuser -k 8011/tcp 2>/dev/null
docker rm -f campus-pac-local-manager \
             campus-iot-local-manager \
             campus-data-local-manager 2>/dev/null
sleep 2

# ── Step 2: Build image (skips if already built) ──────────
echo "[2/5] Building mass-agent Docker image (skips if exists)..."
cd "$REPO_DIR/docker"
docker build -t mass-agent -f Dockerfile.agent .. 2>/dev/null \
  && echo "  Image built." \
  || echo "  Using existing image."

# ── Step 3: Start IoT and Data managers via Docker ────────
# PAC manager runs as Python directly (see Step 4) to use the
# fixed main.py with KNOWN_DOORS whitelist and Postgres support.
echo "[3/5] Starting IoT and Data local managers (Docker)..."

docker run -d --name campus-iot-local-manager \
  --network host \
  -e MANAGER_ID=iot-local-manager-01 \
  -e KAFKA_BOOTSTRAP=192.168.60.10:9092 \
  -e HEALTH_PORT=8010 \
  -e HEARTBEAT_TIMEOUT_SEC=20 \
  -e APPROVAL_WINDOW_SEC=60 \
  --restart unless-stopped \
  mass-agent \
  python -m managers.iot_local_manager.main

docker run -d --name campus-data-local-manager \
  --network host \
  -e MANAGER_ID=data-local-manager-01 \
  -e KAFKA_BOOTSTRAP=192.168.60.10:9092 \
  -e HEALTH_PORT=8012 \
  --restart unless-stopped \
  mass-agent \
  python -m managers.data_local_manager.main

sleep 5

# ── Step 4: Start PAC local manager as Python ─────────────
# Runs directly (not Docker) so it uses the updated main.py with:
#   - KNOWN_DOORS whitelist (only door_acad_f1_d1 is real)
#   - Spoofed door injection detection → CRITICAL incident → HQ
#   - Postgres history (PG_HOST/PG_DB/PG_USER/PG_PASS)
#   - APPROVAL_WINDOW_SEC=60 for human-in-the-loop escalation
echo "[4/5] Starting PAC local manager (Python direct)..."
cd "$REPO_DIR"
MANAGER_ID=pac-local-manager-01 \
KAFKA_BOOTSTRAP=192.168.60.10:9092 \
HEALTH_PORT=8011 \
APPROVAL_WINDOW_SEC=60 \
PG_HOST=192.168.60.10 \
PG_PORT=5432 \
PG_DB=massdb \
PG_USER=massadmin \
PG_PASS=mass2026 \
python3 -m managers.pac_local_manager.main > /tmp/pac_mgr.log 2>&1 &
sleep 3

# ── Step 5: Start dashboard + SOAR executor ───────────────
echo "[5/5] Starting dashboard and SOAR executor..."
cd "$REPO_DIR"
python3 server.py > /tmp/server.log 2>&1 &
sleep 1
if [ -f "$HOME/soar_executor.py" ]; then
  python3 "$HOME/soar_executor.py" > /tmp/soar.log 2>&1 &
fi
sleep 2

# ── Verify ────────────────────────────────────────────────
echo ""
echo "  Docker containers:"
docker ps --format "  {{.Names}}: {{.Status}}" | grep -E "iot|data"
echo ""
echo "  Health checks:"
curl -s http://localhost:8011/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('  PAC  ✅', d.get('status','?'), '| doors:', list(d.get('locked_doors',{}).keys()) or 'none locked')" 2>/dev/null || echo "  PAC  ❌ not ready"
curl -s http://localhost:8010/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('  IoT  ✅', d.get('status','?'))" 2>/dev/null || echo "  IoT  ❌ not ready"
curl -s http://localhost:8012/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('  Data ✅', d.get('status','?'))" 2>/dev/null || echo "  Data ❌ not ready"
echo ""
echo "======================================================"
echo "  Dashboard:  http://localhost:8080/local_manager.html"
echo "  PAC logs:   tail -f /tmp/pac_mgr.log"
echo "  Server log: tail -f /tmp/server.log"
echo ""
echo "  Pi EDA agents run on the Pi (do NOT start here):"
echo "    pac-eda-agent-01, credential-anomaly-agent-01"
echo "    door_acad_f1_d1-door, camera-agent-01"
echo "======================================================"
