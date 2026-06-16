import json, logging, os
from confluent_kafka import Consumer, KafkaError
from pymongo import MongoClient
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS
import psycopg2

KAFKA_BOOTSTRAP = "campus-kafka:29092"
MONGO_URI       = "mongodb://massadmin:mass2026@campus-mongodb:27017/"
INFLUX_URL      = "http://campus-influxdb:8086"
INFLUX_TOKEN    = "campus-influx-token-mass2026"
INFLUX_ORG      = "campus-security"
INFLUX_BUCKET   = "iot-telemetry"
PG_DSN          = "host=campus-postgres port=5432 dbname=massdb user=massadmin password=mass2026"

TOPICS = ["data.alerts","data.incidents","data.telemetry","iot.telemetry","iot.alerts","iot.incidents","pac.alerts","pac.events","pac.incidents","hq.incidents","hq.correlated","agents.heartbeats","policy.violations","forensic.evidence","data.flows","ti.enriched"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("db_writer")

PG_INIT = """
CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, alert_id TEXT, topic TEXT, agent_id TEXT, alert_type TEXT, severity TEXT, confidence FLOAT, timestamp TIMESTAMPTZ, payload JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS incidents (id SERIAL PRIMARY KEY, incident_id TEXT, topic TEXT, agent_id TEXT, severity TEXT, timestamp TIMESTAMPTZ, payload JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS heartbeats (id SERIAL PRIMARY KEY, agent_id TEXT, agent_type TEXT, status TEXT, timestamp TIMESTAMPTZ, stats JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
"""

def main():
    log.info("Connecting to databases...")
    mongo = MongoClient(MONGO_URI)
    db = mongo["mass_security"]
    influx = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
    write_api = influx.write_api(write_options=SYNCHRONOUS)
    pg = psycopg2.connect(PG_DSN)
    with pg.cursor() as cur:
        cur.execute(PG_INIT)
    pg.commit()
    consumer = Consumer({"bootstrap.servers": KAFKA_BOOTSTRAP, "group.id": "db-writer-01", "auto.offset.reset": "earliest"})
    consumer.subscribe(TOPICS)
    log.info(f"Running — subscribed to {len(TOPICS)} topics")
    counts = {"mongo":0,"influx":0,"pg":0}
    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None or msg.error():
                continue
            topic = msg.topic()
            try:
                data = json.loads(msg.value().decode())
                db[topic.replace(".","_")].insert_one({**data, "_topic": topic})
                counts["mongo"] += 1
                if topic in ("iot.telemetry","data.telemetry","data.alerts","iot.alerts","pac.alerts"):
                    p = Point(topic).tag("agent_id", data.get("agent_id","?")).field("value", float(data.get("value", data.get("confidence", 1.0)))).time(data.get("timestamp"), WritePrecision.NS)
                    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)
                    counts["influx"] += 1
                if topic in ("data.alerts","iot.alerts","pac.alerts"):
                    with pg.cursor() as cur:
                        cur.execute("INSERT INTO alerts (alert_id,topic,agent_id,alert_type,severity,confidence,timestamp,payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                            (data.get("alert_id"),topic,data.get("agent_id"),data.get("alert_type"),str(data.get("severity","")),data.get("confidence",0),data.get("timestamp"),json.dumps(data)))
                    pg.commit()
                    counts["pg"] += 1
                elif topic in ("data.incidents","iot.incidents","pac.incidents","hq.incidents"):
                    with pg.cursor() as cur:
                        cur.execute("INSERT INTO incidents (incident_id,topic,agent_id,severity,timestamp,payload) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                            (data.get("incident_id"),topic,data.get("agent_id","?"),str(data.get("severity","")),data.get("created_at"),json.dumps(data)))
                    pg.commit()
                    counts["pg"] += 1
                elif topic == "agents.heartbeats":
                    with pg.cursor() as cur:
                        cur.execute("INSERT INTO heartbeats (agent_id,agent_type,status,timestamp,stats) VALUES (%s,%s,%s,%s,%s)",
                            (data.get("agent_id"),data.get("agent_type"),data.get("status"),data.get("timestamp"),json.dumps(data.get("stats",{}))))
                    pg.commit()
                    counts["pg"] += 1
                if sum(counts.values()) % 100 == 0:
                    log.info(f"Mongo:{counts['mongo']} Influx:{counts['influx']} PG:{counts['pg']}")
            except Exception as e:
                pg.rollback()
                log.warning(f"[{topic}] {e}")
    except KeyboardInterrupt:
        log.info(f"Done: {counts}")
    finally:
        consumer.close()
        influx.close()
        pg.close()
        mongo.close()

if __name__ == "__main__":
    main()
