// Campus Threat Map: Real MASS Topology
// HQ (Administrative) · Building A (Engineering) · Building B (Replica) · Server Room (Infra)

// ── Real campus layout ───────────────────────────────────────────────────────
const REAL_BUILDINGS = [
  { id:'HQ', label:'Administrative Building', sublabel:'HQ Intelligence · 192.168.12.10', x:50, y:50,
    role:'hq', ip:'192.168.12.10',
    agents:[
      { id:'analytical-agent-01',   label:'Analytical Agent'  },
      { id:'orchestrator-agent-01', label:'Orchestrator Agent' },
      { id:'learning-agent-01',     label:'Learning Agent'     },
      { id:'threat-intel-agent-01', label:'Threat Intel Agent' },
      { id:'forensic-agent-hq-01',  label:'Forensic Agent'     },
      { id:'central-manager-01',    label:'Central Manager'    },
    ]
  },
  { id:'A', label:'Building A', sublabel:'Engineering · 192.168.10.x', x:18, y:72,
    role:'campus', ip:'192.168.10.x',
    networks:[
      { name:'IoT Pi (VLAN 20)',  color:'var(--ok)',     agents:['gateway-agent-01','behavioral-agent-01'] },
      { name:'PAC Pi (VLAN 31)', color:'var(--warn)',   agents:['pac-eda-agent-01','credential-anomaly-agent-01'] },
      { name:'Data Network',     color:'var(--cyan)',   agents:['ndr-agent-01','edr-agent-01'] },
      { name:'Local Managers',   color:'var(--violet)', agents:['iot-local-manager-01','pac-local-manager-01','data-local-manager-01'] },
    ]
  },
  { id:'B', label:'Building B', sublabel:'Same structure as A, not yet deployed · 192.168.41.10', x:82, y:72,
    role:'campus', ip:'192.168.41.10',
    networks:[]
  },
  { id:'C', label:'Building C', sublabel:'Dentistry Faculty · Passive, no agents', x:18, y:30,
    role:'passive', ip:'No agents deployed',
  },
  { id:'SR', label:'Server Room', sublabel:'Infrastructure only · 192.168.60.x', x:50, y:10,
    role:'infra', ip:'192.168.60.x',
    services:[
      {name:'Kafka Broker', ip:'192.168.60.13:9092', role:'Message streaming'},
      {name:'MongoDB',      ip:'192.168.60.12:27017', role:'Incident storage'},
      {name:'MQTT Broker',  ip:'192.168.60.10:1883',  role:'IoT telemetry'},
    ]
  },
];

// ── Isometric building block ─────────────────────────────────────────────────
function IsoBuilding({ threat, size='md' }){
  const W = size==='lg' ? 110 : size==='sm' ? 70 : 90;
  const D = size==='lg' ? 70  : size==='sm' ? 45 : 58;
  const H = size==='lg' ? 44  : size==='sm' ? 28 : 36;
  const color = {LOW:'var(--ok)',MEDIUM:'var(--warn)',HIGH:'var(--hi)',CRITICAL:'var(--crit)',NONE:'var(--ink-4)'}[threat]||'var(--ink-4)';
  return (
    <g>
      <ellipse cx={W/2} cy={H+D/2+8} rx={W*0.55} ry={D*0.35}
        fill={color} opacity={threat==='CRITICAL'?.4:threat==='HIGH'?.25:.15}
        style={{filter:'blur(7px)', animation:threat==='CRITICAL'?'pulse 1.4s infinite':'none'}}/>
      <polygon points={`${W},${H} ${W+D/2},${H-D/3} ${W+D/2},${H+D*.66} ${W},${H+D}`}
        fill={`color-mix(in oklab, ${color} 28%, oklch(0.20 0.025 252))`} stroke={color} strokeOpacity=".6" strokeWidth=".8"/>
      <polygon points={`0,${H} ${W},${H} ${W},${H+D} 0,${H+D}`}
        fill={`color-mix(in oklab, ${color} 16%, oklch(0.22 0.028 252))`} stroke={color} strokeOpacity=".6" strokeWidth=".8"/>
      <polygon points={`0,${H} ${D/2},${H-D/3} ${W+D/2},${H-D/3} ${W},${H}`}
        fill={`color-mix(in oklab, ${color} 32%, oklch(0.26 0.03 252))`} stroke={color} strokeOpacity=".7" strokeWidth=".8"/>
      {[0,1,2,3].map(i=>(
        <rect key={i} x={7+i*19} y={H+7} width="11" height="5" rx="1"
          fill={color} opacity={Math.sin(i*1.3)>.2?.8:.2}/>
      ))}
      {[0,1,2,3].map(i=>(
        <rect key={'r'+i} x={7+i*19} y={H+20} width="11" height="5" rx="1"
          fill={color} opacity={Math.sin(i*2.1)>.0?.8:.2}/>
      ))}
    </g>
  );
}

