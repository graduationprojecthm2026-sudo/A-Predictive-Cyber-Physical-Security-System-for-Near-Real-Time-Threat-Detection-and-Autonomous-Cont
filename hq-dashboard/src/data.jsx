// Live data store: fetches from real MASS agents every 5s
// Falls back to simulated values if an agent is unreachable
// Endpoints:
//   8020/status, 8020/incidents, 8020/correlations, 8020/commands, 8020/history
//   8006/health, 8006/correlations
//   8007/health, 8007/playbooks, 8007/executions
//   8008/metrics

const AGENTS = [
  // Server Room — field agents
  { id: 'gateway-agent-01',            domain: 'network',  building: 'SR' },
  { id: 'behavioral-agent-01',         domain: 'iot',      building: 'SR' },
  { id: 'pac-eda-agent-01',            domain: 'pac',      building: 'SR' },
  { id: 'credential-anomaly-agent-01', domain: 'pac',      building: 'SR' },
  // Building A — local managers + endpoint agents
  { id: 'iot-local-manager-01',        domain: 'iot',      building: 'A'  },
  { id: 'pac-local-manager-01',        domain: 'pac',      building: 'A'  },
  { id: 'data-local-manager-01',       domain: 'data',     building: 'A'  },
  { id: 'ndr-agent-01',                domain: 'network',  building: 'A'  },
  { id: 'edr-agent-01',                domain: 'endpoint', building: 'A'  },
  // HQ — intelligence agents
  { id: 'analytical-agent-01',         domain: 'hq',       building: 'HQ' },
  { id: 'orchestrator-agent-01',       domain: 'hq',       building: 'HQ' },
  { id: 'learning-agent-01',           domain: 'hq',       building: 'HQ' },
  { id: 'threat-intel-agent-01',       domain: 'hq',       building: 'HQ' },
  { id: 'forensic-agent-hq-01',        domain: 'hq',       building: 'HQ' },
  { id: 'central-manager-01',          domain: 'hq',       building: 'HQ' },
];

const BUILDINGS = [
  { id:'HQ', label:'HQ Manager',       x:50, y:50, role:'hq'     },
  { id:'A',  label:'Building A · Eng', x:18, y:30, role:'campus' },
  { id:'B',  label:'Building B · IoT', x:84, y:32, role:'campus' },
  { id:'C',  label:'Building C · Lib', x:20, y:74, role:'campus' },
  { id:'D',  label:'Building D · PAC', x:80, y:78, role:'campus' },
  { id:'SR', label:'Server Room',      x:50, y:14, role:'core'   },
];

const MITRE_TACTICS = ['Reconnaissance','Initial Access','Execution','Persistence','Privilege Escalation','Lateral Movement','Collection','Exfiltration','Impact','Discovery'];
const SEVERITIES    = ['critical','high','medium','low'];
const DOMAINS       = ['iot','physical_access','data_network'];

const DEFAULT_PLAYBOOKS = [
  { id:'pb-001', name:'Intrusion Response',    tactic:'Initial Access',   steps:4, runtime:'45s', min_severity:'HIGH',   triggers:['intrusion','ransomware_behavior'] },
  { id:'pb-002', name:'Credential Compromise', tactic:'Privilege Esc.',   steps:3, runtime:'30s', min_severity:'HIGH',   triggers:['credential_anomaly','insider_threat'] },
  { id:'pb-003', name:'IoT Quarantine',        tactic:'Lateral Movement', steps:5, runtime:'60s', min_severity:'MEDIUM', triggers:['iot_anomaly','iot_cyber_bridge','gateway_anomaly'] },
  { id:'pb-004', name:'Data Exfil Block',      tactic:'Exfiltration',     steps:3, runtime:'20s', min_severity:'HIGH',   triggers:['dns_exfil','coordinated_attack'] },
  { id:'pb-005', name:'PAC Lockdown',          tactic:'Initial Access',   steps:4, runtime:'15s', min_severity:'MEDIUM', triggers:['physical_access','badge_anomaly'] },
  { id:'pb-006', name:'Anomalous Beacon Hunt', tactic:'Reconnaissance',   steps:6, runtime:'90s', min_severity:'LOW',    triggers:['iot_anomaly','intrusion'] },
];

