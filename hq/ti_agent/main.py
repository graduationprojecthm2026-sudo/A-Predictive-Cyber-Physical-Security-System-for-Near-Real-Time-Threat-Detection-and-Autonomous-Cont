import os, json, time, sqlite3, logging, threading, re
from datetime import datetime, timezone
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from confluent_kafka import Consumer, Producer, KafkaError

KAFKA_BOOTSTRAP    = os.getenv("KAFKA_BOOTSTRAP", "192.168.60.10:9092")
CONSUME_TOPICS     = ["data.alerts", "hq.incidents"]
PRODUCE_TOPIC      = "ti.enriched"
AGENT_ID           = os.getenv("AGENT_ID",       "ti-agent-hq-01")
HEALTH_PORT        = int(os.getenv("HEALTH_PORT", "8009"))
DB_PATH            = os.getenv("TI_DB_PATH",     "/tmp/ti_iocs.db")
VIRUSTOTAL_API_KEY = os.getenv("VIRUSTOTAL_API_KEY", "")
OTX_API_KEY        = os.getenv("OTX_API_KEY", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TI-AGENT] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

class TIDatabase:
    def __init__(self, path):
        self.path = path
        self._init_db()
        self._seed()

    def _conn(self):
        return sqlite3.connect(self.path)

    def _init_db(self):
        with self._conn() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS iocs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, value TEXT NOT NULL UNIQUE,
                category TEXT, threat_actor TEXT, malware_family TEXT,
                confidence REAL DEFAULT 0.5, source TEXT DEFAULT 'local',
                description TEXT, added_at TEXT DEFAULT (datetime('now')))""")
            db.execute("""CREATE TABLE IF NOT EXISTS enrichment_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id TEXT, ioc_value TEXT, ioc_type TEXT,
                matched INTEGER DEFAULT 0,
                enriched_at TEXT DEFAULT (datetime('now')))""")
            db.commit()
        log.info("DB ready at %s", self.path)

    def _seed(self):
        seed = [
            ("process","nmap","reconnaissance","Generic","Port Scanner",0.75,"local","Network mapper for reconnaissance."),
            ("process","hydra","credential_attack","Generic","Brute Force Tool",0.90,"local","THC-Hydra brute force tool."),
            ("process","masscan","reconnaissance","Generic","Mass Scanner",0.85,"local","Internet-scale port scanner."),
            ("process","mimikatz","credential_theft","APT28","Mimikatz",0.99,"local","Windows credential dumper."),
            ("process","meterpreter","c2","Generic","Metasploit",0.95,"local","Metasploit remote shell."),
            ("process","netcat","c2","Generic","Netcat",0.70,"local","Reverse shell utility."),
            ("process","sqlmap","exploitation","Generic","SQLi Tool",0.90,"local","SQL injection tool."),
            ("process","hashcat","credential_attack","Generic","Hashcat",0.85,"local","Password cracking tool."),
            ("hash","44d88612fea8a8f36de82e1278abb02f","malware_test","Test","EICAR",0.99,"local","EICAR test file MD5."),
            ("hash","275a021bbfb6489e54d471899f7db9d1693de429d9f4beaf24164b0e15fce348","malware_test","Test","EICAR",0.99,"local","EICAR SHA256."),
            ("domain","evil-c2.example.com","c2","APT29","Cobalt Strike",0.97,"poc_placeholder","Example C2 domain using reserved example.com. In production, synced from MISP feed."),
            ("domain","update.malware-lab.net","c2","Generic","Generic RAT",0.90,"poc_placeholder","Example C2 domain. In production, synced from threat intelligence feeds."),
            ("domain","dns-tunnel.attacker.xyz","dns_tunnel","Generic","DNScat",0.88,"poc_placeholder","Example DNS tunneling domain. In production, synced from MISP feed."),
            ("ip","185.220.101.50","c2","APT28","Fancy Bear",0.95,"poc_placeholder","Example C2 IP. In production, synced from AlienVault OTX feed."),
            ("ip","45.142.212.100","c2","Lazarus","Lazarus Group",0.93,"poc_placeholder","Example C2 IP. In production, synced from AlienVault OTX feed."),
            ("cve","CVE-2021-44228","vulnerability","Multiple","Log4Shell",0.99,"nvd","Critical Log4j RCE."),
            ("cve","CVE-2017-0144","vulnerability","APT28","EternalBlue",0.98,"nvd","SMB RCE WannaCry."),
            ("cve","CVE-2023-23397","vulnerability","APT28","Outlook Zero-Day",0.94,"nvd","Outlook zero-click RCE."),
            ("ip","103.224.182.251","c2","Kimsuky","BabyShark",0.91,"poc_placeholder","Example C2 IP. In production, synced from AlienVault OTX feed."),
            ("ip","198.252.108.34","scanner","Generic","Shodan Scanner",0.65,"poc_placeholder","Example scanner IP. In production, synced from threat feeds."),
            ("domain","malware-payload.evil.com","malware_delivery","Generic","Dropper",0.92,"poc_placeholder","Example malware delivery domain. In production, synced from threat feeds."),
            ("process","chisel","tunneling","Generic","Chisel Tunnel",0.88,"local","Reverse tunnel tool used for lateral movement."),
            ("process","psexec","lateral_movement","APT28","PsExec",0.85,"local","Remote execution tool for lateral movement."),
            ("hash","d41d8cd98f00b204e9800998ecf8427e","suspicious","Generic","Empty File MD5",0.40,"local","MD5 of zero-byte file — sometimes used as placeholder by droppers."),
        ]
        with self._conn() as db:
            for s in seed:
                try:
                    db.execute("INSERT OR IGNORE INTO iocs (type,value,category,threat_actor,malware_family,confidence,source,description) VALUES (?,?,?,?,?,?,?,?)", s)
                except:
                    pass
            db.commit()
        log.info("IOC database seeded")

    def lookup(self, ioc_type, value):
        with self._conn() as db:
            row = db.execute("SELECT * FROM iocs WHERE type=? AND value=?", (ioc_type, value)).fetchone()
            if not row: return None
            cols = ["id","type","value","category","threat_actor","malware_family","confidence","source","description","added_at"]
            return dict(zip(cols, row))

    def search(self, value):
        with self._conn() as db:
            rows = db.execute("SELECT * FROM iocs WHERE value LIKE ?", ("%"+value+"%",)).fetchall()
            cols = ["id","type","value","category","threat_actor","malware_family","confidence","source","description","added_at"]
            return [dict(zip(cols, r)) for r in rows]

    def add_ioc(self, ioc_type, value, category=None, threat_actor=None, malware_family=None, confidence=0.5, source="manual", description=None):
        try:
            with self._conn() as db:
                db.execute("INSERT OR REPLACE INTO iocs (type,value,category,threat_actor,malware_family,confidence,source,description) VALUES (?,?,?,?,?,?,?,?)",
                           (ioc_type, value, category, threat_actor, malware_family, confidence, source, description))
                db.commit()
            return True
        except Exception as e:
            log.error("add_ioc failed: %s", e)
            return False

    def list_all(self):
        with self._conn() as db:
            rows = db.execute("SELECT * FROM iocs ORDER BY confidence DESC").fetchall()
            cols = ["id","type","value","category","threat_actor","malware_family","confidence","source","description","added_at"]
            return [dict(zip(cols, r)) for r in rows]

    def stats(self):
        with self._conn() as db:
            total   = db.execute("SELECT COUNT(*) FROM iocs").fetchone()[0]
            by_type = dict(db.execute("SELECT type, COUNT(*) FROM iocs GROUP BY type").fetchall())
            by_cat  = dict(db.execute("SELECT category, COUNT(*) FROM iocs GROUP BY category").fetchall())
            by_src  = dict(db.execute("SELECT source, COUNT(*) FROM iocs GROUP BY source").fetchall())
            matched = db.execute("SELECT COUNT(*) FROM enrichment_log WHERE matched=1").fetchone()[0]
        return {"total_iocs":total,"by_type":by_type,"by_category":by_cat,"by_source":by_src,"total_matches":matched}


class ThreatIntelligenceAgent:
    def __init__(self):
        self.agent_id         = AGENT_ID
        self.started_at       = datetime.now(timezone.utc).isoformat()
        self.db               = TIDatabase(DB_PATH)
        self.alerts_processed = 0
        self.alerts_enriched  = 0
        self.iocs_matched     = 0
        self.publish_errors   = 0
        self.running          = False
        self.consumer         = None
        self.producer         = None
        self._init_kafka()

    def _init_kafka(self):
        try:
            self.consumer = Consumer({
                "bootstrap.servers": KAFKA_BOOTSTRAP,
                "group.id": "ti-agent-group",
                "auto.offset.reset": "latest",
            })
            self.consumer.subscribe(CONSUME_TOPICS)
            self.producer = Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})
            log.info("Kafka connected to %s", KAFKA_BOOTSTRAP)
        except Exception as e:
            log.warning("Kafka unavailable: %s — API-only mode", e)
            self.consumer = None
            self.producer = None

    def _extract_iocs(self, alert):
        iocs = {"ip":[],"domain":[],"hash":[],"process":[]}
        details = alert.get("details") or {}
        for field in ["src_ip","dst_ip","host_id"]:
            v = alert.get(field) or details.get(field)
            if v and re.match(r"^\d+\.\d+\.\d+\.\d+$", str(v)):
                iocs["ip"].append(str(v))
        for field in ["domain","dst_dns"]:
            v = alert.get(field) or details.get(field)
            if v: iocs["domain"].append(str(v))
        for field in ["process"]:
            v = alert.get(field) or details.get(field)
            if v: iocs["process"].append(str(v))
        return iocs

    def enrich_alert(self, alert):
        iocs = self._extract_iocs(alert)
        matches = []
        max_conf = 0.0
        for ioc_type, values in iocs.items():
            for value in values:
                result = self.lookup_best(ioc_type, value)
                if result and result.get("confidence", 0) > 0.3:
                    matches.append(result)
                    max_conf = max(max_conf, result.get("confidence", 0))
                    with self.db._conn() as db:
                        db.execute("INSERT INTO enrichment_log (alert_id,ioc_value,ioc_type,matched) VALUES (?,?,?,1)",
                                   (alert.get("incident_id","?"), value, ioc_type))
                        db.commit()
        enrichment = {
            "enriched": len(matches) > 0,
            "iocs_checked": sum(len(v) for v in iocs.values()),
            "iocs_matched": len(matches),
            "max_confidence": round(max_conf, 3),
            "threat_actors": list({m["threat_actor"] for m in matches if m.get("threat_actor")}),
            "malware_families": list({m["malware_family"] for m in matches if m.get("malware_family")}),
            "categories": list({m.get("category") for m in matches if m.get("category")}),
            "matches": matches,
            "enriched_at": datetime.now(timezone.utc).isoformat(),
        }
        original_sev = alert.get("severity", "MEDIUM")
        new_sev = original_sev
        if max_conf >= 0.95 and original_sev in ("LOW","MEDIUM","HIGH"):
            new_sev = "CRITICAL"
            enrichment["severity_upgraded"] = True
        elif max_conf >= 0.80 and original_sev in ("LOW","MEDIUM"):
            new_sev = "HIGH"
            enrichment["severity_upgraded"] = True
        enriched = dict(alert)
        enriched["severity"] = new_sev
        enriched["original_severity"] = original_sev
        enriched["threat_intelligence"] = enrichment
        if matches:
            self.iocs_matched    += len(matches)
            self.alerts_enriched += 1
        return enriched

    def lookup_best(self, ioc_type, value):
        r = self.db.lookup(ioc_type, value)
        if r: return r
        results = self.db.search(value)
        return results[0] if results else None

    def run(self):
        self.running = True
        log.info("TI consumer started")
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
                alert = json.loads(msg.value().decode("utf-8"))
                self.alerts_processed += 1
                enriched = self.enrich_alert(alert)
                if self.producer:
                    self.producer.produce(PRODUCE_TOPIC, json.dumps(enriched).encode("utf-8"))
                    self.producer.flush()
                log.info("Enriched alert enriched=%s matches=%d",
                         enriched["threat_intelligence"]["enriched"],
                         enriched["threat_intelligence"]["iocs_matched"])
            except Exception as e:
                log.error("Consumer error: %s", e)
                time.sleep(2)

    def stop(self):
        self.running = False
        if self.consumer: self.consumer.close()


app = FastAPI(title="MASS Threat Intelligence Agent", version="1.0.0")
agent = None


def _heartbeat_loop():
    from confluent_kafka import Producer as KProducer
    import json as _json
    p = KProducer({"bootstrap.servers": KAFKA_BOOTSTRAP})
    while True:
        try:
            msg = _json.dumps({
                "agent_id": "threat-intel-agent-01",
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
    agent = ThreatIntelligenceAgent()
    t = threading.Thread(target=agent.run, daemon=True)
    t.start()
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    log.info("TI Agent ready")

class IOCRequest(BaseModel):
    type:           str
    value:          str
    category:       Optional[str]   = None
    threat_actor:   Optional[str]   = None
    malware_family: Optional[str]   = None
    confidence:     Optional[float] = 0.5
    source:         Optional[str]   = "manual"
    description:    Optional[str]   = None

@app.get("/health")
def health():
    if not agent: return {"status":"starting"}
    return {"status":"running","agent_id":agent.agent_id,"uptime":agent.started_at}

@app.get("/status")
def status():
    if not agent: return {"status":"starting"}
    return {
        "agent_id":agent.agent_id,"started_at":agent.started_at,
        "kafka_topics":CONSUME_TOPICS,"produce_topic":PRODUCE_TOPIC,
        "virustotal_enabled":bool(VIRUSTOTAL_API_KEY),"otx_enabled":bool(OTX_API_KEY),
        "alerts_processed":agent.alerts_processed,"alerts_enriched":agent.alerts_enriched,
        "iocs_matched":agent.iocs_matched,"publish_errors":agent.publish_errors,
        "enrichment_rate":round(agent.alerts_enriched/agent.alerts_processed,3) if agent.alerts_processed else 0.0,
    }

@app.get("/stats")
def stats():
    if not agent: return {"status":"starting"}
    return agent.db.stats()

@app.get("/iocs")
def list_iocs():
    if not agent: return {"iocs":[]}
    return {"iocs":agent.db.list_all()}

@app.get("/iocs/lookup")
def lookup_ioc(type: str, value: str):
    if not agent: raise HTTPException(503,"Agent starting")
    result = agent.db.lookup(type, value)
    if not result: raise HTTPException(404, f"Not found: {type}={value}")
    return result

@app.post("/iocs/add")
def add_ioc(req: IOCRequest):
    if not agent: raise HTTPException(503,"Agent starting")
    ok = agent.db.add_ioc(req.type,req.value,req.category,req.threat_actor,
                          req.malware_family,req.confidence,req.source,req.description)
    if not ok: raise HTTPException(500,"Failed")
    return {"status":"added","type":req.type,"value":req.value}

if __name__ == "__main__":
    log.info("Starting on port %d", HEALTH_PORT)
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")
