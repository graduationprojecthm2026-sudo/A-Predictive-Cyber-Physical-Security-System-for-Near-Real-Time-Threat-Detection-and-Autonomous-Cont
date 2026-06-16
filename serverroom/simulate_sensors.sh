#!/bin/bash
echo "Starting sensor simulation..."
SEQ=1
while true; do
  TEMP=$(python3 -c "import random; print(round(random.uniform(22.0, 28.0), 1))")
  HUM=$(python3 -c "import random; print(round(random.uniform(45.0, 65.0), 1))")
  GAS=$(python3 -c "import random; print(random.randint(50, 150))")

  docker exec campus-mosquitto mosquitto_pub -h localhost -p 1883 \
    -t "sensors/academic/floor1/temperature" \
    -m "{\"gateway_id\":\"MASS-IoT-Gateway\",\"zone\":\"ACADEMIC-F1-LABA\",\"device_id\":\"DHT22-ACADEMIC-F1-LABA-01\",\"device_type\":\"DHT22\",\"seq\":$SEQ,\"value\":$TEMP,\"unit\":\"C\"}"

  docker exec campus-mosquitto mosquitto_pub -h localhost -p 1883 \
    -t "sensors/academic/floor1/humidity" \
    -m "{\"gateway_id\":\"MASS-IoT-Gateway\",\"zone\":\"ACADEMIC-F1-LABA\",\"device_id\":\"DHT22-ACADEMIC-F1-LABA-01\",\"device_type\":\"DHT22\",\"seq\":$SEQ,\"value\":$HUM,\"unit\":\"%\"}"

  docker exec campus-mosquitto mosquitto_pub -h localhost -p 1883 \
    -t "sensors/academic/floor1/gas" \
    -m "{\"gateway_id\":\"MASS-IoT-Gateway\",\"zone\":\"ACADEMIC-F1-LABA\",\"device_id\":\"MQ2-ACADEMIC-F1-LABA-01\",\"device_type\":\"MQ2\",\"seq\":$SEQ,\"value\":$GAS,\"unit\":\"ppm\"}"

  SEQ=$((SEQ + 1))
  sleep 10
done
