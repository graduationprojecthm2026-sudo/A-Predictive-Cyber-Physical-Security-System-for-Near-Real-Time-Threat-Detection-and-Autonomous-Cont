// Topology: Campus Network Topology
// Shows all buildings, VLANs, agents, and connections

var AGENT_LOCATIONS = {
  'analytical-agent-01':          { code: 'HQ', name: 'HQ / Administrative' },
  'orchestrator-agent-01':        { code: 'HQ', name: 'HQ / Administrative' },
  'learning-agent-01':            { code: 'HQ', name: 'HQ / Administrative' },
  'threat-intel-agent-01':        { code: 'HQ', name: 'HQ / Administrative' },
  'forensic-agent-hq-01':         { code: 'HQ', name: 'HQ / Administrative' },
  'central-manager-01':           { code: 'HQ', name: 'HQ / Administrative' },
  'gateway-agent-01':             { code: 'A',  name: 'Building A'           },
  'behavioral-agent-01':          { code: 'A',  name: 'Building A'           },
  'pac-eda-agent-01':             { code: 'A',  name: 'Building A'           },
  'credential-anomaly-agent-01':  { code: 'A',  name: 'Building A'           },
  'ndr-agent-01':                 { code: 'A',  name: 'Building A'           },
  'edr-agent-01':                 { code: 'A',  name: 'Building A'           },
  'iot-local-manager-01':         { code: 'A',  name: 'Building A'           },
  'pac-local-manager-01':         { code: 'A',  name: 'Building A'           },
  'data-local-manager-01':        { code: 'A',  name: 'Building A'           },
};

function getAgentLocCode(agentId) {
  var loc = AGENT_LOCATIONS[agentId];
  if (loc) return loc.code;
  var lc = (agentId || '').toLowerCase();
  var isNdr = lc.indexOf('ndr-agent-') === 0 && agentId !== 'ndr-agent-01';
  var isEdr = lc.indexOf('edr-agent-') === 0 && agentId !== 'edr-agent-01';
  if (isNdr || isEdr) return 'EP';
  return '?';
}

function getAgentLocName(agentId) {
  var loc = AGENT_LOCATIONS[agentId];
  if (loc) return loc.name;
  var lc = (agentId || '').toLowerCase();
  var isNdr = lc.indexOf('ndr-agent-') === 0 && agentId !== 'ndr-agent-01';
  var isEdr = lc.indexOf('edr-agent-') === 0 && agentId !== 'edr-agent-01';
  if (isNdr || isEdr) return 'Endpoint';
  return 'Unknown';
}

