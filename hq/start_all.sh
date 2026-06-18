#!/bin/bash
echo "========================================"
echo "   MASS HQ Manager — Full Startup"
echo "   IP: 192.168.12.10"
echo "========================================"

# ── Auto-detect Kafka ─────────────────────────
if nc -z -w3 192.168.60.10 9092 2>/dev/null; then
    echo "[+] Menna's Kafka reachable — using 192.168.60.10:9092"
    export KAFKA_BOOTSTRAP="192.168.60.10:9092"
else
    echo "[+] Menna unreachable — using local Kafka"
    export KAFKA_BOOTSTRAP="localhost:9092"
fi

# Fix for Docker containers — localhost doesn't work inside containers
if [ "$KAFKA_BOOTSTRAP" = "localhost:9092" ]; then
    export KAFKA_BOOTSTRAP="172.18.0.1:9092"
    echo "[+] Switched to Docker host gateway: 172.18.0.1:9092"
fi

echo "KAFKA_BOOTSTRAP=$KAFKA_BOOTSTRAP"

# ── Step 1: Docker containers ─────────────────
echo ""
echo "[1/5] Starting Docker containers..."
cd ~/agents-test-main/docker
docker-compose up -d analytical-agent orchestrator-agent learning-agent central-manager
echo "Waiting 15s for containers to be ready..."
sleep 15
echo "Container status:"
docker-compose ps | grep -E "Name|campus-(analytical|orchestrator|learning|central)"

# ── Step 2: TI Agent ──────────────────────────
echo ""
echo "[2/5] Starting TI Agent (port 8009)..."
pkill -f "ti_agent/main.py" 2>/dev/null
sleep 1
export AGENT_ID="ti-agent-hq-01"
export HEALTH_PORT="8009"
export TI_DB_PATH="/tmp/mass_ti_iocs.db"
python3 ~/ti_agent/main.py > /tmp/ti_agent.log 2>&1 &
echo "TI Agent started — logs: /tmp/ti_agent.log"

# ── Step 3: Forensic Agent ────────────────────
echo ""
echo "[3/5] Starting Forensic Agent (port 8021)..."
pkill -f "forensic_agent/main.py" 2>/dev/null
sleep 1
export AGENT_ID="forensic-agent-hq-01"
export HEALTH_PORT="8021"
export BUNDLE_DIR="/tmp/forensic_bundles"
export LOOKBACK_SECONDS="300"
mkdir -p /tmp/forensic_bundles
python3 ~/forensic_agent/main.py > /tmp/forensic_agent.log 2>&1 &
echo "Forensic Agent started — logs: /tmp/forensic_agent.log"

# ── Step 4: Heartbeat ─────────────────────────
echo ""
echo "[4/5] Starting Heartbeat monitor..."
pkill -f "heartbeat_hq.py" 2>/dev/null
sleep 1
cd ~/agents-test-main
python3 heartbeat_hq.py > /tmp/heartbeat.log 2>&1 &
echo "Heartbeat started — logs: /tmp/heartbeat.log"

# ── Step 5: Dashboard server ──────────────────
echo ""
echo "[5/5] Starting Dashboard server (port 8080)..."
pkill -f "server.py" 2>/dev/null
sleep 1
cd ~/agents-test-main
python3 server.py > /tmp/dashboard.log 2>&1 &
echo "Dashboard started — logs: /tmp/dashboard.log"

# ── Wait and verify ───────────────────────────
echo ""
echo "Waiting 8s for all agents to initialize..."
sleep 8

echo ""
echo "========================================"
echo "   STATUS CHECK"
echo "========================================"

# Central manager
curl -s http://localhost:8020/status | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('Central Manager:  RUNNING | threat:', d.get('threat_level','?'), '| incidents:', d.get('incidents',{}).get('total','?'))
except:
    print('Central Manager:  OFFLINE')
" 2>/dev/null || echo "Central Manager:  OFFLINE"

# Analytical agent
curl -s http://localhost:8006/health | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('Analytical Agent: RUNNING |', d.get('agent_id','?'))
except:
    print('Analytical Agent: OFFLINE')
" 2>/dev/null || echo "Analytical Agent: OFFLINE"

# Orchestrator
curl -s http://localhost:8007/health | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('Orchestrator:     RUNNING |', d.get('agent_id','?'))
except:
    print('Orchestrator:     OFFLINE')
" 2>/dev/null || echo "Orchestrator:     OFFLINE"

# Learning agent
curl -s http://localhost:8008/health | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('Learning Agent:   RUNNING |', d.get('agent_id','?'))
except:
    print('Learning Agent:   OFFLINE')
" 2>/dev/null || echo "Learning Agent:   OFFLINE"

# TI agent
curl -s http://localhost:8009/health | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('TI Agent:         RUNNING |', d.get('agent_id','?'))
except:
    print('TI Agent:         OFFLINE')
" 2>/dev/null || echo "TI Agent:         OFFLINE"

# Forensic agent
curl -s http://localhost:8021/health | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print('Forensic Agent:   RUNNING |', d.get('agent_id','?'))
except:
    print('Forensic Agent:   OFFLINE')
" 2>/dev/null || echo "Forensic Agent:   OFFLINE"

# Dashboard
curl -s http://localhost:8080 > /dev/null 2>&1 && echo "Dashboard:        RUNNING | http://192.168.12.10:8080/soc_enterprise.html" || echo "Dashboard:        OFFLINE"

echo ""
echo "========================================"
echo "   MASS SYSTEM IS LIVE"
echo "   Kafka: $KAFKA_BOOTSTRAP"
echo "   Dashboard: http://192.168.12.10:8080/soc_enterprise.html"
echo "   Logs: /tmp/ti_agent.log /tmp/forensic_agent.log"
echo "========================================"

# ── Auto-deploy fixed agent code into containers ──
echo "[POST] Deploying updated agent code..."
docker cp ~/agents-test-main/agents/hq/analytical_agent/main.py campus-analytical-agent:/app/agents/hq/analytical_agent/main.py
docker cp ~/agents-test-main/agents/hq/learning_agent/main.py campus-learning-agent:/app/agents/hq/learning_agent/main.py
docker cp ~/agents-test-main/managers/central_manager/main.py campus-central-manager:/app/managers/central_manager/main.py
docker cp ~/agents-test-main/agents/hq/orchestrator_agent/main.py campus-orchestrator-agent:/app/agents/hq/orchestrator_agent/main.py
docker restart campus-analytical-agent campus-learning-agent campus-central-manager campus-orchestrator-agent
echo "[POST] All agent code deployed and restarted"
