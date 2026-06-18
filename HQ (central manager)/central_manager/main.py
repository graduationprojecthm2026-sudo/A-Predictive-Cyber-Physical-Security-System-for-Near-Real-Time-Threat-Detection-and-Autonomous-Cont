"""
managers/central_manager/main.py
Phase 4 Week 10 — Central Manager (System Dashboard + Control)
"""
from __future__ import annotations
import logging, os, sys, threading, time, uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List
from pathlib import Path
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from common.kafka_client import KafkaConsumerClient, KafkaProducerClient, Topics

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("central_manager")

MANAGER_ID  = os.getenv("MANAGER_ID",        "central-manager-01")
BOOTSTRAP   = os.getenv("KAFKA_BOOTSTRAP",   "localhost:9092")
HEALTH_PORT = int(os.getenv("HEALTH_PORT",   "8020"))
HB_TIMEOUT  = int(os.getenv("HB_TIMEOUT_SEC","30"))

CONSUMER_GROUP = f"{MANAGER_ID}-{int(time.time())}"

PG_CONFIG = {
    "host":            os.getenv("PG_HOST", "192.168.60.10"),
    "port":            int(os.getenv("PG_PORT", "5432")),
    "dbname":          os.getenv("PG_DB",   "massdb"),
    "user":            os.getenv("PG_USER", "massadmin"),
    "password":        os.getenv("PG_PASS", "mass2026"),
    "connect_timeout": 5,
}

EXPECTED_AGENTS = [
    "gateway-agent-01", "behavioral-agent-01", "iot-local-manager-01",
    "pac-eda-agent-01", "credential-anomaly-agent-01", "pac-local-manager-01",
    "ndr-agent-01", "edr-agent-01", "data-local-manager-01",
    "analytical-agent-01", "orchestrator-agent-01",
    "threat-intel-agent-01", "forensic-agent-hq-01",
]

NOISE_TYPES = ("isolation_violation", "immovable_violation", "sensor_dropout")


