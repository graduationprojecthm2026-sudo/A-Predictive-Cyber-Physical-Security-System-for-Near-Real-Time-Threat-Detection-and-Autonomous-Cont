#!/bin/bash
echo "Starting MASS Security System..."

# 1. Start Docker containers (gateway-agent runs on Pi directly, not in Docker)
cd ~/agents-test/docker
docker compose up -d
docker compose stop gateway-agent
echo "Waiting for containers..."
sleep 25

# 2. Activate venv
cd ~/agents-test
source .venv/bin/activate

# 3. Start heartbeat loop
python3 - << 'PYEOF' &
import sys, time
sys.path.insert(0, '.')
from common.kafka_client import KafkaProducerClient, Topics
from datetime import datetime, timezone
agents = [
    "gateway-agent-01","behavioral-agent-01","iot-local-manager-01",
    "pac-eda-agent-01","credential-anomaly-agent-01","pac-local-manager-01",
    "ndr-agent-01","edr-agent-01","data-local-manager-01",
    "analytical-agent-01","orchestrator-agent-01"
]
producer = KafkaProducerClient("localhost:9092")
print("Heartbeat running...")
while True:
    for a in agents:
        producer.publish(Topics.HEARTBEATS, {
            "agent_id": a, "status": "running",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stats": {}
        }, key=a)
    producer.flush()
    time.sleep(10)
PYEOF
echo "Heartbeat started"

# 4. Start hardware sensor reader (DHT22 + MQ-2 + PIR when connected)
#    Kill any zombie GPIO processes from a previous run first.
pkill -9 -f "libgpiod_pulsein" 2>/dev/null
pkill -9 -f "hardware_sensor_reader" 2>/dev/null
sleep 1
nohup python3 ~/agents-test/hardware_sensor_reader_v2.py \
    --broker localhost --port 1883 \
    > /tmp/sensor_reader.log 2>&1 &
echo "Sensor reader started (PID $!) — log: /tmp/sensor_reader.log"
echo "  MQ-2 warms up for 30s before first reading"

# 5. Start Pi gateway agent (publishes sensor data to Kafka at 192.168.60.10:9092)
pkill -9 -f "gateway_agent/main.py" 2>/dev/null
sleep 1
nohup env KAFKA_BOOTSTRAP=192.168.60.10:9092 \
          MQTT_BROKER=192.168.60.10 \
          AGENT_ID=GW-PI5-01 \
          HEALTH_PORT=8000 \
    python3 ~/agents-test/agents/iot/gateway_agent/main.py \
    > /tmp/gateway_agent.log 2>&1 &
echo "Pi gateway agent started (PID $!) — log: /tmp/gateway_agent.log"

# 6. Start proxy server
python3 ~/agents-test/server.py &
sleep 3
echo "Proxy server started on port 8080"

# 7. Simulators DISABLED — real sensor data only
# python3 simulators/iot_simulator.py --mode all --broker localhost --port 1883 &
# python3 simulators/pac_simulator.py --mode all --broker localhost --port 1883 &
# python3 simulators/data_network_simulator.py --mode all &
echo "Simulators DISABLED — real sensor data only"

# 8. Open dashboard
sleep 5
firefox http://localhost:8080/soc_enterprise.html &

echo ""
echo "MASS System is LIVE!"
echo "Dashboard: http://localhost:8080/soc_enterprise.html"
echo "API:       http://localhost:8020/status"
echo "Sensors:   tail -f /tmp/sensor_reader.log"
