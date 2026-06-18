#!/bin/bash
echo "[FORENSIC] Starting Forensic Collection Agent..."
export KAFKA_BOOTSTRAP="192.168.60.10:9092"
export AGENT_ID="forensic-agent-hq-01"
export HEALTH_PORT="8021"
export BUNDLE_DIR="/tmp/forensic_bundles"
export LOOKBACK_SECONDS="300"
mkdir -p $BUNDLE_DIR
python3 ~/forensic_agent/main.py