class CentralManager:
    def __init__(self):
        logger.info(f"🚀 Central Manager {MANAGER_ID}")
        logger.info(f"📡 Consumer group: {CONSUMER_GROUP}")
        self._incidents: Dict[str, List[dict]] = {
            "iot": [], "physical_access": [], "data_network": [],
        }
        self._correlations: List[dict] = []
        self._commands: deque = deque(maxlen=200)
        self._all_incidents: deque = deque(maxlen=1000)
        self._heartbeats: Dict[str, float] = {}
        self._agent_status: Dict[str, dict] = {}
        self._alerted_agents: set = set()
        self._stats = {
            "total_incidents": 0, "total_correlations": 0,
            "total_commands": 0, "agents_healthy": 0,
        }
        self._soar_actions = []
        self._notifications = []
        self._producer = KafkaProducerClient(BOOTSTRAP)
        self._consumer = KafkaConsumerClient(
            CONSUMER_GROUP,
            [Topics.HQ_INCIDENTS, Topics.HQ_CORRELATED,
             Topics.SOAR_COMMANDS, Topics.HEARTBEATS],
            BOOTSTRAP,
        )
        self._app = self._build_app()
        threading.Thread(target=self._health_monitor_loop, daemon=True, name="health-monitor").start()
        logger.info("✅ Central Manager ready")

    def handle_message(self, topic: str, payload: dict):
        if topic == Topics.HQ_INCIDENTS:
            self._handle_incident(payload)
        elif topic == Topics.HQ_CORRELATED:
            self._handle_correlation(payload)
        elif topic == Topics.SOAR_COMMANDS:
            self._commands.append({**payload,
                "received_at": datetime.now(timezone.utc).isoformat()})
            self._stats["total_commands"] += 1
            self._handle_soar_command(payload)
        elif topic == Topics.HEARTBEATS:
            self._handle_heartbeat(payload)

    def _handle_incident(self, payload: dict):
        domain = payload.get("network_domain", "unknown")
        payload["_received_at"] = datetime.now(timezone.utc).isoformat()
        self._all_incidents.append(payload)
        if domain in self._incidents:
            self._incidents[domain].append(payload)
        self._stats["total_incidents"] += 1
        logger.info(f"📥 Incident [{domain}] [{payload.get('severity','')}] "
                    f"{payload.get('incident_id','')}")
        try:
            import urllib.request, json as _json; req = urllib.request.Request("http://192.168.12.10:8008/predict", data=_json.dumps(payload).encode(), headers={"Content-Type":"application/json"}, method="POST"); resp = urllib.request.urlopen(req, timeout=1); ml = _json.loads(resp.read().decode())


            payload["ml_prediction"]  = ml.get("prediction")
            payload["ml_confidence"]  = ml.get("confidence")
            payload["ml_similarity"]  = ml.get("similarity")
            logger.info(f"ML enrichment: {ml.get('prediction')} confidence={ml.get('confidence')}")
        except Exception:
            payload["ml_prediction"] = "unavailable"
            payload["ml_confidence"] = None

    def _handle_correlation(self, payload: dict):
        self._correlations.append(payload)
        self._stats["total_correlations"] += 1
        logger.warning(f"🧠 Correlation [{payload.get('severity','')}] "
                       f"[{payload.get('correlation_type','')}]")

    def _handle_heartbeat(self, payload: dict):
        agent_id = payload.get("agent_id", "")
        if agent_id:
            self._heartbeats[agent_id] = time.time()
            self._agent_status[agent_id] = {
                "agent_id":  agent_id,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "status":    payload.get("status", "running"),
                "stats":     payload.get("stats", {}),
            }

    def _handle_soar_command(self, cmd: dict):
        action_record = {
            "action":        cmd.get("action", "unknown"),
            "description":   cmd.get("description", ""),
            "target":        cmd.get("target", "campus"),
            "playbook_name": cmd.get("playbook_name", ""),
            "command_id":    cmd.get("command_id", ""),
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "status":        "pending_approval" if cmd.get("requires_approval") else "executed",
            "handler":       "none",
        }
        action = cmd.get("action", "")
        if action.startswith("notify_"):
            action_record["status"]  = "notification_sent"
            action_record["handler"] = "central_manager"
            self._notifications.append({
                "type":      action,
                "message":   cmd.get("description", action),
                "severity":  "info",
                "timestamp": action_record["timestamp"],
                "playbook":  cmd.get("playbook_name", ""),
            })
            if len(self._notifications) > 30:
                self._notifications = self._notifications[-30:]
            logger.info(f"NOTIFICATION: {action} — {cmd.get('description','')}")
        elif action == "verify_agent_status":
            action_record["handler"] = "central_manager"
            action_record["status"]  = "executed"
            now = time.time()
            down_agents = [aid for aid in EXPECTED_AGENTS
                           if (now - self._heartbeats.get(aid, 0)) > HB_TIMEOUT]
            action_record["result"] = {"down_agents": down_agents, "total_down": len(down_agents)}
            logger.info(f"VERIFY: {len(down_agents)} agents down")
        elif action == "attempt_agent_restart":
            action_record["handler"] = "central_manager"
            import subprocess
            target = cmd.get("target_agent", "")
            hq_containers = [
                "campus-analytical-agent", "campus-orchestrator-agent",
                "campus-learning-agent",    "campus-central-manager",
            ]
            if target and any(target in c for c in hq_containers):
                try:
                    container = [c for c in hq_containers if target in c][0]
                    subprocess.run(["docker", "restart", container],
                                   timeout=30, capture_output=True)
                    action_record["status"] = "executed"
                    action_record["result"] = {"restarted": container}
                    logger.info(f"RESTART: {container} restarted")
                except Exception as e:
                    action_record["status"] = "failed"
                    action_record["result"] = {"error": str(e)}
            else:
                action_record["status"] = "logged"
                action_record["result"] = {"note": "Target agent not on HQ — forwarded to building manager"}
        else:
            known_handlers = {
                "block_attacker_ip":         "soar_executor",
                "isolate_host":              "soar_executor",
                "block_c2_ips":              "soar_executor",
                "block_exfil_destination":   "soar_executor",
                "isolate_source_host":       "soar_executor",
                "isolate_iot_vlan":          "soar_executor",
                "lock_all_restricted_doors": "pac_pi",
                "kill_suspicious_processes": "edr_agent",
                "take_forensic_snapshot":    "forensic_agent",
                "enable_enhanced_logging":   "analytical_agent",
                "capture_full_traffic":      "analytical_agent",
                "verify_agent_status":       "central_manager",
                "attempt_agent_restart":     "central_manager",
            }
            action_record["handler"] = known_handlers.get(action, "operator_action")
            if action_record["handler"] != "operator_action":
                action_record["status"] = "dispatched"
            else:
                action_record["status"] = "queued"
        self._soar_actions.append(action_record)
        if len(self._soar_actions) > 50:
            self._soar_actions = self._soar_actions[-50:]

    def _compute_status(self) -> dict:
        now = time.time()
        agent_health = {}
        healthy_count = 0
        all_agents = set(EXPECTED_AGENTS)
        for aid in self._heartbeats:
            all_agents.add(aid)
        for agent_id in sorted(all_agents):
            last = self._heartbeats.get(agent_id, 0)
            is_healthy = (now - last) < HB_TIMEOUT
            if is_healthy:
                healthy_count += 1
            agent_health[agent_id] = {
                "healthy":           is_healthy,
                "last_seen_ago_sec": round(now - last, 1) if last else None,
            }
        self._stats["agents_healthy"] = healthy_count
        health_pct = round(healthy_count / max(len(all_agents), 1) * 100, 1)
        active_incidents = [i for i in self._all_incidents
                            if i.get("status") not in ("dismissed", "resolved")]
        critical_count = sum(1 for i in active_incidents if i.get("severity") == "CRITICAL")
        high_count     = sum(1 for i in active_incidents if i.get("severity") == "HIGH")
        medium_count   = sum(1 for i in active_incidents if i.get("severity") == "MEDIUM")
        low_count      = sum(1 for i in active_incidents if i.get("severity") == "LOW")
        if critical_count >= 2 or len(self._correlations) >= 1:
            threat_level = "CRITICAL"
        elif critical_count >= 1 or high_count >= 3:
            threat_level = "HIGH"
        elif high_count >= 1:
            threat_level = "MEDIUM"
        else:
            threat_level = "LOW"
        return {
            "system_id":         MANAGER_ID,
            "timestamp":         datetime.now(timezone.utc).isoformat(),
            "threat_level":      threat_level,
            "health_percentage": health_pct,
            "agents_healthy":    healthy_count,
            "agents_total":      len(all_agents),
            "agent_health":      agent_health,
            "incidents": {
                "total":    len(active_incidents),
                "critical": critical_count,
                "high":     high_count,
                "medium":   medium_count,
                "low":      low_count,
                "by_domain": {d: len([i for i in incs if i.get("alert_type") not in NOISE_TYPES]) for d, incs in self._incidents.items()},
            },
            "correlations_active": len(self._correlations),
            "commands_issued":     self._stats["total_commands"],
        }

    def _health_monitor_loop(self):
        while True:
            time.sleep(30)
            self._check_agent_health()

    def _check_agent_health(self):
        now = time.time()
        for agent_id in EXPECTED_AGENTS:
            seconds = now - self._heartbeats.get(agent_id, 0)
            if seconds > 60:
                if agent_id not in self._alerted_agents:
                    self._alerted_agents.add(agent_id)
                    self._producer.publish(Topics.HQ_INCIDENTS, {
                        "incident_id":    f"AGENT-DOWN-{uuid.uuid4().hex[:8].upper()}",
                        "alert_type":     "agent_down",
                        "severity":       "CRITICAL",
                        "manager_id":     "central-manager-01",
                        "agent_type":     "central_manager",
                        "host_id":        agent_id,
                        "agent_id":       agent_id,
                        "network_domain": "system",
                        "status":         "active",
                        "created_at":     datetime.now(timezone.utc).isoformat(),
                        "details": {
                            "agent_down":        agent_id,
                            "seconds_since_seen": round(seconds, 1),
                        },
                    }, key=agent_id)
                    logger.warning(f"ALERT: Agent {agent_id} is DOWN — no heartbeat for {seconds:.0f}s")
            else:
                if agent_id in self._alerted_agents:
                    self._alerted_agents.discard(agent_id)
                    logger.info(f"Agent {agent_id} recovered — heartbeat received")

    def _build_app(self) -> FastAPI:
        app = FastAPI(title="MASS Central Manager",
                      description="Predictive Cyber-Physical Security — Campus SOC")
        app.add_middleware(CORSMiddleware, allow_origins=["*"],
                           allow_methods=["*"], allow_headers=["*"])

        @app.get("/health")
        def health():
            return JSONResponse({"manager_id": MANAGER_ID, "status": "running",
                                  "timestamp": datetime.now(timezone.utc).isoformat()})

        @app.get("/status")
        def status():
            return JSONResponse(self._compute_status())

        @app.get("/incidents")
        def incidents(limit: int = 100):
            all_items = list(self._all_incidents)
            real  = [i for i in all_items if i.get("alert_type") not in NOISE_TYPES]
            noise = [i for i in all_items if i.get("alert_type") in NOISE_TYPES]
            if real:
                items = real[-limit:]
            else:
                items = noise[-limit:]
            return JSONResponse({"count": len(items), "incidents": items})

        @app.get("/incidents/{domain}")
        def incidents_by_domain(domain: str, limit: int = 50):
            if domain not in self._incidents:
                raise HTTPException(400, f"Unknown domain: {domain}")
            items = self._incidents[domain][-limit:]
            return JSONResponse({"domain": domain, "count": len(items),
                                  "incidents": items})

        @app.get("/correlations")
        def correlations(limit: int = 20):
            return JSONResponse({"count": len(self._correlations),
                                  "correlations": self._correlations[-limit:]})

        @app.get("/commands")
        def commands(limit: int = 50):
            return JSONResponse(list(self._commands)[-limit:])

        @app.get("/history")
        def history(limit: int = 500, severity: str = None, include_violations: bool = False):
            limit = max(1, min(limit, 2000))
            conn = None
            try:
                import psycopg2, psycopg2.extras
                conn = psycopg2.connect(**PG_CONFIG)
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    fetch_n = limit if include_violations else min(limit * 4, 2000)
                    if severity:
                        cur.execute(
                            "SELECT incident_id, topic, agent_id, severity, timestamp, payload "
                            "FROM incidents WHERE severity = %s "
                            "ORDER BY timestamp DESC LIMIT %s",
                            (severity.upper(), fetch_n))
                    else:
                        cur.execute(
                            "SELECT incident_id, topic, agent_id, severity, timestamp, payload "
                            "FROM incidents ORDER BY timestamp DESC LIMIT %s",
                            (fetch_n,))
                    rows = cur.fetchall()
                incidents_list = []
                for r in rows:
                    payload = r.get("payload") or {}
                    if isinstance(payload, str):
                        import json as _json
                        try:
                            payload = _json.loads(payload)
                        except Exception:
                            payload = {}
                    alert_type = payload.get("alert_type", "unknown")
                    if not include_violations and alert_type in NOISE_TYPES:
                        continue
                    ts = r.get("timestamp")
                    incidents_list.append({
                        "incident_id":         r.get("incident_id"),
                        "topic":               r.get("topic"),
                        "agent_id":            r.get("agent_id"),
                        "severity":            r.get("severity"),
                        "timestamp":           ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                        "alert_type":          alert_type,
                        "host_id":             payload.get("host_id", "unknown"),
                        "details":             payload.get("details", {}),
                        "recommended_actions": payload.get("recommended_actions", []),
                        "status":              payload.get("status", "unknown"),
                    })
                incidents_list = incidents_list[:limit]
                crit = sum(1 for i in incidents_list if i["severity"] == "CRITICAL")
                high = sum(1 for i in incidents_list if i["severity"] == "HIGH")
                return JSONResponse({
                    "incidents": incidents_list,
                    "total":     len(incidents_list),
                    "critical":  crit,
                    "high":      high,
                })
            except Exception as e:
                return JSONResponse({"incidents": [], "total": 0, "critical": 0,
                                     "high": 0, "error": str(e)})
            finally:
                if conn:
                    conn.close()

        @app.post("/approve/{incident_id}")
        def approve(incident_id: str):
            self._producer.publish(Topics.SOAR_COMMANDS, {
                "command_id":  str(uuid.uuid4()),
                "action":      "approve_incident",
                "incident_id": incident_id,
                "approved_by": "central_manager_operator",
                "approved_at": datetime.now(timezone.utc).isoformat(),
            }, key=incident_id)
            return JSONResponse({"approved": True, "incident_id": incident_id})

        @app.post("/dismiss/{incident_id}")
        def dismiss(incident_id: str):
            self._producer.publish(Topics.SOAR_COMMANDS, {
                "command_id":   str(uuid.uuid4()),
                "action":       "dismiss_incident",
                "incident_id":  incident_id,
                "dismissed_by": "central_manager_operator",
                "dismissed_at": datetime.now(timezone.utc).isoformat(),
            }, key=incident_id)
            return JSONResponse({"dismissed": True, "incident_id": incident_id})

        @app.post("/confirm/{incident_id}")
        def confirm(incident_id: str):
            self._producer.publish(Topics.SOAR_COMMANDS, {
                "command_id":   str(uuid.uuid4()),
                "action":       "confirm_incident",
                "incident_id":  incident_id,
                "confirmed_by": "hq_analyst",
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
            }, key=incident_id)
            return JSONResponse({"confirmed": True, "incident_id": incident_id})

        @app.post("/resolve_killchain/{correlation_id}")
        def resolve_killchain(correlation_id: str):
            self._producer.publish(Topics.SOAR_COMMANDS, {
                "command_id":     str(uuid.uuid4()),
                "action":         "resolve_killchain",
                "correlation_id": correlation_id,
                "resolved_by":    "hq_analyst",
                "timestamp":      datetime.now(timezone.utc).isoformat(),
            }, key=correlation_id)
            return JSONResponse({"resolved": True, "correlation_id": correlation_id})

        @app.get("/soar_actions")
        def get_soar_actions():
            executed = len([a for a in self._soar_actions
                            if a["status"] in ("executed", "dispatched", "notification_sent")])
            logged  = len([a for a in self._soar_actions if a["status"] == "logged"])
            pending = len([a for a in self._soar_actions if a["status"] == "pending_approval"])
            return JSONResponse({
                "actions":  list(reversed(self._soar_actions)),
                "total":    len(self._soar_actions),
                "executed": executed,
                "logged":   logged,
                "pending":  pending,
            })

        @app.get("/notifications")
        def get_notifications():
            return JSONResponse({
                "notifications": list(reversed(self._notifications)),
                "total":         len(self._notifications),
            })

        return app

    def start(self):
        threading.Thread(target=self._consumer.poll_loop,
                         args=(self.handle_message,),
                         daemon=True, name="central-consumer").start()
        logger.info(f"▶️  Central Manager — API :{HEALTH_PORT}")
        uvicorn.run(self._app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")

    def stop(self):
        self._consumer.stop()
        self._producer.close()


if __name__ == "__main__":
    m = CentralManager()
    try:
        m.start()
    except KeyboardInterrupt:
        m.stop()
