import os, json, time, logging, threading, zipfile, hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
import uvicorn
from confluent_kafka import Consumer, Producer

KAFKA_BOOTSTRAP   = os.getenv("KAFKA_BOOTSTRAP",    "192.168.60.10:9092")
CONSUME_TOPIC     = "hq.incidents"
PRODUCE_TOPIC     = "forensic.evidence"
AGENT_ID          = os.getenv("AGENT_ID",           "forensic-agent-hq-01")
HEALTH_PORT       = int(os.getenv("HEALTH_PORT",    "8021"))
BUNDLE_DIR        = os.getenv("BUNDLE_DIR",         "/tmp/forensic_bundles")
LOOKBACK_SECONDS  = int(os.getenv("LOOKBACK_SECONDS","300"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [FORENSIC] %(levelname)s %(message)s")
log = logging.getLogger(__name__)
Path(BUNDLE_DIR).mkdir(parents=True, exist_ok=True)

class ForensicCollectionAgent:
    def __init__(self):
        self.agent_id           = AGENT_ID
        self.started_at         = datetime.now(timezone.utc).isoformat()
        self.running            = False
        self.incidents_received = 0
        self.bundles_created    = 0
        self.collection_errors  = 0
        self.bundle_registry    = {}
        self.consumer           = None
        self.producer           = None
        self._init_kafka()
        log.info("Forensic Agent %s initialized | bundle dir: %s", self.agent_id, BUNDLE_DIR)

    def _init_kafka(self):
        try:
            self.consumer = Consumer({
                "bootstrap.servers": KAFKA_BOOTSTRAP,
                "group.id": self.agent_id+"-consumer",
                "auto.offset.reset": "latest",
            })
            self.consumer.subscribe([CONSUME_TOPIC])
            self.producer = Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})
            log.info("Kafka connected to %s", KAFKA_BOOTSTRAP)
        except Exception as e:
            log.warning("Kafka unavailable: %s — API-only mode", e)
            self.consumer = None
            self.producer = None

    def _build_bundle(self, incident):
        incident_id = incident.get("incident_id", incident.get("id", "inc-"+str(int(time.time()))))
        severity    = incident.get("severity", "UNKNOWN")
        ts          = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        bundle_path = str(Path(BUNDLE_DIR) / f"incident_{incident_id}_{ts}.zip")
        summary = {
            "incident_id":    incident_id,
            "severity":       severity,
            "alert_type":     incident.get("alert_type", "unknown"),
            "host_id":        incident.get("host_id", "—"),
            "network_domain": incident.get("network_domain", "—"),
            "created_at":     incident.get("created_at", ts),
            "collected_at":   datetime.now(timezone.utc).isoformat(),
            "agent_id":       self.agent_id,
            "collection_method": "kafka_replay",
            "recommended_actions": incident.get("recommended_actions", []),
            "details":        incident.get("details", {}),
            "status":         incident.get("status", "—"),
        }
        timeline = [{
            "timestamp": incident.get("created_at", ""),
            "event":     incident.get("alert_type", "unknown"),
            "severity":  incident.get("severity", ""),
            "domain":    incident.get("network_domain", ""),
            "agent":     incident.get("agent_id", ""),
            "details":   incident.get("details", {}),
        }]
        with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("incident.json",  json.dumps(incident,  indent=2))
            zf.writestr("summary.json",   json.dumps(summary,   indent=2))
            zf.writestr("timeline.json",  json.dumps(timeline,  indent=2))
            zf.writestr("manifest.txt",   f"MASS Forensic Bundle\nIncident: {incident_id}\nSeverity: {severity}\nCollected: {summary['collected_at']}\nMethod: Kafka replay\nAgent: {self.agent_id}\nIntegrity: SHA-256\n")
        with open(bundle_path, "rb") as bf:
            sha256 = hashlib.sha256(bf.read()).hexdigest()
        size = Path(bundle_path).stat().st_size
        meta = {
            "incident_id":    incident_id,
            "severity":       severity,
            "alert_type":     incident.get("alert_type","unknown"),
            "host_id":        incident.get("host_id","—"),
            "bundle_path":    bundle_path,
            "bundle_size":    size,
            "sha256":         sha256,
            "created_at":     datetime.now(timezone.utc).isoformat(),
            "files":          ["incident.json","summary.json","timeline.json","manifest.txt"],
        }
        self.bundle_registry[incident_id] = meta
        self.bundles_created += 1
        log.info("Bundle created: %s (%d bytes)", bundle_path, size)
        return meta

    def _collect_for_incident(self, incident):
        try:
            meta = self._build_bundle(incident)
            if self.producer:
                self.producer.produce(PRODUCE_TOPIC, json.dumps(meta).encode("utf-8"))
                self.producer.flush()
        except Exception as e:
            self.collection_errors += 1
            log.error("Collection failed: %s", e)

    def run(self):
        self.running = True
        log.info("Forensic Agent running — waiting on %s", CONSUME_TOPIC)
        while self.running:
            try:
                if not self.consumer:
                    time.sleep(10)
                    self._init_kafka()
                    continue
                msg = self.consumer.poll(timeout=1.0)
                if msg is None: continue
                if msg.error():
                    log.error("Kafka error: %s", msg.error())
                    continue
                incident = json.loads(msg.value().decode("utf-8"))
                self.incidents_received += 1
                severity = incident.get("severity","UNKNOWN")
                if severity in ("HIGH","CRITICAL"):
                    threading.Thread(target=self._collect_for_incident,args=(incident,),daemon=True).start()
                else:
                    log.info("Skipping severity=%s", severity)
            except Exception as e:
                log.error("Consumer error: %s", e)
                time.sleep(5)

    def stop(self):
        self.running = False
        if self.consumer: self.consumer.close()

