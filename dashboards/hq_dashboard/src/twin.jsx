// Digital Twin: Live Campus Replica

var BUILDINGS_DT = [
  {id:'hq', label:'HQ / Admin', ip:'192.168.12.10', subnet:'192.168.12.0/24',
   vlans:['VLAN 12 Data','VLAN 22 IoT','VLAN 34 PAC'],
   agents:['analytical-agent-01','orchestrator-agent-01','learning-agent-01','threat-intel-agent-01','forensic-agent-hq-01','central-manager-01'],
   color:'#00d4ff', icon:'\u{1F3DB}', role:'HQ Intelligence'},
  {id:'server_room', label:'Server Room', ip:'192.168.60.x', subnet:'192.168.60.0/24',
   vlans:['VLAN 60 Internal','VLAN 50 DMZ'],
   agents:[],
   infra_services:[
     {name:'Kafka Broker', ip:'192.168.60.13:9092', role:'Message streaming'},
     {name:'MongoDB',      ip:'192.168.60.12:27017', role:'Incident storage'},
     {name:'MQTT Broker',  ip:'192.168.60.10:1883',  role:'IoT telemetry'},
   ],
   color:'#ff6b35', icon:'\u{1F5A5}', role:'Infrastructure only'},
  {id:'building_a', label:'Building A, Eng', ip:'192.168.40.10', subnet:'192.168.40.0/24',
   vlans:['VLAN 10 Students','VLAN 15 Staff','VLAN 20 IoT','VLAN 31 PAC','VLAN 40 Local Mgr'],
   agents:['gateway-agent-01','behavioral-agent-01','pac-eda-agent-01','credential-anomaly-agent-01','iot-local-manager-01','pac-local-manager-01','data-local-manager-01','ndr-agent-01','edr-agent-01'],
   color:'#44bb44', icon:'\u{1F3E2}', role:'Local Managers + IoT Pi + PAC Pi + Endpoints'},
  {id:'building_b', label:'Building B', ip:'192.168.41.10', subnet:'192.168.41.0/24',
   vlans:['VLAN 10 Students','VLAN 15 Staff','VLAN 20 IoT','VLAN 32 PAC'],
   agents:[], color:'#666666', icon:'\u{1F3E2}', role:'No agents deployed'},
  {id:'building_c', label:'Building C, Dentistry', ip:'N/A', subnet:'N/A',
   vlans:['VLAN 10'],
   agents:[], color:'#666666', icon:'\u{1F3E2}', role:'Passive, no agents deployed'}
];

var VLANS_DT = [
  {id:10, name:'Data (Students)',  building:'Academic',   subnet:'192.168.10.0/24',   purpose:'Student PCs, labs'},
  {id:15, name:'Data (Staff)',     building:'Academic',   subnet:'192.168.15.0/24',   purpose:'Faculty offices'},
  {id:20, name:'IoT Academic',     building:'Academic',   subnet:'192.168.20.0/25',   purpose:'Sensors, actuators'},
  {id:21, name:'IoT Admin',        building:'Admin',      subnet:'192.168.22.0/26',   purpose:'Admin IoT devices'},
  {id:22, name:'IoT HQ',           building:'HQ',         subnet:'192.168.23.0/26',   purpose:'HQ IoT/cameras'},
  {id:31, name:'PAC Acad-1',       building:'Academic 1', subnet:'192.168.24.0/27',   purpose:'RFID, locks'},
  {id:32, name:'PAC Acad-2',       building:'Academic 2', subnet:'192.168.24.32/27',  purpose:'RFID, locks'},
  {id:33, name:'PAC Admin',        building:'Admin',      subnet:'192.168.24.96/27',  purpose:'Admin access ctrl'},
  {id:34, name:'PAC HQ',           building:'HQ',         subnet:'192.168.24.128/27', purpose:'Biometric, HQ locks'},
  {id:40, name:'Local Manager A',  building:'Building A', subnet:'192.168.40.0/24',   purpose:'Local managers, SOAR executor'},
  {id:41, name:'Local Manager B',  building:'Building B', subnet:'192.168.41.0/24',   purpose:'Building B management'},
  {id:50, name:'DMZ',              building:'HQ',         subnet:'10.0.50.0/24',      purpose:'Web, DNS, VPN, Email'},
  {id:60, name:'Internal Servers', building:'Server Room',subnet:'192.168.60.0/24',   purpose:'DB, Kafka, MQTT, Agents'},
  {id:99, name:'Visitors/Guest',   building:'ALL',        subnet:'192.168.99.0/24',   purpose:'Guest WiFi access'}
];

var AGENT_BUILDING_MAP = {
  'analytical-agent-01':         'hq',
  'orchestrator-agent-01':       'hq',
  'learning-agent-01':           'hq',
  'threat-intel-agent-01':       'hq',
  'forensic-agent-hq-01':        'hq',
  'central-manager-01':          'hq',
  'gateway-agent-01':            'building_a',
  'behavioral-agent-01':         'building_a',
  'pac-eda-agent-01':            'building_a',
  'credential-anomaly-agent-01': 'building_a',
  'ndr-agent-01':                'building_a',
  'edr-agent-01':                'building_a',
  'iot-local-manager-01':        'building_a',
  'pac-local-manager-01':        'building_a',
  'data-local-manager-01':       'building_a'
};

