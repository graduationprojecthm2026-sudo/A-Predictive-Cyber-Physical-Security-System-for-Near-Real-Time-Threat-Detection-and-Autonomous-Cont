#!/bin/bash
echo "[TI-AGENT] Installing dependencies..."
pip install -r ~/ti_agent/requirements.txt --break-system-packages -q
echo "[TI-AGENT] Starting Threat Intelligence Agent..."
export KAFKA_BOOTSTRAP="192.168.60.10:9092"
export AGENT_ID="ti-agent-hq-01"
export HEALTH_PORT="8009"
export TI_DB_PATH="/tmp/mass_ti_iocs.db"
export VIRUSTOTAL_API_KEY=""
export OTX_API_KEY=""
python3 ~/ti_agent/main.py
