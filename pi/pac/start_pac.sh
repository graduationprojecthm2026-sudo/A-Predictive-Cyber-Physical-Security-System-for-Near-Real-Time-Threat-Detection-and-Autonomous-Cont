#!/bin/bash
# MASS PAC startup — starts Docker containers and camera agent on host

cd /home/pi/mass-pi || exit 1

echo "[$(date)] Starting MASS PAC..."

# Start Docker containers (door + agents)
export KAFKA_BROKER=192.168.60.10:9092
docker compose -f docker/docker-compose.pi.yml up -d

# Wait for containers to settle
sleep 5

# Start camera agent on host (in background, log to file)
pkill -f camera_agent_headless 2>/dev/null
nohup python3 /home/pi/mass-pi/camera_agent_headless.py > /home/pi/logs/camera.log 2>&1 &

echo "[$(date)] All started."
echo "  Docker:    docker ps"
echo "  Camera:    tail -f /home/pi/logs/camera.log"
echo "  Door:      docker logs -f mass-door-process"