function TopologyPage() {
  var hqData = useHQ();
  var agents = hqData.agents;
  var threat_level = hqData.threat_level;
  var incidents = hqData.incidents;

  var BUILDINGS = [
    { id:'hq',    label:'HQ',          sub:'Administrative', buildingKey:'HQ', x:380, y:220, w:140, h:80,  vlan:'VLAN 12',    color:'var(--violet)' },
    { id:'server',label:'Server Room', sub:'Infrastructure', buildingKey:'SR', x:380, y:60,  w:140, h:60,  vlan:'VLAN 60',    color:'var(--cyan)'   },
    { id:'bldA',  label:'Building A',  sub:'Engineering',    buildingKey:'A',  x:100, y:180, w:140, h:80,  vlan:'VLAN 20/31', color:'var(--ok)'     },
    { id:'bldB',  label:'Building B',  sub:'',               buildingKey:'B',  x:660, y:180, w:140, h:80,  vlan:'VLAN 20/32', color:'var(--ok)'     },
    { id:'bldC',  label:'Building C',  sub:'Dentistry',      buildingKey:'C',  x:380, y:380, w:140, h:60,  vlan:'VLAN 10',    color:'var(--ink-3)'  },
  ];

  var LINKS = [
    { from:'server', to:'hq',   label:'10 Gbps Fiber', style:'solid'  },
    { from:'hq',     to:'bldA', label:'10 Gbps Fiber', style:'solid'  },
    { from:'hq',     to:'bldB', label:'10 Gbps Fiber', style:'solid'  },
    { from:'hq',     to:'bldC', label:'1 Gbps',        style:'dashed' },
    { from:'server', to:'bldA', label:'Kafka',         style:'dotted' },
    { from:'server', to:'bldB', label:'Kafka',         style:'dotted' },
  ];

  var VLANS = [
    { id: 10, name:'Data (Students)',   subnet:'192.168.10.0/24',   color:'#3b82f6' },
    { id: 12, name:'Data (HQ)',         subnet:'192.168.12.0/24',   color:'#8b5cf6' },
    { id: 15, name:'Data (Staff)',      subnet:'192.168.15.0/24',   color:'#60a5fa' },
    { id: 20, name:'IoT',              subnet:'192.168.20.0/24',   color:'#10b981' },
    { id: 21, name:'IoT Admin',        subnet:'192.168.21.0/24',   color:'#34d399' },
    { id: 22, name:'IoT HQ',           subnet:'192.168.22.0/24',   color:'#6ee7b7' },
    { id: 31, name:'PAC Building A',   subnet:'192.168.31.0/24',   color:'#f59e0b' },
    { id: 32, name:'PAC Building B',   subnet:'192.168.32.0/24',   color:'#fbbf24' },
    { id: 33, name:'PAC Admin',        subnet:'192.168.24.96/27',  color:'#f59e0b' },
    { id: 34, name:'PAC HQ',          subnet:'192.168.24.128/27', color:'#fcd34d' },
    { id: 40, name:'Local Manager A',  subnet:'192.168.40.0/24',   color:'#a78bfa' },
    { id: 41, name:'Local Manager B',  subnet:'192.168.41.0/24',   color:'#c4b5fd' },
    { id: 50, name:'DMZ',             subnet:'192.168.50.0/24',   color:'#ef4444' },
    { id: 60, name:'Internal Servers', subnet:'192.168.60.0/24',   color:'#06b6d4' },
    { id: 99, name:'Visitors/Guest',  subnet:'192.168.99.0/24',   color:'#6b7280' },
  ];

  function getBuildingById(id) {
    for (var i = 0; i < BUILDINGS.length; i++) {
      if (BUILDINGS[i].id === id) return BUILDINGS[i];
    }
    return null;
  }

  function getBuildingCenter(b) {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  var threatColor = threat_level === 'CRITICAL' ? 'var(--crit)'
    : threat_level === 'HIGH'     ? 'var(--hi)'
    : threat_level === 'MEDIUM'   ? 'var(--warn)'
    : 'var(--ok)';

  var sevColors = { critical:'var(--crit)', high:'var(--hi)', medium:'var(--warn)', low:'var(--ok)' };
  var domainLabel = { iot:'IoT', data_network:'Data', physical_access:'PAC', hq:'HQ' };

  var securityIncidents = (incidents || []).filter(function(inc){
    return inc.alert_type !== 'agent_down' && inc.alert_type !== 'agent_offline';
  }).slice(0, 5);

  var totalHealthy = agents.filter(function(a){ return a.healthy; }).length;

  return (
    <div style={{padding:'24px', height:'100%', overflowY:'auto'}}>

      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
        <div>
          <div style={{fontSize:22, fontWeight:700, color:'var(--ink)', letterSpacing:'-0.5px'}}>
            Network Topology
          </div>
          <div style={{fontSize:12, color:'var(--ink-3)', marginTop:2}}>
            Smart Campus · Galala University · 5 sites · 3 network domains
          </div>
        </div>
        <div style={{display:'flex', gap:12}}>
          <div style={{padding:'6px 14px', borderRadius:8,
            background:'color-mix(in oklab, '+threatColor+' 15%, var(--surface))',
            border:'1px solid '+threatColor, color:threatColor, fontSize:12, fontWeight:700}}>
            {threat_level}
          </div>
          <div style={{padding:'6px 14px', borderRadius:8, background:'var(--surface)',
            border:'1px solid var(--line)', color:'var(--ink-2)', fontSize:12}}>
            {totalHealthy}/{agents.length} Agents Online
          </div>
        </div>
      </div>

      {/* Security Incident Table */}
      <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16, marginBottom:24}}>
        <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:12}}>
          ACTIVE SECURITY INCIDENTS
        </div>
        {securityIncidents.length === 0 ? (
          <div style={{fontSize:12, color:'var(--ink-3)', textAlign:'center', padding:'16px 0'}}>
            No active security incidents. Agent status shown in topology below.
          </div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr>
                {['Severity','ID','Description','Domain','Time'].map(function(col){
                  return <th key={col} style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>{col}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {securityIncidents.map(function(inc){
                var sc = sevColors[inc.sev] || 'var(--warn)';
                var tsStr = inc.ts ? new Date(inc.ts).toLocaleTimeString().slice(0,5) : '--:--';
                return (
                  <tr key={inc.id} style={{borderTop:'1px solid var(--line)'}}>
                    <td style={{padding:'6px 0'}}>
                      <span style={{color:sc, fontSize:10, fontWeight:700}}>{(inc.sev || '').toUpperCase()}</span>
                    </td>
                    <td style={{padding:'6px 8px', color:'var(--ink-3)', fontFamily:'monospace', fontSize:10}}>
                      {inc.id}
                    </td>
                    <td style={{padding:'6px 8px', color:'var(--ink)'}}>{inc.desc}</td>
                    <td style={{padding:'6px 8px', color:'var(--ink-3)'}}>
                      {domainLabel[inc.domain] || inc.domain}
                    </td>
                    <td style={{padding:'6px 0', color:'var(--ink-3)'}}>{tsStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Main topology SVG */}
      <div style={{background:'var(--surface)', borderRadius:16, border:'1px solid var(--line)', padding:16, marginBottom:24}}>
        <svg viewBox="0 0 900 480" style={{width:'100%', height:'auto'}}>
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
            </pattern>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.3)"/>
            </marker>
            <marker id="arrow-kafka" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--cyan)"/>
            </marker>
          </defs>
          <rect width="900" height="480" fill="url(#grid)"/>

          <ellipse cx="450" cy="30" rx="60" ry="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeDasharray="4,3"/>
          <text x="450" y="35" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="11">INTERNET</text>

          {LINKS.map(function(link, i) {
            var fromB = getBuildingById(link.from);
            var toB   = getBuildingById(link.to);
            if (!fromB || !toB) return null;
            var from = getBuildingCenter(fromB);
            var to   = getBuildingCenter(toB);
            var isKafka = link.label === 'Kafka';
            return (
              <g key={i}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={isKafka ? 'var(--cyan)' : 'rgba(255,255,255,0.2)'}
                  strokeWidth={isKafka ? 1 : 2}
                  strokeDasharray={link.style === 'dashed' ? '6,4' : link.style === 'dotted' ? '2,4' : 'none'}
                  markerEnd={isKafka ? 'url(#arrow-kafka)' : 'url(#arrow)'}
                  opacity={isKafka ? 0.7 : 1}/>
                <text x={(from.x + to.x) / 2 + 6} y={(from.y + to.y) / 2 - 6}
                  fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle">
                  {link.label}
                </text>
              </g>
            );
          })}

          <line x1="450" y1="48" x2="450" y2="60" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"/>

          {BUILDINGS.map(function(b) {
            var buildingAgents = agents.filter(function(a) {
              var code = getAgentLocCode(a.id);
              if (code === b.buildingKey) return true;
              if (code === 'EP' && b.buildingKey === 'A') return true;
              return false;
            });
            var aliveCount  = buildingAgents.filter(function(a){ return a.healthy; }).length;
            var totalAgents = buildingAgents.length;
            var hasIssue    = totalAgents > 0 && aliveCount < totalAgents;
            var borderColor = totalAgents === 0 ? 'rgba(255,255,255,0.1)'
              : hasIssue ? 'var(--warn)'
              : b.color;
            return (
              <g key={b.id}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="10"
                  fill="rgba(255,255,255,0.04)" stroke={borderColor} strokeWidth="1.5"/>
                <text x={b.x + b.w/2} y={b.y + 20} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">
                  {b.label}
                </text>
                <text x={b.x + b.w/2} y={b.y + 35} textAnchor="middle" fill="var(--ink-3)" fontSize="10">
                  {b.sub}
                </text>
                <rect x={b.x + b.w/2 - 28} y={b.y + b.h - 22} width="56" height="14" rx="4" fill="rgba(255,255,255,0.07)"/>
                <text x={b.x + b.w/2} y={b.y + b.h - 12} textAnchor="middle" fill={b.color} fontSize="9">
                  {b.vlan}
                </text>
                {totalAgents > 0 && (
                  <g>
                    <circle cx={b.x + b.w - 14} cy={b.y + 14} r="10"
                      fill={hasIssue ? 'var(--warn)' : 'var(--ok)'} opacity="0.9"/>
                    <text x={b.x + b.w - 14} y={b.y + 18} textAnchor="middle" fill="#000" fontSize="9" fontWeight="700">
                      {aliveCount}/{totalAgents}
                    </text>
                  </g>
                )}
                {totalAgents === 0 && (
                  <text x={b.x + b.w/2} y={b.y + b.h/2 + 6} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="10">
                    PASSIVE
                  </text>
                )}
              </g>
            );
          })}

          <g transform="translate(20, 420)">
            <text fill="rgba(255,255,255,0.4)" fontSize="10" y="0">LEGEND</text>
            <line x1="0" y1="12" x2="24" y2="12" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
            <text fill="rgba(255,255,255,0.4)" fontSize="10" x="28" y="16">10 Gbps Fiber</text>
            <line x1="100" y1="12" x2="124" y2="12" stroke="var(--cyan)" strokeWidth="1.5" strokeDasharray="2,3"/>
            <text fill="rgba(255,255,255,0.4)" fontSize="10" x="128" y="16">Kafka Stream</text>
            <circle cx="230" cy="12" r="5" fill="var(--ok)"/>
            <text fill="rgba(255,255,255,0.4)" fontSize="10" x="240" y="16">Agents OK</text>
            <circle cx="310" cy="12" r="5" fill="var(--warn)"/>
            <text fill="rgba(255,255,255,0.4)" fontSize="10" x="320" y="16">Agent Down</text>
          </g>
        </svg>
      </div>

      {/* VLAN + Agent deployment tables */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24}}>
        <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:12}}>VLAN SEGMENTATION</div>
          <div style={{maxHeight:340, overflowY:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead style={{position:'sticky', top:0, background:'var(--surface)'}}>
                <tr>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>VLAN</th>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Name</th>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Subnet</th>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {VLANS.map(function(v) {
                  return (
                    <tr key={v.id} style={{borderTop:'1px solid var(--line)'}}>
                      <td style={{padding:'5px 0', color:v.color, fontWeight:700, fontFamily:'monospace'}}>{v.id}</td>
                      <td style={{padding:'5px 8px', color:'var(--ink-2)'}}>{v.name}</td>
                      <td style={{padding:'5px 8px', color:'var(--ink-3)', fontFamily:'monospace', fontSize:10}}>{v.subnet}</td>
                      <td style={{padding:'5px 0'}}><span style={{color:'var(--ok)', fontSize:10}}>● ACTIVE</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:12}}>AGENT DEPLOYMENT</div>
          <div style={{maxHeight:340, overflowY:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead style={{position:'sticky', top:0, background:'var(--surface)'}}>
                <tr>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Agent</th>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Location</th>
                  <th style={{textAlign:'left', color:'var(--ink-3)', paddingBottom:8, fontWeight:600}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(function(a) {
                  var locName = getAgentLocName(a.id);
                  return (
                    <tr key={a.id} style={{borderTop:'1px solid var(--line)'}}>
                      <td style={{padding:'6px 0', color:'var(--ink)', fontFamily:'monospace', fontSize:11}}>{a.id}</td>
                      <td style={{padding:'6px 8px', color:'var(--ink-3)', fontSize:11}}>{locName}</td>
                      <td style={{padding:'6px 0'}}>
                        <span style={{color: a.healthy ? 'var(--ok)' : 'var(--crit)', fontSize:10, fontWeight:700}}>
                          {a.healthy ? '● ONLINE' : '○ OFFLINE'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={3} style={{padding:'8px 0 2px', color:'var(--ink-3)', fontSize:8, fontWeight:700, letterSpacing:2, borderTop:'2px solid var(--line)'}}>INFRASTRUCTURE SERVICES · SERVER ROOM (NO AGENTS)</td>
                </tr>
                {[
                  {name:'Kafka Broker', ip:'192.168.60.13:9092', role:'Message streaming'},
                  {name:'MongoDB',      ip:'192.168.60.12:27017', role:'Incident storage'},
                  {name:'MQTT Broker',  ip:'192.168.60.10:1883',  role:'IoT telemetry'},
                ].map(function(svc) {
                  return (
                    <tr key={svc.ip} style={{borderTop:'1px solid var(--line)'}}>
                      <td style={{padding:'6px 0', color:'var(--cyan)', fontFamily:'monospace', fontSize:11}}>{svc.name} · {svc.ip}</td>
                      <td style={{padding:'6px 8px', color:'var(--ink-3)', fontSize:11}}>Server Room</td>
                      <td style={{padding:'6px 0'}}>
                        <span style={{color:'var(--ok)', fontSize:10, fontWeight:700}}>● RUNNING</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Security policies */}
      <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16}}>
        <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:12}}>INTER-VLAN SECURITY POLICIES</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10}}>
          {[
            { rule:'IoT → Internet',       status:'DENY',  color:'var(--crit)', note:'Anti-botnet isolation'        },
            { rule:'Internet → DB Server', status:'DENY',  color:'var(--crit)', note:'Internal server protection'   },
            { rule:'Students → SIS',       status:'ALLOW', color:'var(--ok)',   note:'Restricted to SIS only'       },
            { rule:'Staff → Servers',      status:'ALLOW', color:'var(--ok)',   note:'Work requirements'            },
            { rule:'DMZ → Internet',       status:'ALLOW', color:'var(--ok)',   note:'Public-facing services'       },
            { rule:'Mgmt → All VLANs',     status:'ALLOW', color:'var(--ok)',   note:'Management VLAN full access'  },
          ].map(function(p, i) {
            return (
              <div key={i} style={{padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--line)'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
                  <span style={{fontSize:12, color:'var(--ink)', fontWeight:600}}>{p.rule}</span>
                  <span style={{fontSize:10, color:p.color, fontWeight:700}}>{p.status}</span>
                </div>
                <div style={{fontSize:10, color:'var(--ink-3)'}}>{p.note}</div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

Object.assign(window, { TopologyPage });
