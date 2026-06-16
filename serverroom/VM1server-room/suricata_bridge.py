import json, time
from datetime import datetime, timezone
from confluent_kafka import Producer

KAFKA_BROKER = '192.168.60.10:9092'
EVE_LOG      = '/var/log/suricata/eve.json'

# Infrastructure IPs — skip internal-to-internal traffic
INFRA_IPS = {'192.168.60.10', '192.168.60.11', '192.168.60.13'}

INTERNAL_PREFIXES = (
    '192.168.10.', '192.168.12.', '192.168.15.',
    '192.168.20.', '192.168.31.', '192.168.40.',
    '192.168.60.', '192.168.70.', '10.0.',
)

def is_internal(ip):
    return any(ip.startswith(p) for p in INTERNAL_PREFIXES)

producer = Producer({'bootstrap.servers': KAFKA_BROKER})
print('Suricata bridge running...')

with open(EVE_LOG, 'r') as f:
    f.seek(0, 2)
    while True:
        line = f.readline()
        if not line:
            time.sleep(0.1)
            continue
        try:
            event = json.loads(line.strip())
            event_type = event.get('event_type')

            # Smart infra filter
            src = event.get('src_ip', '')
            dst = event.get('dest_ip', event.get('dst_ip', ''))
            if src in INFRA_IPS and is_internal(dst):
                continue

            if event_type == 'flow':
                flow = {
                    'event_type': 'flow',
                    'src_ip':     event.get('src_ip', ''),
                    'dst_ip':     event.get('dest_ip', ''),
                    'dst_port':   event.get('dest_port', 0),
                    'src_port':   event.get('src_port', 0),
                    'proto':      event.get('proto', 'tcp').lower(),
                    'bytes_out':  event.get('flow', {}).get('bytes_toserver', 0),
                    'status':     'established',
                    'sensor':     'suricata',
                    'building':   'a1',
                    'floor':      '1',
                    'timestamp':  datetime.now(timezone.utc).isoformat(),
                }

            elif event_type == 'ssh':
                # SSH event fires immediately on connection attempt
                # Status S0 = SYN sent, triggers brute_force_ssh detection
                flow = {
                    'event_type': 'flow',
                    'src_ip':     event.get('src_ip', ''),
                    'dst_ip':     event.get('dest_ip', ''),
                    'dst_port':   event.get('dest_port', 0),
                    'src_port':   event.get('src_port', 0),
                    'proto':      'tcp',
                    'bytes_out':  0,
                    'status':     'S0',
                    'sensor':     'suricata',
                    'building':   'a1',
                    'floor':      '1',
                    'timestamp':  datetime.now(timezone.utc).isoformat(),
                }

            elif event_type == 'dns':
                # DNS event for tunneling detection
                flow = {
                    'event_type': 'flow',
                    'src_ip':     event.get('src_ip', ''),
                    'dst_ip':     event.get('dest_ip', ''),
                    'dst_port':   53,
                    'src_port':   event.get('src_port', 0),
                    'proto':      'udp',
                    'bytes_out':  0,
                    'status':     'established',
                    'sensor':     'suricata',
                    'building':   'a1',
                    'floor':      '1',
                    'timestamp':  datetime.now(timezone.utc).isoformat(),
                }

            else:
                continue

            if not flow['src_ip'] or not flow['dst_ip']:
                continue

            producer.produce('data.telemetry',
                json.dumps(flow).encode(),
                key=flow['src_ip'])
            producer.poll(0)
            print(f"[{event_type}] {flow['src_ip']} -> {flow['dst_ip']}:{flow['dst_port']}")

        except json.JSONDecodeError:
            pass
        except Exception as e:
            print(f'Error: {e}')
