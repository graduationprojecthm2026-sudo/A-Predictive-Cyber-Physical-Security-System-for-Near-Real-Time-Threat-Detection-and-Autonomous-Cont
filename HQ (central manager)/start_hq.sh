#!/bin/bash

echo "========================================"
echo "   MASS HQ Manager - Starting Up"
echo "   Kafka: 192.168.60.10:9092"
echo "========================================"

# Step 1 - Go to docker folder
cd ~/agents-test-main/docker

# Step 2 - Start the 4 HQ containers
echo "[1/4] Starting analytical-agent..."
docker-compose up -d analytical-agent
sleep 5

echo "[2/4] Starting orchestrator-agent..."
docker-compose up -d orchestrator-agent
sleep 5

echo "[3/4] Starting learning-agent..."
docker-compose up -d learning-agent
sleep 5

echo "[4/4] Starting central-manager..."
docker-compose up -d central-manager
sleep 10

# Step 3 - Deploy latest code fixes
echo ""
echo "=== Deploying latest fixes ==="
docker cp /home/arwa/agents-test-main/managers/central_manager/main.py campus-central-manager:/app/managers/central_manager/main.py
docker restart campus-central-manager
docker cp /home/arwa/agents-test-main/agents/hq/analytical_agent/main.py campus-analytical-agent:/app/agents/hq/analytical_agent/main.py
docker restart campus-analytical-agent
sleep 10

# Step 4 - Check all containers are running
echo ""
echo "=== Container Status ==="
docker-compose ps

# Step 5 - Test central manager is responding
echo ""
echo "=== Testing Central Manager ==="
curl -s http://localhost:8020/status || echo "Central manager not ready yet"

# Step 6 - Start TI and Forensic agents
echo ""
echo "=== Starting TI + Forensic ==="
cd ~/ti_agent && python3 main.py > /tmp/ti.log 2>&1 &
cd ~/forensic_agent && python3 main.py > /tmp/forensic.log 2>&1 &
sleep 5

# Step 7 - Start heartbeat monitor in background
echo ""
echo "=== Starting Heartbeat Monitor ==="
cd ~/agents-test-main
python3 heartbeat_hq.py &
echo "Heartbeat monitor started in background"

# Step 8 - Start dashboard server
echo ""
echo "=== Starting Dashboard ==="
echo "Dashboard will be available at:"
echo "http://192.168.12.10:8080/soc_enterprise.html"
echo ""
python3 ~/agents-test-main/server.py
