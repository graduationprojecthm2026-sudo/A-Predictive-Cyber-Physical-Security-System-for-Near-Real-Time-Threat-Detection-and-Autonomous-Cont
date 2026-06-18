#!/usr/bin/env python3
"""
MASS Real Heartbeat Monitor — Arwa (HQ)
Checks each agent's /health endpoint before publishing heartbeat.
Only publishes if agent is actually running — no fake heartbeats.
Run: python3 heartbeat_hq.py
"""
import time
import urllib.request
import json
import sys
import os
import socket
import logging
logging.getLogger().setLevel(logging.CRITICAL)

sys.path.insert(0, os.path.expanduser("~/agents-test-main"))
from datetime import datetime, timezone


def find_kafka():
    # Try Menna's Kafka first (uni)
    try:
        s = socket.create_connection(("192.168.60.10", 9092), timeout=3)
        s.close()
        return "192.168.60.10:9092"
    except:
        pass
    # Try Docker host gateway (home)
    try:
        s = socket.create_connection(("172.18.0.1", 9092), timeout=3)
        s.close()
        return "172.18.0.1:9092"
    except:
        pass
    # Final fallback
    return "localhost:9092"


KAFKA_BROKER = find_kafka()

AGENTS = [
    # Your HQ agents (localhost)
    {"agent_id": "analytical-agent-01",      "health_port": 8006, "host": "localhost"},
    {"agent_id": "orchestrator-agent-01",     "health_port": 8007, "host": "localhost"},
    {"agent_id": "learning-agent-01",         "health_port": 8008, "host": "localhost"},
    {"agent_id": "central-manager-01",        "health_port": 8020, "host": "localhost"},
    {"agent_id": "threat-intel-agent-01",     "health_port": 8009, "host": "localhost"},
    {"agent_id": "forensic-agent-hq-01",      "health_port": 8021, "host": "localhost"},
    # Malak's local managers (192.168.40.10)
    {"agent_id": "iot-local-manager-01",      "health_port": 8010, "host": "192.168.40.10"},
    {"agent_id": "pac-local-manager-01",      "health_port": 8011, "host": "192.168.40.10"},
    {"agent_id": "data-local-manager-01",     "health_port": 8012, "host": "192.168.40.10"},
]


def check_health(port, host="localhost"):
    try:
        url = f"http://{host}:{port}/health"
        with urllib.request.urlopen(url, timeout=3) as r:
            data = json.loads(r.read())
            return data.get("status") == "running"
    except Exception:
        return False


def silent_delivery_report(err, msg):
    pass


def main():
    try:
        from confluent_kafka import Producer
        producer = Producer({
            'bootstrap.servers': KAFKA_BROKER,
            'socket.timeout.ms': 5000,
            'message.timeout.ms': 5000,
            'retries': 0,
            'log_level': 0,
            'error_cb': lambda err: None,
        })
        use_raw = True
    except ImportError:
        from common.kafka_client import KafkaProducerClient, Topics
        producer = KafkaProducerClient(KAFKA_BROKER)
        use_raw = False

    print("=" * 50)
    print("  MASS Heartbeat Monitor — HQ (Arwa)")
    print("  Kafka:", KAFKA_BROKER)
    print("  Agents monitored:", [a["agent_id"] for a in AGENTS])
    print("  Publishes ONLY if /health returns running")
    print("=" * 50)

    while True:
        for agent in AGENTS:
            alive = check_health(agent["health_port"], agent.get("host", "localhost"))
            if alive:
                payload = json.dumps({
                    "agent_id": agent["agent_id"],
                    "status": "running",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "stats": {}
                }).encode()

                if use_raw:
                    producer.produce(
                        "agents.heartbeats",
                        value=payload,
                        key=agent["agent_id"].encode(),
                        callback=silent_delivery_report
                    )
                else:
                    from common.kafka_client import Topics
                    producer.publish(Topics.HEARTBEATS, {
                        "agent_id": agent["agent_id"],
                        "status": "running",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "stats": {}
                    }, key=agent["agent_id"])

                print(f"[OK]  {agent['agent_id']} — heartbeat sent")
            else:
                print(f"[--]  {agent['agent_id']} — not running, skipped")

        if use_raw:
            producer.poll(0)
            producer.flush(timeout=3)
        else:
            producer.flush()

        time.sleep(30)


if __name__ == "__main__":
    main()