const rand = (s) => {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

function genFallbackIncidents(seed = 'base') {
  const r = rand(seed);
  const desc = [
    'Unusual outbound beacon to 185.x.x.x',
    'Failed MFA burst on faculty SSO',
    'IoT camera firmware tampering',
    'Lateral SMB scan from lab subnet',
    'Privilege escalation attempt on EDR-A12',
    'Badge clone signature at Gate-D2',
    'DNS exfil via TXT records',
    'Encrypted ZIP staged in /tmp/sd5',
    'Anomalous Kerberos TGS request',
    'Behavioral drift on user a.morsi',
    'PAC schedule override outside hours',
    'NDR threshold breach: data.flows',
  ];
  const now = Date.now();
  return Array.from({ length: 14 }).map((_, i) => {
    const sev = r() < .12 ? 'critical' : r() < .35 ? 'high' : r() < .7 ? 'medium' : 'low';
    return {
      id:     'INC-' + (4820 - i).toString().padStart(4, '0'),
      sev,
      domain: DOMAINS[Math.floor(r() * DOMAINS.length)],
      desc:   desc[Math.floor(r() * desc.length)],
      ts:     now - Math.floor(r() * 60_000 * 30),
      mitre:  MITRE_TACTICS[Math.floor(r() * MITRE_TACTICS.length)],
      agent:  AGENTS[Math.floor(r() * AGENTS.length)].id,
    };
  }).sort((a, b) => b.ts - a.ts);
}

function normaliseIncident(inc, i) {
  const alertType = inc.alert_type || inc.type || '';
  const hostId    = inc.host_id || (inc.details && inc.details.src_ip) || (inc.details && inc.details.host_id) || '';
  const detailStr = (inc.details && inc.details.detail) || '';
  let desc = 'Security event detected';
  if (alertType) {
    desc = alertType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (hostId) desc += ': ' + hostId;
  } else if (detailStr) {
    desc = detailStr;
  }
  const rawTime = inc.created_at || inc.timestamp || inc.escalated_at || null;
  const ts = rawTime ? new Date(rawTime).getTime() : (Date.now() - i * 15000);
  return {
    id:         inc.incident_id || inc.id || ('INC-' + (4820 - i).toString().padStart(4, '0')),
    sev:        (inc.severity || inc.sev || 'medium').toLowerCase(),
    domain:     inc.network_domain || inc.domain || 'data_network',
    desc,
    ts,
    alert_type: alertType,
    mitre:      (inc.details && inc.details.mitre_technique) || inc.mitre_tactic || inc.mitre || MITRE_TACTICS[i % MITRE_TACTICS.length],
    agent:      inc.agent_type ? (inc.agent_type.toUpperCase() + (inc.host_id ? ': ' + inc.host_id : '')) : (inc.manager_id || inc.agent_id || AGENTS[i % AGENTS.length].id),
    ml_confidence: typeof inc.ml_confidence === 'number' ? inc.ml_confidence : undefined,
  };
}

function normaliseCorrelation(c, i) {
  const domainPairs = [
    { a:'iot',      b:'network',  weight:.9,  label:'IoT beacon → NDR flow burst'    },
    { a:'identity', b:'endpoint', weight:.72, label:'Credential spray → EDR anomaly' },
    { a:'pac',      b:'identity', weight:.55, label:'Badge anomaly → MFA failure'    },
    { a:'network',  b:'data',     weight:.81, label:'DNS exfil → flow signature'     },
    { a:'iot',      b:'pac',      weight:.41, label:'IoT vendor → PAC firmware'      },
  ];
  if (!c) return { a:"iot", b:"data", weight:0, label:"Waiting for data", severity:null, created_at:null };
  return {
    a:          (c.domains_involved && c.domains_involved[0]) || c.source_domain || c.domain_a || c.a || domainPairs[i % domainPairs.length].a,
    b:          (c.domains_involved && c.domains_involved[1]) || c.target_domain || c.domain_b || c.b || domainPairs[i % domainPairs.length].b,
    weight:     c.confidence    || c.weight   || 0.7,
    label:      (c.details && c.details.detail) || c.description || c.label || 'Cross-domain correlation detected',
    severity:   c.severity   || null,
    created_at: c.created_at || c.timestamp || null,
    correlation_type: c.correlation_type || null,
    domains_involved: c.domains_involved || null,
    details: c.details || null,
    correlation_id: c.correlation_id || null,
  };
}

const FALLBACK_CORRELATIONS = [
  { a:'iot',      b:'network',  weight:.9,  label:'IoT beacon → NDR flow burst'    },
  { a:'identity', b:'endpoint', weight:.72, label:'Credential spray → EDR anomaly' },
  { a:'pac',      b:'identity', weight:.55, label:'Badge anomaly → MFA failure'    },
  { a:'network',  b:'data',     weight:.81, label:'DNS exfil → flow signature'     },
  { a:'iot',      b:'pac',      weight:.41, label:'IoT vendor → PAC firmware'      },
];

async function safeFetch(url, timeout = 4000) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeout);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const HQContext = React.createContext(null);