// ── Server rack icon ─────────────────────────────────────────────────────────
function ServerRack({ color='var(--cyan)' }){
  return (
    <g>
      <rect x="0" y="0" width="70" height="54" rx="4"
        fill="oklch(0.20 0.025 252)" stroke={color} strokeWidth="1.5"
        style={{filter:`drop-shadow(0 0 8px ${color})`}}/>
      {[0,1,2,3].map(i=>(
        <g key={i}>
          <rect x="6" y={6+i*12} width="58" height="8" rx="2"
            fill={`color-mix(in oklab, ${color} 18%, transparent)`} stroke={color} strokeOpacity=".4" strokeWidth=".6"/>
          <circle cx="56" cy={10+i*12} r="2.5" fill={color} style={{animation:`pulse ${1.2+i*0.3}s infinite`}}/>
          <rect x="10" y={8+i*12} width="30" height="4" rx="1"
            fill={color} opacity=".25"/>
        </g>
      ))}
    </g>
  );
}

// ── Network subnet badge inside building ─────────────────────────────────────
function NetworkBadge({ name, color, agentCount, healthy }){
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:6,
      padding:'4px 8px', borderRadius:6,
      border:`1px solid color-mix(in oklab, ${color} 45%, var(--line))`,
      background:`color-mix(in oklab, ${color} 10%, transparent)`,
    }}>
      <span style={{width:6,height:6,borderRadius:99,background:color,
        boxShadow:`0 0 8px ${color}`, animation:'pulse 1.6s infinite'}}/>
      <span className="mono tiny" style={{color,fontSize:9}}>{name}</span>
      <span className="mono tiny" style={{color:'var(--ink-3)',fontSize:9,marginLeft:'auto'}}>
        {healthy}/{agentCount}
      </span>
    </div>
  );
}

