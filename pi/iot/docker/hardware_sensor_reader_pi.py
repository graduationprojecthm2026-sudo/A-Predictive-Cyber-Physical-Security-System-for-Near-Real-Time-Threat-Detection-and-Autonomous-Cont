"""
hardware_sensor_reader_pi.py — Smart IoT Node for Cyber-Physical Security
Reads DHT22, MQ-2, PIR, reports Edge Telemetry, and listens for Containment Commands.
"""

import json
import time
import logging
import board
import adafruit_dht
from gpiozero import MotionSensor, DigitalInputDevice, CPUTemperature
import paho.mqtt.client as mqtt

# --- CONFIGURATION ---
MQTT_BROKER = "localhost"
MQTT_PORT = 1883

GATEWAY_ID = "MASS-IoT-Gateway"
ZONE = "ACADEMIC-F1-LABA"

# Topics
TOPIC_TEMP = "sensors/academic/floor1/temperature"
TOPIC_HUM = "sensors/academic/floor1/humidity"
TOPIC_GAS = "sensors/academic/floor1/gas"
TOPIC_MOTION = "sensors/academic/floor1/motion"
TOPIC_TELEMETRY = "sensors/academic/floor1/telemetry"
TOPIC_COMMANDS = "sensors/academic/floor1/commands"

# Containment State
is_locked_down = False

# --- LOGGING SETUP ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] sensor_node — %(message)s')

# --- SENSOR SETUP ---
logging.info("Initializing Hardware Sensors: DHT22, MQ2, PIR, and Edge Telemetry")
try:
    dht_device = adafruit_dht.DHT22(board.D17, use_pulseio=False)
    gas_sensor = DigitalInputDevice(27)
    pir = MotionSensor(18)
except Exception as e:
    logging.error(f"Failed to initialize sensors: {e}")
    exit(1)

# --- IoT CONTAINMENT LISTENER ---
def on_message_received(client, userdata, msg):
    global is_locked_down
    command = msg.payload.decode().upper()
    logging.warning(f"🚨 IoT COMMAND RECEIVED: {command}")
    
    if "LOCKDOWN" in command:
        is_locked_down = True
        logging.error("CONTAINMENT ACTIVATED: Halting sensor data transmission!")
    elif "RESET" in command:
        is_locked_down = False
        logging.info("CONTAINMENT LIFTED: Resuming normal operations.")

# --- MQTT SETUP ---
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=GATEWAY_ID)
mqtt_client.on_message = on_message_received

try:
    logging.info(f"Connecting to MQTT Broker at {MQTT_BROKER}:{MQTT_PORT}...")
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.subscribe(TOPIC_COMMANDS)
    mqtt_client.loop_start()
    logging.info(f"Listening for commands on: {TOPIC_COMMANDS}")
except Exception as e:
    logging.error(f"Cannot connect to MQTT broker: {e}")
    exit(1)

# --- MAIN LOOP ---
logging.info("==================================================")
logging.info(" MASS IoT Smart Node is now running")
logging.info("==================================================")

try:
    while True:
        if is_locked_down:
            # If contained, node goes dark and ignores room sensors
            time.sleep(2)
            continue

        current_seq = int(time.time())
        
        # 1. EDGE TELEMETRY & ANALYZER (Device Health)
        cpu = CPUTemperature()
        power_mode = "HIGH_LOAD" if cpu.temperature > 60 else "NORMAL"
        payload_health = {
            "gateway_id": GATEWAY_ID,
            "zone": ZONE,
            "device_id": "NODE-PI5-CORE",
            "device_type": "TELEMETRY",
            "seq": current_seq,
            "value": float(cpu.temperature),
            "unit": "C_CPU"
        }
        mqtt_client.publish(TOPIC_TELEMETRY, json.dumps(payload_health))
        logging.info(f"Node Health: {cpu.temperature:.1f}C ({power_mode})")

        # 2. READ & PUBLISH DHT22 (Split into Temp and Humidity)
        try:
            temp = dht_device.temperature
            hum = dht_device.humidity
            if temp is not None and hum is not None:
                # Temperature
                payload_temp = {
                    "gateway_id": GATEWAY_ID,
                    "zone": ZONE,
                    "device_id": "DHT22-ACADEMIC-F1-LABA-01",
                    "device_type": "DHT22",
                    "seq": current_seq,
                    "value": float(temp),
                    "unit": "C"
                }
                mqtt_client.publish(TOPIC_TEMP, json.dumps(payload_temp))
                
                # Buffer to prevent sequence anomaly / race conditions
                time.sleep(0.5)
                
                # Humidity
                payload_hum = {
                    "gateway_id": GATEWAY_ID,
                    "zone": ZONE,
                    "device_id": "DHT22-ACADEMIC-F1-LABA-01",
                    "device_type": "DHT22",
                    "seq": current_seq + 1,
                    "value": float(hum),
                    "unit": "%"
                }
                mqtt_client.publish(TOPIC_HUM, json.dumps(payload_hum))
                logging.info(f"Sent DHT: {temp}C, {hum}%")
        except RuntimeError:
            pass

        # 3. READ & PUBLISH MQ2
        gas_val = gas_sensor.value 
        payload_gas = {
            "gateway_id": GATEWAY_ID,
            "zone": ZONE,
            "device_id": "MQ2-ACADEMIC-F1-LABA-01",
            "device_type": "MQ2",
            "seq": current_seq,
            "value": int(gas_val),
            "unit": "digital"
        }
        mqtt_client.publish(TOPIC_GAS, json.dumps(payload_gas))

        # 4. READ & PUBLISH PIR
        motion_val = 1 if pir.motion_detected else 0
        payload_pir = {
            "gateway_id": GATEWAY_ID,
            "zone": ZONE,
            "device_id": "PIR-ACADEMIC-F1-LABA-01",
            "device_type": "PIR",
            "seq": current_seq,
            "value": int(motion_val),
            "unit": "binary"
        }
        mqtt_client.publish(TOPIC_MOTION, json.dumps(payload_pir))

        time.sleep(3) 

except KeyboardInterrupt:
    logging.info("\nScript stopped by user.")
    dht_device.exit()
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