function dtFmtTime(ts) {
  if (!ts) return 'never';
  var d = new Date(ts);
  if (isNaN(d)) return '—';
  var s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function dtFmt(t) {
  if (!t) return '—';
  return t.split('_').map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function getHostBuilding(host) {
  if (!host) return null;
  if (host.indexOf('192.168.40.') === 0) return 'building_a';
  if (host.indexOf('192.168.10.') === 0) return 'building_a';
  if (host.indexOf('192.168.41.') === 0) return 'building_b';
  if (host.indexOf('192.168.60.') === 0) return 'server_room';
  if (host.indexOf('192.168.12.') === 0) return 'hq';
  return null;
}

function DigitalTwinPage() {
  var sStatus   = React.useState(null);  var status    = sStatus[0];   var setStatus    = sStatus[1];
  var sInc      = React.useState([]);    var incidents  = sInc[0];     var setIncidents  = sInc[1];
  var sLoad     = React.useState(true);  var loading    = sLoad[0];    var setLoading    = sLoad[1];
  var sSync     = React.useState(null);  var lastSync   = sSync[0];    var setLastSync   = sSync[1];
  var sSel      = React.useState(null);  var selected   = sSel[0];     var setSelected   = sSel[1];
  var sTab      = React.useState('map'); var tab        = sTab[0];     var setTab        = sTab[1];
  var sSess     = React.useState([]);    var sessions   = sSess[0];    var setSessions   = sSess[1];
  var sSessIdx  = React.useState(null);  var sessIdx    = sSessIdx[0]; var setSessIdx    = sSessIdx[1];
  var sStep     = React.useState(0);     var step       = sStep[0];    var setStep       = sStep[1];
  var sPlay     = React.useState(false); var playing    = sPlay[0];    var setPlaying    = sPlay[1];
  var sCmds     = React.useState([]);    var commands   = sCmds[0];    var setCommands   = sCmds[1];

  function dtCapture() {
    var tl = status && status.threat_level ? status.threat_level : 'LOW';
    var sess = {
      id: 'S' + Date.now(),
      name: 'Session ' + new Date().toLocaleTimeString(),
      at: new Date().toISOString(),
      threat: tl,
      incidents: incidents.slice(0, 14),
      commands: commands.slice(0, 8)
    };
    var nx = sessions.concat([sess]);
    setSessions(nx); setSessIdx(nx.length - 1); setStep(0); setPlaying(false);
  }

  function dtSteps(sess) {
    if (!sess) return [];
    var sorted = sess.incidents.slice(0).sort(function(x, y) {
      return new Date(x.created_at || 0) - new Date(y.created_at || 0);
    });
    var a = sorted.map(function(i) {
      var srcIp = i.details && i.details.src_ip ? i.details.src_ip : '—';
      return {kind:'inc', sev:(i.severity||'low').toLowerCase(), text:dtFmt(i.alert_type||'event'),
        sub:(i.network_domain||'') + ' \xB7 ' + (i.host_id || srcIp), ts:i.created_at};
    });
    var b = sess.commands.map(function(c) {
      return {kind:'soar', sev:'info', text:'SOAR \xB7 ' + dtFmt(c.action||c.command||'action'),
        sub:c.incident_id||'', ts:c.received_at||c.issued_at};
    });
    return a.concat(b);
  }

  React.useEffect(function() {
    if (!playing) return undefined;
    var sess = (sessIdx !== null && sessIdx >= 0) ? sessions[sessIdx] : null;
    var total = dtSteps(sess).length;
    if (step >= total - 1) { setPlaying(false); return undefined; }
    var id = setTimeout(function() { setStep(function(s) { return s + 1; }); }, 1400);
    return function() { clearTimeout(id); };
  }, [playing, step, sessIdx, sessions]);

  React.useEffect(function() {
    function load() {
      Promise.all([
        fetch('/api/8020/status'),
        fetch('/api/8020/incidents'),
        fetch('/api/8020/commands')
      ]).then(function(res) {
        var p1 = res[0].ok ? res[0].json() : Promise.resolve(null);
        var p2 = res[1].ok ? res[1].json() : Promise.resolve(null);
        var p3 = res[2].ok ? res[2].json() : Promise.resolve(null);
        return Promise.all([p1, p2, p3]);
      }).then(function(data) {
        if (data[0]) setStatus(data[0]);
        if (data[1]) { var d = data[1]; setIncidents(Array.isArray(d) ? d : (d.incidents || [])); }
        if (data[2]) { var d2 = data[2]; setCommands(Array.isArray(d2) ? d2 : (d2.commands || [])); }
        setLastSync(Date.now());
        setLoading(false);
      }).catch(function(e) { console.error(e); setLoading(false); });
    }
    load();
    var id = setInterval(load, 10000);
    return function() { clearInterval(id); };
  }, []);

  // Collect all static agent IDs across all buildings (used to detect dynamic ones)
  var ALL_STATIC_AGENT_IDS_DT = [];
  BUILDINGS_DT.forEach(function(b) {
    b.agents.forEach(function(id) { ALL_STATIC_AGENT_IDS_DT.push(id); });
  });

  // Dynamic EP agents: ndr/edr MAC agents not in any building's static list
  var dynamicAgentsDT = [];
  if (status && status.agent_health) {
    var dynAhKeys = Object.keys(status.agent_health);
    for (var dyni = 0; dyni < dynAhKeys.length; dyni++) {
      var dynId = dynAhKeys[dyni];
      var isDynNdr = dynId.indexOf('ndr-agent-') === 0 && dynId !== 'ndr-agent-01';
      var isDynEdr = dynId.indexOf('edr-agent-') === 0 && dynId !== 'edr-agent-01';
      if ((isDynNdr || isDynEdr) && ALL_STATIC_AGENT_IDS_DT.indexOf(dynId) === -1) {
        dynamicAgentsDT.push(dynId);
      }
    }
  }

  // agentHealth uses BUILDINGS_DT.agents + dynamic EP agents under building_a
  var agentHealth = React.useMemo(function() {
    var staticIds = [];
    BUILDINGS_DT.forEach(function(b) { b.agents.forEach(function(id) { staticIds.push(id); }); });
    var dynAgents = [];
    if (status && status.agent_health) {
      var ahDynKeys2 = Object.keys(status.agent_health);
      for (var ddi2 = 0; ddi2 < ahDynKeys2.length; ddi2++) {
        var ddId2 = ahDynKeys2[ddi2];
        var isN2 = ddId2.indexOf('ndr-agent-') === 0 && ddId2 !== 'ndr-agent-01';
        var isE2 = ddId2.indexOf('edr-agent-') === 0 && ddId2 !== 'edr-agent-01';
        if ((isN2 || isE2) && staticIds.indexOf(ddId2) === -1) { dynAgents.push(ddId2); }
      }
    }
    var map = {};
    BUILDINGS_DT.forEach(function(b) {
      var healthy = 0;
      var total = b.agents.length;
      b.agents.forEach(function(agId) {
        var h = status && status.agent_health ? status.agent_health[agId] : null;
        if (h && h.healthy) healthy++;
      });
      if (b.id === 'building_a') {
        dynAgents.forEach(function(dynId2) {
          total++;
          var dh = status && status.agent_health ? status.agent_health[dynId2] : null;
          if (dh && dh.healthy) healthy++;
        });
      }
      map[b.id] = {healthy: healthy, total: total};
    });
    return map;
  }, [status]);

  // Header stats derived from agentHealth (includes dynamic EP agents in building_a total)
  var agentsTotal = 0;
  var agentsHealthy = 0;
  BUILDINGS_DT.forEach(function(b) {
    agentsTotal += agentHealth[b.id] ? agentHealth[b.id].total : b.agents.length;
    agentsHealthy += agentHealth[b.id] ? agentHealth[b.id].healthy : 0;
  });

  var HQ_AGENTS_DT = ['analytical-agent-01','orchestrator-agent-01','learning-agent-01','threat-intel-agent-01','forensic-agent-hq-01','central-manager-01'];
  var nonHqHealthy = false;
  if (status && status.agent_health) {
    var ahKeysDT = Object.keys(status.agent_health);
    for (var nhiDT = 0; nhiDT < ahKeysDT.length; nhiDT++) {
      if (HQ_AGENTS_DT.indexOf(ahKeysDT[nhiDT]) === -1) {
        var nhEntryDT = status.agent_health[ahKeysDT[nhiDT]];
        if (nhEntryDT && nhEntryDT.healthy) { nonHqHealthy = true; break; }
      }
    }
  }

  var buildingStats = React.useMemo(function() {
    var map = {};
    BUILDINGS_DT.forEach(function(b) { map[b.id] = {total:0, critical:0, high:0, types:[], hosts:[]}; });
    incidents.forEach(function(inc) {
      var srcIp = inc.details && inc.details.src_ip ? inc.details.src_ip : '';
      var host = inc.host_id || srcIp;
      var bid = getHostBuilding(host);
      if (bid && map[bid]) {
        map[bid].total++;
        var sv = (inc.severity || '').toLowerCase();
        if (sv === 'critical') map[bid].critical++;
        if (sv === 'high') map[bid].high++;
        if (inc.alert_type && map[bid].types.indexOf(inc.alert_type) === -1) map[bid].types.push(inc.alert_type);
        if (host && map[bid].hosts.indexOf(host) === -1) map[bid].hosts.push(host);
      }
    });
    return map;
  }, [incidents]);

  // Fix 5: filter agent_down from all incident displays
  var secIncidents = incidents.filter(function(inc) {
    return inc.alert_type !== 'agent_down' && inc.alert_type !== 'agent_offline';
  });

  function getThreat(bid) {
    var s = buildingStats[bid];
    if (!s || s.total === 0) return 'safe';
    if (s.critical > 0) return 'critical';
    if (s.high > 0) return 'high';
    return 'medium';
  }

  var threatColorMap = {safe:'#44bb44', medium:'#ffcc00', high:'#ff8c00', critical:'#ff4444'};
  var sevColor       = {critical:'#ff4444', high:'#ff8c00', medium:'#ffcc00', low:'#44bb44'};

  // Fix 4: read from corrected BUILDINGS_DT
  var selectedBuilding = null;
  for (var bi = 0; bi < BUILDINGS_DT.length; bi++) {
    if (BUILDINGS_DT[bi].id === selected) { selectedBuilding = BUILDINGS_DT[bi]; break; }
  }

  var selectedIncs = React.useMemo(function() {
    if (!selected) return [];
    return incidents.filter(function(inc) {
      if (inc.alert_type === 'agent_down' || inc.alert_type === 'agent_offline') return false;
      var srcIp = inc.details && inc.details.src_ip ? inc.details.src_ip : '';
      return getHostBuilding(inc.host_id || srcIp) === selected;
    }).slice(0, 20);
  }, [incidents, selected]);

  var totalIncidents = status && status.incidents ? status.incidents.total : secIncidents.length;
  var totalCritical  = status && status.incidents ? status.incidents.critical : 0;
  var threatLevel    = status ? status.threat_level : '—';
  var soarCmds       = status ? status.commands_issued : 0;

  // Fix 3a: SVG positions — SR at cy=85, HQ at cy=230, gap between edges = 230-85-80 = 65px
  var SVG_POS = {
    hq:          {cx:360, cy:230},
    server_room: {cx:360, cy:85},
    building_a:  {cx:95,  cy:165},
    building_b:  {cx:625, cy:165},
    building_c:  {cx:530, cy:320}
  };

  if (loading) return (
    <div style={{padding:60, textAlign:'center', color:'var(--ink-3)'}}>Loading digital twin...</div>
  );

  return (
    <div style={{paddingBottom:60}}>
      <style>{'@keyframes dt-pulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes dt-flow{0%{stroke-dashoffset:20}100%{stroke-dashoffset:0}}.dt-bnode{cursor:pointer;transition:filter .2s}.dt-bnode:hover{filter:brightness(1.25)}.dt-tab-btn:hover{background:var(--surface-2)!important}.dt-irow:hover td{background:rgba(255,255,255,.02)}'}</style>

      {/* Header */}
      <div style={{padding:'20px 26px 14px', borderBottom:'1px solid var(--line)'}}>
        <div className="mono tiny" style={{color:'var(--cyan)', letterSpacing:3, marginBottom:4}}>SYSTEM · LIVE REPLICA</div>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <h2 style={{margin:0, fontSize:22, fontWeight:700, color:'var(--ink)'}}>Digital Twin</h2>
          <span style={{display:'flex', alignItems:'center', gap:5, fontSize:9, color:'#44ee88', letterSpacing:2}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'#44ee88', display:'inline-block', animation:'dt-pulse 2s infinite'}}/>LIVE
          </span>
        </div>
        <div className="mono tiny" style={{color:'var(--ink-3)', marginTop:4}}>
          {'Galala University Smart Campus \xB7 ' + BUILDINGS_DT.length + ' buildings \xB7 ' + secIncidents.length + ' incidents \xB7 refresh 10s' + (lastSync ? ' \xB7 synced ' + dtFmtTime(lastSync) : '')}
        </div>
      </div>

      {/* Fix 6: header stat strip — all from agentHealth (BUILDINGS_DT-based total) */}
      <div style={{display:'flex', gap:10, padding:'12px 26px', borderBottom:'1px solid var(--line)', flexWrap:'wrap'}}>
        {[
          {l:'Threat',    v:threatLevel,                        c:'#ff4444'},
          {l:'Agents',    v:agentsHealthy + '/' + agentsTotal,  c:'#888'},
          {l:'Incidents', v:totalIncidents,                     c:'#ff8c00'},
          {l:'Critical',  v:totalCritical,                      c:'#ff4444'},
          {l:'SOAR Cmds', v:soarCmds,                           c:'var(--cyan)'}
        ].map(function(x) {
          return (
            <div key={x.l} style={{background:'var(--surface-2)', border:'1px solid var(--line)', borderRadius:6, padding:'7px 14px', minWidth:90}}>
              <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:2}}>{x.l}</div>
              <div style={{fontSize:18, fontWeight:700, color:x.c, lineHeight:1}}>{x.v}</div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div style={{display:'flex', gap:4, padding:'10px 26px 0', borderBottom:'1px solid var(--line)'}}>
        {[{id:'map',label:'Campus Map'},{id:'agents',label:'Agents'},{id:'vlans',label:'VLANs'},{id:'incidents',label:'Incidents'},{id:'replay',label:'Replay'}].map(function(t) {
          var act = tab === t.id;
          return (
            <button key={t.id} className="dt-tab-btn" onClick={function(){setTab(t.id);}} style={{
              background: act ? 'rgba(0,212,255,.1)' : 'transparent',
              border: act ? '1px solid rgba(0,212,255,.3)' : '1px solid transparent',
              borderBottom:'none', borderRadius:'6px 6px 0 0',
              color: act ? 'var(--cyan)' : 'var(--ink-3)',
              padding:'8px 16px', fontSize:11, fontFamily:'var(--font-mono)', cursor:'pointer'
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* ── MAP TAB ── */}
      {tab === 'map' && (
        <div style={{padding:'20px 26px'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:16}}>

            {/* SVG topology */}
            <div style={{background:'var(--surface-1)', border:'1px solid var(--line)', borderRadius:10, overflow:'hidden'}}>
              <svg width="100%" viewBox="0 0 720 400" style={{display:'block'}}>
                <defs>
                  <pattern id="dtgrid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M30 0L0 0 0 30" fill="none" stroke="rgba(255,255,255,.03)" strokeWidth="1"/>
                  </pattern>
                </defs>
                <rect width="720" height="400" fill="url(#dtgrid)"/>

                {/* Internet */}
                <ellipse cx="360" cy="22" rx="70" ry="16" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.08)" strokeWidth="1"/>
                <text x="360" y="26" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,.3)">Internet / ISP</text>
                <line x1="360" y1="38" x2="360" y2="45" stroke="rgba(255,255,255,.08)" strokeWidth="1" strokeDasharray="4,3"/>

                {/* Fix 3a: SR cy=85, HQ cy=230 — 65px gap between circle edges */}
                {/* Fiber: SR ↔ HQ */}
                <line x1="360" y1="125" x2="360" y2="190"
                  stroke="rgba(0,212,255,.35)" strokeWidth="2" strokeDasharray="6,4"
                  style={{animation:'dt-flow 1.2s linear infinite'}}/>
                <text x="374" y="160" fontSize="8" fill="rgba(255,255,255,.25)">10 Gbps</text>

                {/* HQ → Building A */}
                <line x1="310" y1="218" x2="135" y2="185"
                  stroke="rgba(0,212,255,.18)" strokeWidth="1.5" strokeDasharray="6,4"
                  style={{animation:'dt-flow 1.2s linear infinite'}}/>
                {/* HQ → Building B */}
                <line x1="410" y1="218" x2="585" y2="185"
                  stroke="rgba(0,212,255,.18)" strokeWidth="1.5" strokeDasharray="6,4"
                  style={{animation:'dt-flow 1.2s linear infinite'}}/>
                {/* HQ → Building C */}
                <line x1="388" y1="265" x2="495" y2="295"
                  stroke="rgba(0,212,255,.1)" strokeWidth="1" strokeDasharray="4,6"/>

                {/* Kafka: SR → A and SR → B */}
                <line x1="322" y1="96" x2="135" y2="148" stroke="rgba(0,212,255,.07)" strokeWidth="1" strokeDasharray="2,4"/>
                <line x1="398" y1="96" x2="585" y2="148" stroke="rgba(0,212,255,.07)" strokeWidth="1" strokeDasharray="2,4"/>

                {/* Building nodes */}
                {BUILDINGS_DT.map(function(b) {
                  var pos = SVG_POS[b.id];
                  if (!pos) return null;
                  var threat = getThreat(b.id);
                  var stats = buildingStats[b.id];
                  var ah = agentHealth[b.id];
                  var isSel = selected === b.id;
                  var isPassiveNode = ah && ah.total === 0 && b.id !== 'server_room';
                  var tc = isPassiveNode ? '#555566' : threatColorMap[threat];
                  var displayThreat = isPassiveNode ? 'NONE' : threat.toUpperCase();
                  return (
                    <g key={b.id} className="dt-bnode" onClick={function(){setSelected(isSel ? null : b.id);}}
                      transform={'translate(' + pos.cx + ',' + pos.cy + ')'}>
                      {threat === 'critical' && (
                        <circle r="50" fill="none" stroke={tc} strokeWidth="1" opacity="0.25"
                          style={{animation:'dt-pulse 2s infinite'}}/>
                      )}
                      <circle r="40" fill={isSel ? 'rgba(0,212,255,.1)' : 'rgba(10,14,22,.9)'}
                        stroke={isSel ? '#00d4ff' : tc} strokeWidth={isSel ? 2 : 1.5}/>
                      <text textAnchor="middle" dominantBaseline="middle" fontSize="18" y="-7">{b.icon}</text>
                      {stats && stats.total > 0 && (
                        <g transform="translate(26,-26)">
                          <circle r="12" fill={tc}/>
                          <text textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="white">{stats.total}</text>
                        </g>
                      )}
                      <text textAnchor="middle" fontSize="7" fontWeight="700" fill={tc} y="9">{displayThreat}</text>
                      {/* Fix 3c: real counts from agentHealth */}
                      {ah && ah.total > 0 && (
                        <text textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.4)" y="20">
                          {ah.healthy}/{ah.total} agents
                        </text>
                      )}
                      {ah && ah.total === 0 && (
                        <text textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.2)" y="20">passive</text>
                      )}
                      <text textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(255,255,255,.85)" y="54">{b.label}</text>
                      <text textAnchor="middle" fontSize="7" fill="rgba(255,255,255,.3)" y="65">{b.ip}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Detail card — Fix 4: reads corrected BUILDINGS_DT */}
            <div>
              {!selectedBuilding ? (
                <div style={{background:'var(--surface-1)', border:'1px solid var(--line)', borderRadius:8, padding:20, display:'flex', alignItems:'center', justifyContent:'center', minHeight:300}}>
                  <div style={{textAlign:'center', color:'var(--ink-3)'}}>
                    <div style={{fontSize:28, marginBottom:8}}>🏛</div>
                    <div className="mono tiny">Click any building on the map</div>
                  </div>
                </div>
              ) : (
                <div style={{background:'var(--surface-1)', border:'1px solid var(--line)', borderRadius:8, overflow:'hidden'}}>
                  <div style={{padding:'12px 14px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:10}}>
                    <span style={{fontSize:18}}>{selectedBuilding.icon}</span>
                    <div>
                      <div style={{fontSize:13, fontWeight:700, color:selectedBuilding.color}}>{selectedBuilding.label}</div>
                      <div className="mono tiny" style={{color:'var(--ink-3)'}}>{selectedBuilding.role}</div>
                    </div>
                    <button onClick={function(){setSelected(null);}} style={{marginLeft:'auto', background:'none', border:'1px solid var(--line)', borderRadius:4, color:'var(--ink-3)', padding:'2px 8px', fontSize:10, fontFamily:'var(--font-mono)', cursor:'pointer'}}>✕</button>
                  </div>
                  <div style={{padding:14, display:'flex', flexDirection:'column', gap:12}}>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
                      {[
                        {l:'IP',       v:selectedBuilding.ip},
                        {l:'Subnet',   v:selectedBuilding.subnet},
                        {l:'Incidents',v:(buildingStats[selectedBuilding.id]||{}).total||0},
                        {l:'Critical', v:(buildingStats[selectedBuilding.id]||{}).critical||0},
                        {l:'Agents',   v:((agentHealth[selectedBuilding.id]||{}).healthy||0) + '/' + ((agentHealth[selectedBuilding.id]||{}).total||0)},
                        {l:'Threat',   v:getThreat(selectedBuilding.id).toUpperCase()}
                      ].map(function(x) {
                        return (
                          <div key={x.l} style={{background:'var(--surface-2)', borderRadius:5, padding:'6px 10px'}}>
                            <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:2}}>{x.l}</div>
                            <div className="mono" style={{fontSize:11, color:'var(--ink)'}}>{x.v}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div>
                      <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:6, letterSpacing:2}}>VLANS</div>
                      <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                        {selectedBuilding.vlans.map(function(v) {
                          return <span key={v} style={{display:'inline-block', background:'rgba(0,212,255,.08)', border:'1px solid rgba(0,212,255,.2)', borderRadius:3, padding:'2px 6px', fontSize:9, color:'var(--cyan)'}}>{v}</span>;
                        })}
                      </div>
                    </div>
                    <div>
                      {selectedBuilding.id === 'server_room' ? (
                        <div>
                          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:6, letterSpacing:2}}>INFRASTRUCTURE SERVICES</div>
                          {selectedBuilding.infra_services && selectedBuilding.infra_services.map(function(svc) {
                            return (
                              <div key={svc.ip} style={{display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid var(--line)'}}>
                                <div style={{width:6, height:6, borderRadius:'50%', background:nonHqHealthy ? '#44ee88' : '#888888', flexShrink:0}}/>
                                <div style={{flex:1}}>
                                  <div className="mono" style={{fontSize:10, color:'var(--ink)'}}>{svc.name}</div>
                                  <div className="mono tiny" style={{color:'var(--cyan)'}}>{svc.ip}</div>
                                </div>
                                <div className="mono tiny" style={{color:'var(--ink-3)'}}>{svc.role}</div>
                                <div className="mono tiny" style={{marginLeft:8, fontWeight:700, color:nonHqHealthy ? '#44ee88' : 'var(--ink-4)'}}>{nonHqHealthy ? 'RUNNING' : 'UNKNOWN'}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div>
                          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:6, letterSpacing:2}}>
                            {'AGENTS (' + selectedBuilding.agents.length + ')'}
                          </div>
                          {selectedBuilding.agents.length === 0 ? (
                            <div className="mono tiny" style={{color:'var(--ink-3)'}}>No agents deployed at this site.</div>
                          ) : selectedBuilding.agents.map(function(agId) {
                            var h = status && status.agent_health ? status.agent_health[agId] : null;
                            var alive = h && h.healthy;
                            var lastSec = h ? h.last_seen_ago_sec : null;
                            return (
                              <div key={agId} style={{display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid var(--line)'}}>
                                <div style={{width:6, height:6, borderRadius:'50%', background:alive ? '#44ee88' : '#ff4444', flexShrink:0}}/>
                                <div className="mono" style={{fontSize:10, color:alive ? 'var(--ink)' : 'var(--ink-3)'}}>{agId}</div>
                                <div className="mono tiny" style={{marginLeft:'auto', color:'var(--ink-3)'}}>
                                  {alive ? 'UP' : lastSec ? Math.floor(lastSec) + 's ago' : 'offline'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {buildingStats[selectedBuilding.id] && buildingStats[selectedBuilding.id].types.length > 0 && (
                      <div>
                        <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:6, letterSpacing:2}}>ATTACK TYPES</div>
                        {buildingStats[selectedBuilding.id].types.map(function(t) {
                          return (
                            <div key={t} style={{display:'flex', alignItems:'center', gap:6, padding:'3px 0'}}>
                              <div style={{width:5, height:5, borderRadius:'50%', background:'#ff4444'}}/>
                              <div style={{fontSize:10, color:'#ff8c44'}}>{dtFmt(t)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedIncs.length > 0 ? (
                      <div>
                        <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:6, letterSpacing:2}}>RECENT INCIDENTS ({selectedIncs.length})</div>
                        {selectedIncs.slice(0, 5).map(function(inc) {
                          var s = (inc.severity || '').toLowerCase();
                          var c = sevColor[s] || '#888';
                          var srcIp = inc.details && inc.details.src_ip ? inc.details.src_ip : '—';
                          var host = inc.host_id || srcIp;
                          return (
                            <div key={inc.incident_id} style={{padding:'5px 0', borderBottom:'1px solid var(--line)'}}>
                              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                                <span style={{fontSize:8, fontWeight:700, color:c, textTransform:'uppercase'}}>{s}</span>
                                <span className="mono" style={{fontSize:9, color:'var(--ink-3)'}}>{inc.incident_id}</span>
                                <span className="mono tiny" style={{marginLeft:'auto', color:'var(--ink-3)'}}>{dtFmtTime(inc.created_at)}</span>
                              </div>
                              <div style={{fontSize:10, color:'var(--ink-2)'}}>{dtFmt(inc.alert_type)}: {host}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{fontSize:11, color:'var(--ink-3)'}}>
                        No active security incidents. Agent status shown in topology below.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AGENTS TAB ── */}
      {tab === 'agents' && (
        <div style={{padding:'20px 26px'}}>
          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:16, letterSpacing:2}}>
            {'ALL AGENTS \xB7 ' + agentsHealthy + '/' + agentsTotal + ' HEALTHY \xB7 SOURCE: /api/8020/status'}
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16}}>
            {BUILDINGS_DT.map(function(b) {
              return (
                <div key={b.id}>
                  <div className="mono tiny" style={{color:b.color, letterSpacing:2, marginBottom:8, paddingBottom:4, borderBottom:'1px solid var(--line)'}}>
                    {b.icon + ' ' + b.label.toUpperCase()}
                  </div>
                  {b.agents.length === 0 ? (
                    b.id === 'server_room' ? (
                      b.infra_services && b.infra_services.map(function(svc) {
                        return (
                          <div key={svc.ip} style={{display:'flex', alignItems:'center', gap:10, padding:'9px 12px', marginBottom:6, borderRadius:6,
                            background:nonHqHealthy ? 'rgba(68,187,68,.06)' : 'rgba(100,100,100,.06)', border:'1px solid ' + (nonHqHealthy ? 'rgba(68,187,68,.2)' : 'rgba(100,100,100,.15)')}}>
                            <div style={{width:8, height:8, borderRadius:'50%', background:nonHqHealthy ? '#44ee88' : '#888888', flexShrink:0}}/>
                            <div style={{flex:1}}>
                              <div className="mono" style={{fontSize:11, color:'var(--ink)'}}>{svc.name}</div>
                              <div className="mono tiny" style={{color:'var(--cyan)', marginTop:2}}>{svc.ip} · {svc.role}</div>
                            </div>
                            <div className="mono tiny" style={{fontWeight:700, color:nonHqHealthy ? '#44ee88' : 'var(--ink-4)'}}>{nonHqHealthy ? 'RUNNING' : 'UNKNOWN'}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="mono tiny" style={{color:'var(--ink-3)', padding:'8px 0'}}>No agents deployed.</div>
                    )
                  ) : (
                    <div>
                      {b.agents.map(function(agId) {
                        var h = status && status.agent_health ? status.agent_health[agId] : null;
                        var alive = h && h.healthy;
                        var lastSec = h ? h.last_seen_ago_sec : null;
                        return (
                          <div key={agId} style={{display:'flex', alignItems:'center', gap:10, padding:'9px 12px', marginBottom:6, borderRadius:6,
                            background: alive ? 'rgba(68,187,68,.06)' : 'rgba(255,68,68,.06)',
                            border: '1px solid ' + (alive ? 'rgba(68,187,68,.2)' : 'rgba(255,68,68,.15)')}}>
                            <div style={{width:8, height:8, borderRadius:'50%', background:alive ? '#44ee88' : '#ff4444', flexShrink:0, animation:alive ? 'dt-pulse 2s infinite' : 'none'}}/>
                            <div style={{flex:1}}>
                              <div className="mono" style={{fontSize:11, color:alive ? 'var(--ink)' : 'var(--ink-3)'}}>{agId}</div>
                              <div className="mono tiny" style={{color:'var(--ink-3)', marginTop:2}}>
                                {alive ? 'healthy' : lastSec ? 'last seen ' + Math.floor(lastSec) + 's ago' : 'never connected'}
                              </div>
                            </div>
                            <div className="mono tiny" style={{fontWeight:700, color:alive ? '#44ee88' : '#ff4444'}}>{alive ? 'UP' : 'DOWN'}</div>
                          </div>
                        );
                      })}
                      {b.id === 'building_a' && dynamicAgentsDT.length > 0 ? (
                        <div>
                          <div className="mono tiny" style={{color:'var(--cyan)', letterSpacing:2, margin:'10px 0 6px', opacity:0.7}}>ENDPOINTS (DYNAMIC)</div>
                          {dynamicAgentsDT.map(function(dynId) {
                            var dh = status && status.agent_health ? status.agent_health[dynId] : null;
                            var dalive = dh && dh.healthy;
                            var dlastSec = dh ? dh.last_seen_ago_sec : null;
                            var shortId = dynId.slice(-5);
                            return (
                              <div key={dynId} style={{display:'flex', alignItems:'center', gap:10, padding:'9px 12px', marginBottom:6, borderRadius:6,
                                background: dalive ? 'rgba(68,187,68,.06)' : 'rgba(255,68,68,.06)',
                                border: '1px solid ' + (dalive ? 'rgba(68,187,68,.2)' : 'rgba(255,68,68,.15)')}}>
                                <div style={{width:8, height:8, borderRadius:'50%', background:dalive ? '#44ee88' : '#ff4444', flexShrink:0, animation:dalive ? 'dt-pulse 2s infinite' : 'none'}}/>
                                <div style={{flex:1}}>
                                  <div className="mono" style={{fontSize:11, color:dalive ? 'var(--ink)' : 'var(--ink-3)'}}>{dynId.split('-').slice(0,2).join('-').toUpperCase()} <span style={{opacity:0.6}}>·{shortId}</span></div>
                                  <div className="mono tiny" style={{color:'var(--ink-3)', marginTop:2}}>
                                    {dalive ? 'healthy' : dlastSec ? 'last seen ' + Math.floor(dlastSec) + 's ago' : 'never connected'}
                                  </div>
                                </div>
                                <div className="mono tiny" style={{fontWeight:700, color:dalive ? '#44ee88' : '#ff4444'}}>{dalive ? 'UP' : 'DOWN'}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── VLANS TAB ── */}
      {tab === 'vlans' && (
        <div style={{padding:'20px 26px', overflowX:'auto'}}>
          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:14, letterSpacing:2}}>
            {'NETWORK SEGMENTATION \xB7 ' + VLANS_DT.length + ' VLANS \xB7 FROM SMART CAMPUS NETWORK DESIGN DOCUMENT'}
          </div>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr>
                {['VLAN ID','Name','Building','Subnet','Purpose'].map(function(h) {
                  return <th key={h} style={{padding:'9px 14px', textAlign:'left', fontSize:9, letterSpacing:2, textTransform:'uppercase', color:'var(--ink-3)', borderBottom:'1px solid var(--line)'}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {VLANS_DT.map(function(v) {
                return (
                  <tr key={v.id} style={{borderBottom:'1px solid var(--line)'}}>
                    <td style={{padding:'9px 14px', fontFamily:'var(--font-mono)', color:'var(--cyan)', fontWeight:700}}>VLAN {v.id}</td>
                    <td style={{padding:'9px 14px', fontSize:11}}>{v.name}</td>
                    <td style={{padding:'9px 14px', fontSize:11, color:'var(--ink-2)'}}>{v.building}</td>
                    <td style={{padding:'9px 14px', fontFamily:'var(--font-mono)', fontSize:10, color:'#ffaa44'}}>{v.subnet}</td>
                    <td style={{padding:'9px 14px', fontSize:10, color:'var(--ink-3)'}}>{v.purpose}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── INCIDENTS TAB — Fix 5: filter agent_down ── */}
      {tab === 'incidents' && (
        <div style={{padding:'20px 26px', overflowX:'auto'}}>
          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:14, letterSpacing:2}}>
            {'LIVE INCIDENTS \xB7 ' + secIncidents.length + ' LOADED \xB7 /api/8020/incidents \xB7 AUTO-REFRESH 10s'}
          </div>
          {secIncidents.length === 0 ? (
            <div style={{fontSize:12, color:'var(--ink-3)', textAlign:'center', padding:'32px 0'}}>
              No active security incidents. Agent status shown in topology below.
            </div>
          ) : (
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Severity','ID','Type','Host','MITRE','Domain','Time'].map(function(h) {
                    return <th key={h} style={{padding:'9px 14px', textAlign:'left', fontSize:9, letterSpacing:2, textTransform:'uppercase', color:'var(--ink-3)', borderBottom:'1px solid var(--line)'}}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {secIncidents.slice(0, 50).map(function(inc) {
                  var s = (inc.severity || 'low').toLowerCase();
                  var c = sevColor[s] || '#888';
                  var srcIp = inc.details && inc.details.src_ip ? inc.details.src_ip : '—';
                  var host = inc.host_id || srcIp;
                  var mitre = inc.details && inc.details.mitre_technique ? inc.details.mitre_technique : '—';
                  return (
                    <tr key={inc.incident_id} className="dt-irow" style={{borderBottom:'1px solid var(--line)'}}>
                      <td style={{padding:'8px 14px'}}>
                        <span style={{display:'inline-block', padding:'2px 6px', borderRadius:3, fontSize:9, fontWeight:700, textTransform:'uppercase', color:c, border:'1px solid ' + c + '44', background:c + '11'}}>{s}</span>
                      </td>
                      <td className="mono" style={{padding:'8px 14px', fontSize:10, color:'var(--ink-3)'}}>{inc.incident_id}</td>
                      <td style={{padding:'8px 14px', fontSize:11}}>{dtFmt(inc.alert_type || '')}</td>
                      <td className="mono" style={{padding:'8px 14px', fontSize:11}}>{host}</td>
                      <td className="mono" style={{padding:'8px 14px', fontSize:10, color:'#ff8c44'}}>{mitre}</td>
                      <td style={{padding:'8px 14px', fontSize:10, color:'var(--ink-3)'}}>{inc.network_domain || '—'}</td>
                      <td className="mono" style={{padding:'8px 14px', fontSize:10, color:'var(--ink-3)', whiteSpace:'nowrap'}}>{dtFmtTime(inc.created_at)}</td>
                    </tr>
                  );
                })}
                {secIncidents.length > 50 && (
                  <tr><td colSpan="7" style={{padding:'12px 14px', fontSize:10, color:'var(--ink-3)', textAlign:'center'}}>
                    {'Showing 50 of ' + secIncidents.length + '. Use Incidents page for full list.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── REPLAY TAB ── */}
      {tab === 'replay' && (
        <div style={{padding:'20px 26px'}}>
          <div style={{background:'rgba(0,212,255,.06)', border:'1px solid rgba(0,212,255,.2)', borderRadius:10, padding:14, marginBottom:16, fontSize:13, color:'var(--ink-2)'}}>
            <strong style={{color:'var(--cyan)'}}>What is this?</strong> Capture the live attack state into a session, then replay the kill chain step-by-step. Real recorded incidents and SOAR actions.
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
            <div style={{background:'var(--surface)', border:'1px solid var(--line)', borderRadius:12, padding:16}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                <span className="mono" style={{fontSize:11, color:'var(--ink-3)', letterSpacing:2}}>RECORDED SESSIONS</span>
                <button onClick={dtCapture} style={{background:'rgba(0,212,255,.12)', border:'1px solid rgba(0,212,255,.4)', color:'var(--cyan)', borderRadius:6, padding:'6px 12px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>Capture Now</button>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {sessions.length === 0 && (
                  <div style={{color:'var(--ink-3)', fontSize:12, padding:10}}>No sessions yet. Capture the current state to freeze the kill chain.</div>
                )}
                {sessions.map(function(s, i) {
                  var col = s.threat === 'CRITICAL' ? '#ff4444' : s.threat === 'HIGH' ? '#ff8c00' : s.threat === 'MEDIUM' ? '#ffcc00' : '#44bb44';
                  var active = i === sessIdx;
                  return (
                    <div key={s.id} onClick={function(){setSessIdx(i); setStep(0); setPlaying(false);}}
                      style={{padding:'10px 12px', borderRadius:8, cursor:'pointer',
                        border:'1px solid ' + (active ? 'var(--cyan)' : 'var(--line)'),
                        background:active ? 'rgba(0,212,255,.08)' : 'var(--bg-2)'}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <strong style={{fontSize:13}}>{s.name}</strong>
                        <span style={{fontSize:9, fontWeight:700, color:col, border:'1px solid ' + col + '55', borderRadius:3, padding:'2px 6px'}}>{s.threat}</span>
                      </div>
                      <div style={{fontSize:11, color:'var(--ink-3)', marginTop:4}}>
                        {s.incidents.length + ' incidents \xB7 ' + s.commands.length + ' SOAR cmds \xB7 ' + s.at.substring(11, 19)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{background:'var(--surface)', border:'1px solid var(--line)', borderRadius:12, padding:16}}>
              <span className="mono" style={{fontSize:11, color:'var(--ink-3)', letterSpacing:2}}>REPLAY CONTROLS</span>
              {(function() {
                var sess = (sessIdx !== null && sessIdx >= 0) ? sessions[sessIdx] : null;
                var steps = dtSteps(sess);
                var total = steps.length;
                var scMap = {critical:'#ff4444', high:'#ff8c00', medium:'#ffcc00', low:'#44bb44', info:'var(--cyan)'};
                return (
                  <div>
                    <div style={{display:'flex', gap:8, alignItems:'center', margin:'12px 0'}}>
                      <button onClick={function(){setStep(Math.max(0, step - 1)); setPlaying(false);}} style={{background:'var(--bg-2)', border:'1px solid var(--line)', color:'var(--ink-2)', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontFamily:'inherit', fontSize:12}}>Prev</button>
                      <button onClick={function(){setPlaying(!playing);}} style={{background:'rgba(0,212,255,.12)', border:'1px solid rgba(0,212,255,.4)', color:'var(--cyan)', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontFamily:'inherit', fontSize:12}}>{playing ? 'Pause' : 'Play'}</button>
                      <button onClick={function(){setStep(Math.min(total - 1, step + 1)); setPlaying(false);}} style={{background:'var(--bg-2)', border:'1px solid var(--line)', color:'var(--ink-2)', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontFamily:'inherit', fontSize:12}}>Next</button>
                      <span className="mono" style={{marginLeft:'auto', fontSize:11, color:'var(--ink-3)'}}>{total ? step + 1 : 0}/{total}</span>
                    </div>
                    <input type="range" min="0" max={Math.max(0, total - 1)} value={step}
                      onChange={function(e){setStep(parseInt(e.target.value, 10) || 0); setPlaying(false);}}
                      style={{width:'100%', accentColor:'var(--cyan)'}}/>
                    <div style={{height:1, background:'var(--line)', margin:'14px 0'}}/>
                    <div className="mono" style={{fontSize:11, color:'var(--cyan)', letterSpacing:2, marginBottom:8}}>ATTACK KILL CHAIN</div>
                    <div style={{display:'flex', flexDirection:'column', gap:6, maxHeight:240, overflowY:'auto'}}>
                      {total === 0 && <div style={{color:'var(--ink-3)', fontSize:12, padding:10}}>Capture a session, then press Play.</div>}
                      {steps.map(function(st, i) {
                        var col = scMap[st.sev] || 'var(--cyan)';
                        var now = i === step;
                        return (
                          <div key={i} onClick={function(){setStep(i); setPlaying(false);}}
                            style={{display:'flex', gap:10, alignItems:'flex-start', padding:'8px 10px', borderRadius:8, cursor:'pointer',
                              borderLeft:'3px solid ' + col, background:now ? col + '22' : 'var(--bg-2)'}}>
                            <span style={{width:7, height:7, borderRadius:99, background:col, marginTop:4, flexShrink:0}}/>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12, color:'var(--ink)'}}>
                                <span className="mono" style={{color:col, fontSize:10}}>[{st.sev.toUpperCase()}]</span> {st.text}
                              </div>
                              <div style={{fontSize:10, color:'var(--ink-3)', marginTop:2}}>
                                {st.sub}{st.ts ? ' \xB7 ' + new Date(st.ts).toLocaleTimeString() : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <div style={{background:'var(--surface)', border:'1px solid var(--line)', borderRadius:12, padding:16, marginTop:16}}>
            <div className="mono" style={{fontSize:11, color:'var(--ink-3)', letterSpacing:2, marginBottom:10}}>SESSION COMPARISON · incidents (cyan) vs SOAR cmds (violet)</div>
            {sessions.length === 0 ? (
              <div style={{color:'var(--ink-3)', fontSize:12, padding:'20px 0', textAlign:'center'}}>No sessions captured yet.</div>
            ) : (function() {
              var W = 720, H = 180, P = 28;
              var maxV = Math.max(1, Math.max.apply(null, sessions.map(function(s) { return Math.max(s.incidents.length, s.commands.length); })));
              var slot = (W - 2 * P) / sessions.length;
              var bw = Math.min(24, slot / 3);
              return (
                <svg viewBox={'0 0 ' + W + ' ' + H} style={{width:'100%', height:H}}>
                  {sessions.map(function(s, i) {
                    var cx = P + i * slot + slot / 2;
                    var ih = (s.incidents.length / maxV) * (H - 2 * P);
                    var ch = (s.commands.length / maxV) * (H - 2 * P);
                    return (
                      <g key={s.id}>
                        <rect x={cx - bw - 3} y={H - P - ih} width={bw} height={ih} rx="3" fill="var(--cyan)"/>
                        <rect x={cx + 3} y={H - P - ch} width={bw} height={ch} rx="3" fill="var(--violet)"/>
                        <text x={cx} y={H - P + 14} textAnchor="middle" fill="var(--ink-3)" fontSize="9">S{i + 1}</text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, {DigitalTwinPage});