function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function HQProvider({ children }) {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setT(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [status,       setStatus]       = React.useState(null);
  const [rawIncidents, setRawIncidents] = React.useState(null);
  const [rawCorrs,     setRawCorrs]     = React.useState(null);
  const [rawCommands,  setRawCommands]  = React.useState(null);
  const [aiHealth,     setAiHealth]     = React.useState(null);
  const [orchHealth,   setOrchHealth]   = React.useState(null);
  const [rawPlaybooks, setRawPlaybooks] = React.useState(null);
  const [rawExecs,     setRawExecs]     = React.useState(null);
  const [mlMetrics,    setMlMetrics]    = React.useState(null);
  const [rawHistory,   setRawHistory]   = React.useState(null);

  const [online, setOnline] = React.useState({
    central: false, analytical: false, orchestrator: false, learning: false,
  });

  React.useEffect(() => {
    async function fetchAll() {
      const [st, inc, corr, cmd, hist] = await Promise.all([
        safeFetch('/api/8020/status'),
        safeFetch('/api/8020/incidents?limit=1000'),
        safeFetch('/api/8020/correlations'),
        safeFetch('/api/8020/commands'),
        safeFetch('/api/8020/history?limit=2000'),
      ]);
      if (st)   { setStatus(st);        setOnline(o => ({ ...o, central: true  })); }
      else        setOnline(o => ({ ...o, central: false }));
      if (inc)  setRawIncidents(inc);
      if (corr) setRawCorrs(corr);
      if (cmd)  setRawCommands(cmd);
      if (hist) setRawHistory(hist);

      const ai = await safeFetch('/api/8006/health');
      if (ai) { setAiHealth(ai); setOnline(o => ({ ...o, analytical: true  })); }
      else      setOnline(o => ({ ...o, analytical: false }));

      const aiCorr = await safeFetch('/api/8006/correlations');
      if (aiCorr && Array.isArray(aiCorr) && aiCorr.length > 0) {
        setRawCorrs({ correlations: aiCorr });
      }

      const [oh, pbs, exs] = await Promise.all([
        safeFetch('/api/8007/health'),
        safeFetch('/api/8007/playbooks'),
        safeFetch('/api/8007/executions'),
      ]);
      if (oh)  { setOrchHealth(oh); setOnline(o => ({ ...o, orchestrator: true  })); }
      else       setOnline(o => ({ ...o, orchestrator: false }));
      if (pbs) setRawPlaybooks(pbs);
      if (exs) setRawExecs(exs);

      const ml = await safeFetch('/api/8008/metrics');
      if (ml) { setMlMetrics(ml); setOnline(o => ({ ...o, learning: true  })); }
      else      setOnline(o => ({ ...o, learning: false }));
    }
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);

  const threat_level = React.useMemo(() => {
    if (status && status.threat_level) return status.threat_level.toUpperCase();
    const levels = ['LOW','MEDIUM','HIGH','CRITICAL'];
    return levels[Math.min(3, Math.floor((Math.sin(t / 40) + 1) / 2 * 2.6 + (t % 3 === 0 ? 0.4 : 0)))];
  }, [status, t]);

  const agents = React.useMemo(() => {
    var base = AGENTS.map((a, i) => {
      const realHealth = status && status.agent_health && status.agent_health[a.id];
      if (realHealth !== undefined && realHealth !== null) {
        return {
          ...a,
          healthy:           realHealth.healthy,
          last_seen_ago_sec: realHealth.last_seen_ago_sec || 0,
          load:              0.3 + Math.sin(t / 10 + i) * 0.3,
        };
      }
      const r = rand(a.id + String(Math.floor(t / 5)));
      return { ...a, healthy: r() > 0.05, last_seen_ago_sec: Math.floor(r() * 30), load: 0.2 + r() * 0.7 };
    });
    if (status && status.agent_health) {
      var knownIds = new Set(AGENTS.map(function(a) { return a.id; }));
      Object.entries(status.agent_health).forEach(function(entry) {
        var agId = entry[0]; var agHealth = entry[1];
        if (!knownIds.has(agId)) {
          base.push({
            id: agId,
            domain: 'unknown',
            building: '?',
            healthy: agHealth && agHealth.healthy,
            last_seen_ago_sec: (agHealth && agHealth.last_seen_ago_sec) || 0,
            load: 0.5,
          });
        }
      });
    }
    return base;
  }, [status, t]);

  const agents_healthy = agents.filter(a => a.healthy).length;

  const incidents = React.useMemo(() => {
    const liveArr = rawIncidents
      ? (Array.isArray(rawIncidents) ? rawIncidents : (rawIncidents.incidents || rawIncidents.data || []))
      : [];
    const liveNorm = liveArr.map(normaliseIncident);

    const histArr = rawHistory ? (rawHistory.incidents || []) : [];
    const histNorm = histArr.map(normaliseIncident);

    const seen = new Set();
    const merged = [];
    for (const inc of [...liveNorm, ...histNorm]) {
      if (!seen.has(inc.id)) {
        seen.add(inc.id);
        merged.push(inc);
      }
    }
    if (merged.length > 0) return merged.sort((a, b) => b.ts - a.ts);
    return genFallbackIncidents('s' + Math.floor(t / 8));
  }, [rawIncidents, rawHistory, t]);

  const counts = React.useMemo(() => {
    if (status && status.incidents) {
      const s = status.incidents;
      return {
        total:     s.total    || 0,
        critical:  s.critical || 0,
        high:      s.high     || 0,
        medium:    s.medium   || 0,
        low:       s.low      || 0,
        by_domain: s.by_domain || DOMAINS.reduce((a, d) => ({ ...a, [d]: 0 }), {}),
      };
    }
    return {
      total:     incidents.length,
      critical:  incidents.filter(i => i.sev === 'critical').length,
      high:      incidents.filter(i => i.sev === 'high').length,
      medium:    incidents.filter(i => i.sev === 'medium').length,
      low:       incidents.filter(i => i.sev === 'low').length,
      by_domain: DOMAINS.reduce((a, d) => ({ ...a, [d]: incidents.filter(i => i.domain === d).length }), {}),
    };
  }, [status, incidents]);

  const correlations = React.useMemo(() => {
    if (rawCorrs) {
      const arr = Array.isArray(rawCorrs)
        ? rawCorrs
        : (rawCorrs.correlations || rawCorrs.data || []);
      if (arr.length > 0) return arr.slice(0, 6).map(normaliseCorrelation);
    }
    return [];
  }, [rawCorrs]);

  const correlations_active = React.useMemo(() => {
    if (status && status.correlations_active !== undefined) return status.correlations_active;
    if (rawCorrs) {
      const arr = Array.isArray(rawCorrs) ? rawCorrs : (rawCorrs.correlations || []);
      return arr.length;
    }
    return 6 + (t % 4);
  }, [status, rawCorrs, t]);

  const commands_issued = React.useMemo(() => {
    if (status && status.commands_issued !== undefined) return status.commands_issued;
    if (rawCommands) {
      const arr = Array.isArray(rawCommands) ? rawCommands : (rawCommands.commands || []);
      return arr.length;
    }
    return 412 + (t % 24);
  }, [status, rawCommands, t]);

  const ndr_threshold = 220;

  const throughput = React.useMemo(() => {
    if (aiHealth && aiHealth.kafka_throughput) return aiHealth.kafka_throughput;
    if (aiHealth && aiHealth.throughput)       return aiHealth.throughput;
    const k = (base, jitter, freq) =>
      Math.max(0, base + Math.sin(t / freq) * jitter + (Math.random() - .5) * jitter * 0.3);
    var scale = ({LOW:0.06, MEDIUM:0.4, HIGH:0.7, CRITICAL:1})[threat_level] || 0.06;
    return { ndr: k(140*scale, 60*scale, 7), edr: k(95*scale, 35*scale, 11), iot: k(60*scale, 28*scale, 5), pac: k(40*scale, 20*scale, 9), _simulated: true };
  }, [aiHealth, t, threat_level]);

  const anomalySpike = throughput.ndr > ndr_threshold * 0.85;

  const mitre = React.useMemo(() => {
    if (aiHealth && aiHealth.kill_chain_tracker) {
      var kct = aiHealth.kill_chain_tracker;
      var actors = Object.keys(kct);
      return MITRE_TACTICS.map(function(name) {
        var detected = false;
        for (var ki = 0; ki < actors.length; ki++) {
          var stageInfo = kct[actors[ki]];
          if (stageInfo && stageInfo.stages_active && stageInfo.stages_active.indexOf(name) >= 0) {
            detected = true;
            break;
          }
        }
        var count = 0;
        for (var ci = 0; ci < actors.length; ci++) {
          var si2 = kct[actors[ci]];
          if (si2 && si2.status === 'resolved') continue;
          if (si2 && si2.stages_active && si2.stages_active.indexOf(name) >= 0) count++;
        }
        return { name: name, coverage: count > 0 ? Math.max(0.15, count / Math.max(actors.length, 1)) : 0.05, detected: count };
      });
    }
    if (aiHealth && aiHealth.mitre_coverage && Array.isArray(aiHealth.mitre_coverage)) {
      return aiHealth.mitre_coverage.map(function(m, i) {
        return {
          name:     m.tactic || m.name || MITRE_TACTICS[i],
          coverage: m.coverage || m.score || 0.5,
          detected: m.detected || m.count || 0,
        };
      });
    }
    return MITRE_TACTICS.map(function(name) {
      return { name: name, coverage: 0.5, detected: 0 };
    });
  }, [aiHealth, t, threat_level]);

  const ai = React.useMemo(() => {
    var avgConf = 0.85;
    if (incidents && incidents.length > 0) {
      var confTotal = 0; var confCount = 0;
      incidents.forEach(function(inc) {
        var c = inc.ml_confidence || inc.confidence || (inc.details && inc.details.confidence);
        if (!c || typeof c !== 'number') {
          var sev = (inc.severity || inc.sev || '').toUpperCase();
          if (sev === 'CRITICAL') c = 0.95;
          else if (sev === 'HIGH') c = 0.85;
          else if (sev === 'MEDIUM') c = 0.65;
          else c = 0.5;
        }
        confTotal += c; confCount++;
      });
      if (confCount > 0) avgConf = confTotal / confCount;
    }
    const base = {
      sessions:             5160,
      techniques_detected:  95,
      unknown_similarities: 18,
      correlations_fired:   38 + (t % 19),
      confidence:           avgConf,
      incidents_by_domain_iot:     0,
      incidents_by_domain_pac:     0,
      incidents_by_domain_network: 0,
      reasoning: (function() {
        if (typeof correlations_active === 'number' && correlations_active > 5) {
          return 'Active multi-domain campaign detected across ' + correlations_active + ' correlation events. Orchestrator has issued ' + commands_issued + ' response commands.';
        }
        if (typeof correlations_active === 'number' && correlations_active > 0) {
          return 'Cross-domain correlations detected: ' + correlations_active + ' events. Monitoring for attack progression.';
        }
        if (typeof correlations_active === 'number') {
          return 'No cross-domain correlations detected. System operating normally. All domains monitored.';
        }
        return threat_level === 'CRITICAL'
          ? 'Multi-domain attack chain detected. NDR + EDR + Identity correlation confirmed. Orchestrator executing containment.'
          : threat_level === 'HIGH'
            ? 'Elevated correlations across IoT and Network domains. Likely scanning or exfil attempt in progress.'
            : 'Baseline activity nominal. Behavioral drift within tolerance. Continuous monitoring active.';
      })(),
    };
    if (!aiHealth) return base;
    return {
      sessions:             (aiHealth.stats && aiHealth.stats.incidents_received) || aiHealth.sessions || base.sessions,
      techniques_detected:  (aiHealth.stats && (aiHealth.stats.coordinated_attack + aiHealth.stats.campus_wide_threat + aiHealth.stats.iot_cyber_bridge)) || aiHealth.techniques_detected || base.techniques_detected,
      unknown_similarities: (aiHealth.stats && aiHealth.stats.iot_cyber_bridge) || aiHealth.unknown_similarities || base.unknown_similarities,
      correlations_fired:   (aiHealth.stats && aiHealth.stats.correlations_fired) || aiHealth.correlations_fired || base.correlations_fired,
      confidence:           aiHealth.confidence           || (aiHealth.model_confidence)     || base.confidence,
      incidents_by_domain_iot:     (aiHealth.incidents_by_domain && aiHealth.incidents_by_domain.iot)            || base.incidents_by_domain_iot,
      incidents_by_domain_pac:     (aiHealth.incidents_by_domain && aiHealth.incidents_by_domain.physical_access) || base.incidents_by_domain_pac,
      incidents_by_domain_network: (aiHealth.incidents_by_domain && aiHealth.incidents_by_domain.data_network)    || base.incidents_by_domain_network,
      reasoning:            aiHealth.session_conclusion   || aiHealth.reasoning              || base.reasoning,
    };
  }, [aiHealth, threat_level, t, incidents, correlations_active, commands_issued]);

  const playbooks = React.useMemo(() => {
    if (rawPlaybooks) {
      // Handle dict format from orchestrator: {key: {name, triggers, steps, min_severity}}
      if (typeof rawPlaybooks === 'object' && !Array.isArray(rawPlaybooks) && !rawPlaybooks.playbooks) {
        var keys = Object.keys(rawPlaybooks);
        if (keys.length > 0 && rawPlaybooks[keys[0]] && rawPlaybooks[keys[0]].name) {
          return keys.map(function(key) {
            var val = rawPlaybooks[key];
            return {
              id:           key,
              name:         val.name || key,
              tactic:       Array.isArray(val.triggers) ? val.triggers.join(', ') : 'Detection',
              steps:        val.steps || 0,
              runtime:      (val.steps || 0) + ' steps',
              min_severity: val.min_severity || 'HIGH',
              triggers:     val.triggers || [],
            };
          });
        }
      }
      const arr = Array.isArray(rawPlaybooks) ? rawPlaybooks : (rawPlaybooks.playbooks || []);
      if (arr.length > 0) return arr.map((p, idx) => ({
        id:           p.id      || p.playbook_id       || ('pb-' + String(idx + 1).padStart(3, '0')),
        name:         p.name    || p.title             || 'Unnamed Playbook',
        tactic:       p.tactic  || p.mitre_tactic      || 'Detection',
        steps:        p.steps ? (Array.isArray(p.steps) ? p.steps.length : p.steps) : 4,
        runtime:      p.runtime || p.estimated_runtime || '30s',
        min_severity: p.min_severity || 'HIGH',
        triggers:     Array.isArray(p.triggers) ? p.triggers : [],
      }));
    }
    return DEFAULT_PLAYBOOKS;
  }, [rawPlaybooks]);

  var executions = React.useMemo(function() {
    if (rawExecs) {
      var arr = Array.isArray(rawExecs) ? rawExecs : (rawExecs.executions || []);
      if (arr.length > 0) {
        var byPb = {};
        for (var ei = 0; ei < arr.length; ei++) {
          var pbName = arr[ei].playbook_name || arr[ei].playbook_id || 'unknown';
          byPb[pbName] = arr[ei];
        }
        var unique = [];
        var pbKeys = Object.keys(byPb);
        for (var ki = 0; ki < pbKeys.length && unique.length < 6; ki++) {
          unique.push(byPb[pbKeys[ki]]);
        }
        return unique.map(function(ex, i) {
          var pb = null;
          for (var pi = 0; pi < playbooks.length; pi++) {
            var p = playbooks[pi];
            if (p.id === ex.playbook_id || p.id === ex.pb || p.name === ex.playbook_name) {
              pb = p; break;
            }
          }
          var stepCount    = pb && typeof pb.steps === 'number' ? pb.steps : 4;
          var stepDetails  = pb && pb.triggers ? pb.triggers : [];
          var exStatus     = (ex.status || 'running').toLowerCase();
          var commandsDone = (ex.commands_issued && Array.isArray(ex.commands_issued)) ? ex.commands_issued.length : 0;
          var steps = Array.from({ length: stepCount }).map(function(_, si) {
            if (exStatus === 'success') return true;
            if (exStatus === 'failed') return si < commandsDone ? (si === commandsDone - 1 ? 'failed' : true) : false;
            if (exStatus === 'pending') return false;
            return si < commandsDone;
          });
          return {
            id:      ex.id || ex.execution_id || ('EX-' + (2014 - i)),
            pb:      (pb && pb.id) || ex.playbook_id || ex.pb,
            pbName:  (pb && pb.name) || ex.playbook_name || 'Unknown',
            pbStepActions: (ex.commands_issued && Array.isArray(ex.commands_issued)) ? ex.commands_issued.map(function(c){ return c.action || 'step'; }) : [],
            status:  exStatus,
            started: t - (ex.elapsed_seconds || i * 20),
            steps,
          };
        });
      }
    }
    return [
      { id:'EX-2014', pb:'pb-001', status:'running', started:t-3,  steps:[1,1,1,0]     },
      { id:'EX-2013', pb:'pb-005', status:'success', started:t-22, steps:[1,1,1,1]     },
      { id:'EX-2012', pb:'pb-003', status:'success', started:t-41, steps:[1,1,1,1,1]   },
      { id:'EX-2011', pb:'pb-002', status:'pending', started:t-1,  steps:[0,0,0]       },
      { id:'EX-2010', pb:'pb-006', status:'failed',  started:t-83, steps:[1,1,0,0,0,0] },
    ];
  }, [rawExecs, playbooks, t]);

  const ml = React.useMemo(() => {
    if (mlMetrics && mlMetrics.models && Array.isArray(mlMetrics.models)) {
      return mlMetrics.models.map(m => ({
        name:      m.name      || m.model_name || 'Model',
        precision: m.precision || 0,
        recall:    m.recall    || 0,
        f1:        m.f1        || m.f1_score   || 0,
      }));
    }
    return [
      { name:'Behavioral Analytics', precision:.91, recall:.89, f1:.90 },
      { name:'NDR Detection',        precision:.93, recall:.87, f1:.90 },
      { name:'EDR Detection',        precision:.95, recall:.88, f1:.91 },
    ];
  }, [mlMetrics]);

  const value = {
    t,
    online,
    threat_level,
    agents,
    agents_healthy,
    agents_total: agents.length,
    incidents,
    counts,
    correlations,
    correlations_active,
    commands_issued,
    throughput,
    ndr_threshold,
    anomalySpike,
    mitre,
    ai,
    playbooks,
    executions,
    ml,
    buildings: BUILDINGS,
    agent_health: (status && status.agent_health) ? status.agent_health : {},
  };

  return <HQContext.Provider value={value}>{children}</HQContext.Provider>;
}

const useHQ = () => React.useContext(HQContext);

const PLAYBOOKS = DEFAULT_PLAYBOOKS;
Object.assign(window, {
  HQContext, HQProvider, useHQ, useNow,
  MITRE_TACTICS, AGENTS, BUILDINGS, PLAYBOOKS, SEVERITIES, DOMAINS,
});