// ── Building detail card (sidebar) ──────────────────────────────────────────
function BuildingDetail({ b, threat, agents, nonHqHealthy }){
  var color = {LOW:'var(--ok)',MEDIUM:'var(--warn)',HIGH:'var(--hi)',CRITICAL:'var(--crit)',NONE:'var(--ink-4)'}[threat]||'var(--ink-4)';
  var epAgents = [];
  if (b.id === 'A') {
    for (var epi = 0; epi < agents.length; epi++) {
      var epId = agents[epi].id;
      var isEpNdr = epId.indexOf('ndr-agent-') === 0 && epId !== 'ndr-agent-01';
      var isEpEdr = epId.indexOf('edr-agent-') === 0 && epId !== 'edr-agent-01';
      if (isEpNdr || isEpEdr) { epAgents.push(agents[epi]); }
    }
  }
  return (
    <div style={{padding:'10px 12px', border:`1px solid color-mix(in oklab, ${color} 45%, var(--line))`,
      borderRadius:10, background:'oklch(0.20 0.025 252 / .7)', marginBottom:10}}>
      <div className="between" style={{marginBottom:6}}>
        <div>
          <div style={{fontWeight:600,fontSize:12,color:'var(--ink)'}}>{b.label}</div>
          <div className="mono tiny" style={{color:'var(--ink-3)',marginTop:2}}>{b.ip}</div>
        </div>
        <span className="tag" style={{color,borderColor:`color-mix(in oklab, ${color} 45%, var(--line))`}}>{threat}</span>
      </div>

      {b.networks && b.networks.length === 0 && (
        <div className="mono tiny" style={{color:'var(--ink-3)', marginTop:6}}>No agents deployed.</div>
      )}
      {b.networks && b.networks.length > 0 && (
        <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6}}>
          {b.networks.map(function(n){
            var aliveCount = n.agents.filter(function(aid){ return (agents.find(function(a){return a.id===aid;})||{}).healthy; }).length;
            return <NetworkBadge key={n.name} name={n.name} color={n.color}
              agentCount={n.agents.length} healthy={aliveCount}/>;
          })}
        </div>
      )}

      {b.agents && (
        <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6}}>
          {b.agents.map(a=>{
            var live = (agents.find(function(ag){return ag.id===a.id;})||{}).healthy;
            return (
              <div key={a.id} className="between" style={{padding:'2px 0'}}>
                <span className="mono tiny" style={{color:'var(--ink-2)',fontSize:9}}>{a.label}</span>
                <span style={{width:6,height:6,borderRadius:99,
                  background:live?'var(--ok)':'var(--crit)',
                  boxShadow:`0 0 6px ${live?'var(--ok)':'var(--crit)'}`}}/>
              </div>
            );
          })}
        </div>
      )}

      {epAgents.length > 0 && (
        <div style={{marginTop:8}}>
          <div className="mono tiny" style={{color:'var(--cyan)', marginBottom:4, letterSpacing:2, fontSize:8}}>DISCOVERED ENDPOINTS</div>
          {epAgents.map(function(a) {
            var shortId = a.id.slice(-5);
            var prefix = a.id.indexOf('ndr-') === 0 ? 'NDR' : 'EDR';
            return (
              <div key={a.id} className="between" style={{padding:'2px 0'}}>
                <span className="mono tiny" style={{color:'var(--ink-2)', fontSize:9}}>{prefix} <span style={{opacity:0.6}}>·{shortId}</span></span>
                <span style={{width:6, height:6, borderRadius:99,
                  background: a.healthy ? 'var(--ok)' : 'var(--crit)',
                  boxShadow:'0 0 6px ' + (a.healthy ? 'var(--ok)' : 'var(--crit)')}}/>
              </div>
            );
          })}
        </div>
      )}

      {b.services && (
        <div style={{marginTop:8}}>
          <div className="mono tiny" style={{color:'var(--ink-3)', marginBottom:4, letterSpacing:2, fontSize:8}}>INFRASTRUCTURE</div>
          {b.services.map(function(s, si) {
            var sName = (s && s.name) ? s.name : String(s);
            var sIp = (s && s.ip) ? s.ip : null;
            var sRole = (s && s.role) ? s.role : null;
            return (
              <div key={si} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                <span style={{width:5, height:5, borderRadius:'50%', background:nonHqHealthy ? 'var(--ok)' : '#888888', flexShrink:0, display:'inline-block'}}/>
                <span className="mono" style={{color:'var(--ink)', fontSize:9, flex:1}}>{sName}</span>
                {sIp && <span className="mono" style={{color:'var(--cyan)', fontSize:9}}>{sIp}</span>}
                <span style={{color:nonHqHealthy ? '#44ee88' : 'var(--ink-4)', fontSize:8, fontWeight:700, marginLeft:6}}>{nonHqHealthy ? 'RUNNING' : 'UNKNOWN'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main map page ────────────────────────────────────────────────────────────
function CampusMapPage(){
  var hqCtx = useHQ();
  var t = hqCtx.t;
  var agents = hqCtx.agents;
  var threat_level = hqCtx.threat_level;
  var counts = hqCtx.counts;
  var executions = hqCtx.executions;
  var HQ_AGENTS_MAP = ['analytical-agent-01','orchestrator-agent-01','learning-agent-01','threat-intel-agent-01','forensic-agent-hq-01','central-manager-01'];
  var nonHqHealthy = false;
  for (var nhi = 0; nhi < agents.length; nhi++) {
    if (HQ_AGENTS_MAP.indexOf(agents[nhi].id) === -1 && agents[nhi].healthy) {
      nonHqHealthy = true; break;
    }
  }

  function threatForBuilding(b) {
    if (b.id === 'HQ') return threat_level;
    if (b.role === 'passive') return 'NONE';
    if (b.id === 'SR') return 'LOW';
    if (b.networks) {
      var allAgentIds = [];
      for (var ni = 0; ni < b.networks.length; ni++) {
        var net = b.networks[ni];
        for (var ai = 0; ai < net.agents.length; ai++) {
          allAgentIds.push(net.agents[ai]);
        }
      }
      if (allAgentIds.length === 0) return 'NONE';
      var unhealthy = 0;
      for (var ui = 0; ui < allAgentIds.length; ui++) {
        var found = null;
        for (var fi = 0; fi < agents.length; fi++) {
          if (agents[fi].id === allAgentIds[ui]) { found = agents[fi]; break; }
        }
        if (!found || !found.healthy) unhealthy++;
      }
      var ratio = unhealthy / allAgentIds.length;
      if (ratio > 0.6) return 'CRITICAL';
      if (ratio > 0.3) return 'HIGH';
      if (ratio > 0.1) return 'MEDIUM';
      return 'LOW';
    }
    return 'NONE';
  }

  const W=1000, H=540;
  const pos = (b)=>({ x:(b.x/100)*W, y:(b.y/100)*H });

  const hq = REAL_BUILDINGS.find(b=>b.id==='HQ');
  const hqPos = pos(hq);

  return (
    <div className="page-enter"
      style={{padding:'22px 26px 60px',display:'grid',gridTemplateColumns:'1fr 300px',gap:18}}
      data-screen-label="Campus Map · MASS Topology">

      {/* ── Map canvas ── */}
      <Section title="Galala Campus · Live Topology" kicker="Real agent locations · threat telemetry"
        right={<span className="tag c-cyan">{REAL_BUILDINGS.length} sites</span>}>
        <div style={{position:'relative',
          background:`radial-gradient(120% 90% at 50% 60%, oklch(0.22 0.04 250 / .45), transparent 60%),
                      linear-gradient(180deg, oklch(0.16 0.025 252), oklch(0.13 0.025 252))`,
          border:'1px solid var(--line)',borderRadius:12,overflow:'hidden',height:H}}>

          {/* iso grid */}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:.12}}>
            {Array.from({length:28}).map((_,i)=>(
              <line key={'a'+i} x1={i*50-150} y1="0" x2={i*50+150} y2={H} stroke="var(--cyan)" strokeWidth=".5"/>
            ))}
            {Array.from({length:28}).map((_,i)=>(
              <line key={'b'+i} x1={i*50-150} y1={H} x2={i*50+150} y2="0" stroke="var(--cyan)" strokeWidth=".5"/>
            ))}
          </svg>

          {/* connection lines HQ ↔ buildings + SR */}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
            {REAL_BUILDINGS.filter(b=>b.id!=='HQ').map(b=>{
              const p1 = pos(hq);
              const p2 = pos(b);
              const tl   = threatForBuilding(b);
              const color= {LOW:'var(--ok)',MEDIUM:'var(--warn)',HIGH:'var(--hi)',CRITICAL:'var(--crit)',}[tl];
              const isSR = b.id==='SR'; const isPassive = b.role==='passive';
              return (
                <g key={b.id}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={isPassive?'var(--ink-4)':color} strokeOpacity={isPassive?.2:.35} strokeWidth={isSR?1.5:1.2}
                    strokeDasharray={isPassive?"4 8":isSR?"8 4":"6 6"}
                    style={{animation:'flowdash 4s linear infinite'}}/>
                  {[0,.33,.66].map(off=>{
                    const phase=((t/10)+off)%1;
                    const cx=p1.x+(p2.x-p1.x)*phase, cy=p1.y+(p2.y-p1.y)*phase;
                    return isPassive ? null : <circle key={off} cx={cx} cy={cy} r={isSR?2.5:3}
                      fill={color} style={{filter:`drop-shadow(0 0 5px ${color})`}}/>;
                  })}
                </g>
              );
            })}
          </svg>

          {/* buildings */}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
            style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
            {REAL_BUILDINGS.map(b=>{
              const p   = pos(b);
              const tl  = threatForBuilding(b);
              const color={LOW:'var(--ok)',MEDIUM:'var(--warn)',HIGH:'var(--hi)',CRITICAL:'var(--crit)'}[tl];
              const isSR= b.id==='SR';
              const isHQ= b.id==='HQ';

              return (
                <g key={b.id} transform={`translate(${p.x-45},${p.y-30})`}>
                  {isSR
                    ? <ServerRack color="var(--cyan)"/>
                    : <IsoBuilding threat={tl} size={isHQ?'lg':'md'}/>
                  }
                  {/* label plate */}
                  <g transform={`translate(-4, ${isSR?58:100})`}>
                    <rect x="0" y="0" width="130" height={isHQ?46:isSR?46:38} rx="6"
                      fill="oklch(0.18 0.025 252 / .92)" stroke={color} strokeOpacity=".5" strokeWidth=".8"/>
                    <text x="8" y="14" fill="var(--ink)" fontSize="11" fontFamily="JetBrains Mono" fontWeight="600">{b.label}</text>
                    <text x="8" y="26" fill="var(--ink-3)" fontSize="9" fontFamily="JetBrains Mono">{b.id==='SR' ? b.sublabel : b.sublabel.split('·')[0]}</text>
                    {isHQ && <text x="8" y="38" fill="var(--cyan)" fontSize="9" fontFamily="JetBrains Mono">{b.ip}</text>}
                    {/* threat dot */}
                    {!isSR && (
                      <g transform="translate(8, 30)">
                        <circle r="3.5" fill={color}
                          style={{filter:`drop-shadow(0 0 5px ${color})`,
                            animation:tl==='CRITICAL'||tl==='HIGH'?'pulse 1.2s infinite':'none'}}/>
                        <text x="10" y="4" fill={color} fontSize="9" fontFamily="JetBrains Mono">{tl}</text>
                      </g>
                    )}
                  </g>

                  {/* HQ weather emoji */}
                  {isHQ && (
                    <g transform="translate(100,-16)">
                      <circle r="14" fill="oklch(0.18 0.025 252)" stroke="var(--cyan)" strokeWidth="1.5"
                        style={{filter:'drop-shadow(0 0 8px var(--cyan))'}}/>
                      <text x="0" y="5" textAnchor="middle" fontSize="14">
                        {tl==='CRITICAL'?'⚡':tl==='HIGH'?'⛈':tl==='MEDIUM'?'☁':'☀'}
                      </text>
                    </g>
                  )}

                  {/* network rings for campus buildings */}
                  {b.networks && b.networks.map((n,ni)=>{
                    var aliveCount = n.agents.filter(function(aid){ return (agents.find(function(a){return a.id===aid;})||{}).healthy; }).length;
                    const allAlive   = aliveCount===n.agents.length;
                    const ringColor  = allAlive ? n.color : 'var(--crit)';
                    return (
                      <g key={ni} transform={`translate(${96+ni*18}, ${10+ni*14})`}>
                        <circle r="7" fill={`color-mix(in oklab, ${ringColor} 18%, transparent)`}
                          stroke={ringColor} strokeWidth="1.2"
                          style={{filter:`drop-shadow(0 0 5px ${ringColor})`,
                            animation:'pulse 1.8s infinite'}}/>
                        <text x="0" y="3.5" textAnchor="middle" fontSize="6"
                          fill={ringColor} fontFamily="JetBrains Mono" fontWeight="600">
                          {n.name.slice(0,3).toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* legend */}
          <div style={{position:'absolute',left:14,bottom:14,display:'flex',gap:12,
            padding:'8px 12px',border:'1px solid var(--line)',borderRadius:8,
            background:'oklch(0.18 0.025 252 / .9)'}}>
            {[
              {label:'LOW',      color:'var(--ok)'},
              {label:'MEDIUM',   color:'var(--warn)'},
              {label:'HIGH',     color:'var(--hi)'},
              {label:'CRITICAL', color:'var(--crit)'},
            ].map(l=>(
              <div key={l.label} style={{display:'flex',alignItems:'center',gap:5}}>
                <span style={{width:8,height:8,borderRadius:99,background:l.color,
                  boxShadow:`0 0 6px ${l.color}`}}/>
                <span className="mono tiny" style={{color:l.color,fontSize:9}}>{l.label}</span>
              </div>
            ))}
          </div>

          {/* compass */}
          <div style={{position:'absolute',right:14,bottom:14,
            padding:'6px 10px',border:'1px solid var(--line)',borderRadius:8,
            background:'oklch(0.18 0.025 252 / .85)'}}>
            <span className="mono tiny c-cyan">N ↑</span>
          </div>
        </div>
      </Section>

      {/* ── Sidebar ── */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <Section title="Site Status" kicker="Real agent health · per building">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {REAL_BUILDINGS.map(b=>(
              <BuildingDetail key={b.id} b={b} threat={threatForBuilding(b)} agents={agents} nonHqHealthy={nonHqHealthy}/>
            ))}
          </div>
        </Section>

        <Section title="Active Isolations" kicker="SOAR response actions (populated from orchestrator executions)">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {(executions && executions.length > 0) ? executions.slice(-3).reverse().map(function(ex){
              var cmdCount = ex.steps ? ex.steps.filter(function(s){return s;}).length : 0;
              var statusColor = ({success:'var(--ok)',running:'var(--cyan)',pending:'var(--warn)',failed:'var(--crit)'})[ex.status] || 'var(--ink-2)';
              return (
                <div key={ex.id} style={{padding:'8px 10px',borderRadius:8,
                  background:'color-mix(in oklab, '+statusColor+' 10%, transparent)',
                  border:'1px solid color-mix(in oklab, '+statusColor+' 35%, var(--line))'}}>
                  <div className="mono tiny" style={{color:statusColor}}>{ex.pb}: {ex.status}</div>
                  <div className="tiny c-ink3" style={{marginTop:3}}>{cmdCount} commands issued</div>
                </div>
              );
            }) : (
              <div className="tiny c-ink3" style={{textAlign:'center',padding:'12px 0'}}>
                No active response actions. Orchestrator standing by.
              </div>
            )}
          </div>
        </Section>
      </div>

    </div>
  );
}

Object.assign(window, { CampusMapPage });