app   = FastAPI(title="MASS Forensic Collection Agent", version="2.0.0")
agent = None


def _heartbeat_loop():
    from confluent_kafka import Producer as KProducer
    import json as _json
    p = KProducer({"bootstrap.servers": KAFKA_BOOTSTRAP})
    while True:
        try:
            msg = _json.dumps({
                "agent_id": "forensic-agent-hq-01",
                "status":   "running",
                "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
            }).encode()
            p.produce("agents.heartbeats", msg)
            p.flush()
        except Exception as e:
            log.warning("HB error: %s", e)
        time.sleep(25)

@app.on_event("startup")
async def startup():
    global agent
    agent = ForensicCollectionAgent()
    threading.Thread(target=agent.run, daemon=True).start()
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    log.info("Forensic Agent ready on port %d", HEALTH_PORT)

@app.get("/health")
def health():
    if not agent: return {"status":"starting"}
    return {"status":"running","agent_id":agent.agent_id,"uptime":agent.started_at}

@app.get("/status")
def status():
    if not agent: return {"status":"starting"}
    return {
        "agent_id":           agent.agent_id,
        "started_at":         agent.started_at,
        "bundle_directory":   BUNDLE_DIR,
        "collection_method":  "kafka_replay_only",
        "incidents_received": agent.incidents_received,
        "bundles_created":    agent.bundles_created,
        "collection_errors":  agent.collection_errors,
        "bundles_on_disk":    len(list(Path(BUNDLE_DIR).glob("*.zip"))),
    }

@app.get("/bundles")
def list_bundles():
    if not agent: return {"bundles":[],"total":0}
    bundles = []
    for p in sorted(Path(BUNDLE_DIR).glob("*.zip"), key=lambda f: f.stat().st_mtime, reverse=True):
        inc_id = p.stem.replace("incident_","").rsplit("_",2)[0] if p.stem.count("_")>=2 else p.stem
        meta = agent.bundle_registry.get(inc_id,{})
        bundles.append({
            "filename":   p.name,
            "incident_id": meta.get("incident_id", inc_id),
            "severity":   meta.get("severity","—"),
            "alert_type": meta.get("alert_type","—"),
            "host_id":    meta.get("host_id","—"),
            "size_bytes": p.stat().st_size,
            "created_at": datetime.fromtimestamp(p.stat().st_mtime,tz=timezone.utc).isoformat(),
        })
    return {"bundles":bundles,"total":len(bundles)}

@app.get("/bundles/{incident_id}")
def get_bundle(incident_id: str):
    if not agent: raise HTTPException(503,"Agent starting")
    meta = agent.bundle_registry.get(incident_id)
    if meta: return meta
    matches = list(Path(BUNDLE_DIR).glob(f"incident_{incident_id}_*.zip"))
    if not matches: raise HTTPException(404,f"No bundle for {incident_id}")
    p = matches[0]
    return {"incident_id":incident_id,"bundle_path":str(p),"size_bytes":p.stat().st_size}

if __name__ == "__main__":
    log.info("Starting on port %d", HEALTH_PORT)
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")
