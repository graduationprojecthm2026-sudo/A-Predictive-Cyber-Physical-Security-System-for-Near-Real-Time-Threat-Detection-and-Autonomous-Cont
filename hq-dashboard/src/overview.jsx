// Overview: "Mission Control Dashboard"
// Animated counters, severity bars, traffic-light threat, honeycomb agents,
// gradient incident-rate chart, animated donut, recent incidents slide-in.

var BASE_AGENTS = [
  { id:'analytical-agent-01',        icon:'AA',  color:'var(--violet)' },
  { id:'orchestrator-agent-01',       icon:'OR',  color:'var(--cyan)'   },
  { id:'threat-intel-agent-01',       icon:'TI',  color:'var(--warn)'   },
  { id:'forensic-agent-hq-01',        icon:'FS',  color:'var(--hi)'     },
  { id:'gateway-agent-01',            icon:'GW',  color:'var(--ok)'     },
  { id:'behavioral-agent-01',         icon:'BA',  color:'var(--ok)'     },
  { id:'pac-eda-agent-01',            icon:'PAC', color:'var(--hi)'     },
  { id:'credential-anomaly-agent-01', icon:'CA',  color:'var(--hi)'     },
  { id:'iot-local-manager-01',        icon:'IM',  color:'var(--ok)'     },
  { id:'pac-local-manager-01',        icon:'PM',  color:'var(--hi)'     },
  { id:'data-local-manager-01',       icon:'DM',  color:'var(--cyan)'   },
  { id:'ndr-agent-01',                icon:'NDR', color:'var(--cyan)'   },
  { id:'edr-agent-01',                icon:'EDR', color:'var(--cyan)'   },
];

function useTween(target, ms=600){
  const [val,setVal] = React.useState(target);
  const ref = React.useRef(target);
  React.useEffect(()=>{
    const from = ref.current, to = target;
    const start = performance.now();
    let raf;
    const step = (now)=>{
      const k = Math.min(1, (now-start)/ms);
      const e = 1 - Math.pow(1-k, 3);
      const v = from + (to-from)*e;
      setVal(v);
      if (k<1) raf = requestAnimationFrame(step);
      else ref.current = to;
    };
    raf = requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(raf);
  },[target,ms]);
  return val;
}

function Counter({value, digits, color}){
  const v = useTween(value, 700);
  const shown = digits ? String(Math.round(v)).padStart(digits,'0') : Math.round(v);
  return <span className="num" style={{color}}>{shown}</span>;
}

function TrafficLight(){
  var hqData = useHQ();
  var threat_level = hqData.threat_level;
  var colorMap = {CRITICAL:'var(--crit)',HIGH:'var(--hi)',MEDIUM:'var(--warn)',LOW:'var(--ok)'};
  var color = colorMap[threat_level] || 'var(--ink-3)';
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14,padding:'16px 0 8px'}}>
      <div style={{
        width:92,height:92,borderRadius:99,
        border:'3px solid '+color,
        background:'radial-gradient(circle, color-mix(in oklab, '+color+' 55%, transparent), color-mix(in oklab, '+color+' 18%, var(--surface)))',
        boxShadow:'0 0 40px '+color+', inset 0 0 20px color-mix(in oklab, '+color+' 35%, transparent)',
        display:'flex',alignItems:'center',justifyContent:'center',
        animation:'pulse 1.6s infinite',
        flexShrink:0,
      }}>
        <span style={{fontFamily:'JetBrains Mono',fontSize:9,fontWeight:700,color:'#fff',letterSpacing:'.08em',textAlign:'center',padding:'0 4px'}}>{threat_level}</span>
      </div>
      <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:700,color,letterSpacing:'.14em',textShadow:'0 0 20px '+color}}>
        {threat_level}
      </div>
      <div style={{height:3,width:'80%',borderRadius:99,background:color,boxShadow:'0 0 12px '+color,transition:'background .6s ease'}}/>
    </div>
  );
}

function SeverityKPI({label, count, total, color}){
  const pct = total ? count/total : 0;
  return (
    <div className="card card-pad" style={{position:'relative',overflow:'hidden'}}>
      <div className="between">
        <div className="tiny upper" style={{color:'var(--ink-3)',fontSize:10}}>{label}</div>
        <div className="tag" style={{borderColor:'color-mix(in oklab,'+color+' 40%,transparent)',color}}>{label}</div>
      </div>
      <div style={{fontSize:42,fontWeight:600,marginTop:6,lineHeight:1}}>
        <Counter value={count} digits={2} color={color}/>
      </div>
      <div className="tiny" style={{marginTop:6,color:'var(--ink-3)'}}>
        of {total} active incidents
      </div>
      <div style={{marginTop:14,height:6,background:'var(--surface-2)',borderRadius:99}}>
        <div style={{
          width:(pct*100)+'%',height:'100%',
          background:`linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 60%, transparent))`,
          boxShadow:`0 0 10px ${color}`,
          transition:'width .6s ease',
        }}/>
      </div>
    </div>
  );
}

function Honeycomb({ allAgents, healthMap }) {
  var perRow = 4;
  var rows = [];
  for (var ri = 0; ri < allAgents.length; ri += perRow) {
    var row = [];
    for (var rj = 0; rj < perRow && (ri + rj) < allAgents.length; rj++) {
      row.push(allAgents[ri + rj]);
    }
    rows.push(row);
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:0,alignItems:'flex-start',flexShrink:0}}>
      {rows.map(function(row, rowIdx) {
        return (
          <div key={rowIdx} style={{display:'flex',gap:4,marginTop:rowIdx===0?0:-12,marginLeft:rowIdx%2===1?34:0}}>
            {row.map(function(a) {
              var ok = healthMap[a.id] === true;
              var color = ok ? 'var(--ok)' : 'var(--crit)';
              return (
                <div key={a.id} title={a.id} className="hex" style={{
                  background:'linear-gradient(180deg, color-mix(in oklab, '+color+' 18%, var(--surface)), var(--surface))',
                  color,
                  position:'relative',
                  animation: ok ? 'glow-soft 2.4s infinite' : 'none',
                }}>
                  <span style={{fontFamily:'JetBrains Mono',fontSize:9}}>{a.icon}</span>
                  {a.shortId ? <span style={{fontFamily:'JetBrains Mono',fontSize:7,opacity:0.7,marginTop:1,letterSpacing:0}}>{a.shortId}</span> : null}
                  <span style={{position:'absolute',bottom:6,width:5,height:5,borderRadius:99,background:color,boxShadow:'0 0 6px '+color}}/>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function IncidentRateChart(){
  const { t, throughput } = useHQ();
  const [history,setHistory] = React.useState(()=>Array.from({length:60},()=>({n:0,e:0,i:0,p:0})));
  React.useEffect(()=>{
    setHistory(h=>{
      const next = h.slice(1);
      next.push({ n: throughput.ndr, e: throughput.edr, i: throughput.iot, p: throughput.pac });
      return next;
    });
  },[t]);
  const W = 760, H = 220, P = 24;
  var dataMax = 0;
  for (var mi = 0; mi < history.length; mi++) {
    var hv = history[mi];
    if (hv.n > dataMax) dataMax = hv.n;
    if (hv.e > dataMax) dataMax = hv.e;
    if (hv.i > dataMax) dataMax = hv.i;
    if (hv.p > dataMax) dataMax = hv.p;
  }
  var max = Math.max(dataMax * 1.2, 1);
  const x = (i)=> P + (i/(history.length-1)) * (W-2*P);
  const y = (v)=> H - P - (v/max)*(H-2*P);
  const series = [
    { key:'n', color:'var(--cyan)',   label:'NDR' },
    { key:'e', color:'var(--violet)', label:'EDR' },
    { key:'i', color:'var(--ok)',     label:'IoT' },
    { key:'p', color:'var(--warn)',   label:'PAC' },
  ];
  return (
    <div style={{position:'relative'}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:H,display:'block'}}>
        <defs>
          {series.map(s=>(
            <linearGradient key={s.key} id={'g-'+s.key} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity=".55"/>
              <stop offset="100%" stopColor={s.color} stopOpacity="0"/>
            </linearGradient>
          ))}
        </defs>
        {[0,1,2,3].map(i=>(
          <line key={i} x1={P} x2={W-P} y1={P + i*((H-2*P)/3)} y2={P + i*((H-2*P)/3)} stroke="var(--line-2)" strokeWidth=".5"/>
        ))}
        {series.map(s=>{
          const pts = history.map((d,i)=>[x(i), y(d[s.key])]);
          const area = `M ${pts[0][0]} ${H-P} ` + pts.map(p=>`L ${p[0]} ${p[1]}`).join(' ') + ` L ${pts[pts.length-1][0]} ${H-P} Z`;
          const line = `M ` + pts.map(p=>`${p[0]} ${p[1]}`).join(' L ');
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#g-${s.key})`}/>
              <path d={line} stroke={s.color} strokeWidth="1.6" fill="none" style={{filter:`drop-shadow(0 0 4px ${s.color})`}}/>
            </g>
          );
        })}
        <line x1={x(history.length-1)} x2={x(history.length-1)} y1={P} y2={H-P} stroke="var(--cyan)" strokeWidth=".8" opacity=".5"/>
        <text x={x(history.length-1)-4} y={P+10} fill="var(--cyan)" fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">NOW</text>
      </svg>
      <div style={{display:'flex',gap:14,marginTop:8,flexWrap:'wrap'}}>
        {series.map(s=>(
          <div key={s.key} className="tiny" style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:18,height:3,background:s.color,boxShadow:`0 0 6px ${s.color}`,display:'inline-block',borderRadius:99}}/>
            <span style={{color:'var(--ink-2)',fontFamily:'JetBrains Mono'}}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DomainDonut(){
  const { counts } = useHQ();
  const segs = [
    { key:'iot',             label:'IoT',     color:'var(--ok)'   },
    { key:'physical_access', label:'PAC',     color:'var(--warn)' },
    { key:'data_network',    label:'Data Network', color:'var(--cyan)' },
  ];
  const total = segs.reduce((s,d)=>s+(counts.by_domain[d.key]||0),0) || 1;
  let acc = 0;
  const r = 58, cx = 90, cy = 90, sw = 18;
  return (
    <div style={{display:'flex',alignItems:'center',gap:24}}>
      <svg viewBox="0 0 180 180" width="180" height="180">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={sw}/>
        {segs.map(s=>{
          const v = (counts.by_domain[s.key]||0)/total;
          const len = 2*Math.PI*r;
          const dash = `${v*len} ${len}`;
          const offset = -acc*len;
          const el = (
            <circle key={s.key} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={sw} strokeDasharray={dash}
              strokeDashoffset={offset} transform={`rotate(-90 ${cx} ${cy})`}
              style={{transition:'stroke-dasharray .6s ease', filter:`drop-shadow(0 0 6px ${s.color})`}}
            />
          );
          acc += v;
          return el;
        })}
        <text x={cx} y={cy-4} textAnchor="middle" fontSize="28" fill="var(--ink)" fontWeight="600" fontFamily="JetBrains Mono">{total}</text>
        <text x={cx} y={cy+14} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="JetBrains Mono" letterSpacing="2">TOTAL</text>
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:6,flex:1}}>
        {segs.map(s=>(
          <div key={s.key} className="between" style={{padding:'4px 0',borderBottom:'1px solid var(--line-2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{width:8,height:8,borderRadius:2,background:s.color,boxShadow:`0 0 4px ${s.color}`}}/>
              <span className="tiny" style={{color:'var(--ink-2)'}}>{s.label}</span>
            </div>
            <span className="num" style={{color:s.color,fontWeight:600}}>{counts.by_domain[s.key]||0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentIncidents(){
  const { incidents } = useHQ();
  const show = incidents.slice(0,8);
  const sevColor = { critical:'var(--crit)', high:'var(--hi)', medium:'var(--warn)', low:'var(--ok)' };
  function fmtAgo(ts){
    if(!ts) return '—';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if(sec < 60)  return sec + 's ago';
    if(sec < 3600) return Math.floor(sec/60) + 'm ago';
    return Math.floor(sec/3600) + 'h ago';
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      <div style={{display:'grid',gridTemplateColumns:'4px 90px 1fr 100px 70px 60px 60px',gap:12,alignItems:'center',padding:'2px 12px 6px'}}>
        <span/>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em'}}>ID</span>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em'}}>DESCRIPTION</span>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em'}}>SEV</span>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em',textAlign:'right'}}>AGENT</span>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em',textAlign:'right'}}>TIME</span>
        <span className="mono tiny" style={{color:'var(--ink-4)',letterSpacing:'.12em',textAlign:'right'}}>ML</span>
      </div>
      {show.map(function(inc,i){
        var mlConf = inc.ml_confidence;
        var mlText = '—';
        var mlColor = 'var(--ink-3)';
        if (typeof mlConf === 'number') {
          mlText = Math.round(mlConf * 100) + '%';
          mlColor = mlConf > 0.8 ? 'var(--ok)' : mlConf > 0.5 ? 'var(--warn)' : 'var(--crit)';
        }
        return (
          <div key={inc.id} style={{
            display:'grid',gridTemplateColumns:'4px 90px 1fr 100px 70px 60px 60px',gap:12,alignItems:'center',
            padding:'10px 12px',borderRadius:8,background:'oklch(0.20 0.025 252 / .6)',
            borderLeft:'3px solid '+sevColor[inc.sev],
            animation: i===0 ? 'slidein .5s ease both' : 'none',
          }}>
            <span style={{background:sevColor[inc.sev],width:4,height:24,borderRadius:99}}/>
            <span className="mono tiny" style={{color:'var(--ink-3)'}}>{inc.id}</span>
            <span style={{fontSize:13,color:'var(--ink)'}}>{inc.desc}</span>
            <span className="tag" style={{color:sevColor[inc.sev],borderColor:'color-mix(in oklab,'+sevColor[inc.sev]+' 40%,transparent)'}}>{inc.sev}</span>
            <span className="mono tiny" style={{color:'var(--ink-3)',textAlign:'right'}}>{inc.agent}</span>
            <span className="mono tiny" style={{color:'var(--ink-3)',textAlign:'right'}}>{fmtAgo(inc.ts)}</span>
            <span className="mono tiny" style={{color:mlColor,textAlign:'right',fontWeight:typeof mlConf==='number'?600:400}}>{mlText}</span>
          </div>
        );
      })}
    </div>
  );
}

function OverviewPage(){
  var hqData = useHQ();
  var counts = hqData.counts;
  var threat_level = hqData.threat_level;
  var agents = hqData.agents;
  var correlations_active = hqData.correlations_active;
  var commands_issued = hqData.commands_issued;
  var ai = hqData.ai;

  // agent_health is the primary health source (raw from /status); agents array is fallback
  var agentHealthRaw = hqData.agent_health ? hqData.agent_health : {};
  var healthMap = {};
  var ahRawKeys = Object.keys(agentHealthRaw);
  for (var ahk = 0; ahk < ahRawKeys.length; ahk++) {
    var ahEntry = agentHealthRaw[ahRawKeys[ahk]];
    healthMap[ahRawKeys[ahk]] = ahEntry && ahEntry.healthy === true;
  }
  for (var hmi = 0; hmi < agents.length; hmi++) {
    if (healthMap[agents[hmi].id] === undefined) {
      healthMap[agents[hmi].id] = agents[hmi].healthy === true;
    }
  }

  // Merge BASE_AGENTS + any dynamic agents from agent_health and agents array
  var allAgents = BASE_AGENTS.slice();
  var baseIdMap = {};
  for (var bim = 0; bim < BASE_AGENTS.length; bim++) {
    baseIdMap[BASE_AGENTS[bim].id] = true;
  }
  var ahDynKeys = Object.keys(agentHealthRaw);
  for (var dhi = 0; dhi < ahDynKeys.length; dhi++) {
    if (!baseIdMap[ahDynKeys[dhi]]) {
      var dId = ahDynKeys[dhi];
      var isNdrD = dId.indexOf('ndr-') === 0;
      var isEdrD = dId.indexOf('edr-') === 0;
      var dIcon = isNdrD ? 'NDR' : isEdrD ? 'EDR' : dId.slice(0, 3).toUpperCase();
      var dColor = (isNdrD || isEdrD) ? 'var(--cyan)' : 'var(--ink-3)';
      var dShortId = (isNdrD || isEdrD) ? dId.slice(-5) : null;
      allAgents.push({ id: dId, icon: dIcon, color: dColor, shortId: dShortId });
      baseIdMap[dId] = true;
    }
  }
  for (var dai = 0; dai < agents.length; dai++) {
    if (!baseIdMap[agents[dai].id]) {
      var dId2 = agents[dai].id;
      var isNdrD2 = dId2.indexOf('ndr-') === 0;
      var isEdrD2 = dId2.indexOf('edr-') === 0;
      var dIcon2 = isNdrD2 ? 'NDR' : isEdrD2 ? 'EDR' : dId2.slice(0, 3).toUpperCase();
      var dColor2 = (isNdrD2 || isEdrD2) ? 'var(--cyan)' : 'var(--ink-3)';
      var dShortId2 = (isNdrD2 || isEdrD2) ? dId2.slice(-5) : null;
      allAgents.push({ id: dId2, icon: dIcon2, color: dColor2, shortId: dShortId2 });
      baseIdMap[dId2] = true;
    }
  }

  var overviewTotal = allAgents.length;
  var overviewHealthy = 0;
  for (var oh = 0; oh < allAgents.length; oh++) {
    if (healthMap[allAgents[oh].id] === true) overviewHealthy++;
  }
  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}>
      {/* Alert banner */}
      <div className="card bracket-card" style={{padding:'10px 16px',display:'flex',alignItems:'center',gap:14,
        borderColor:threat_level==='CRITICAL'?'var(--crit)':'var(--line)',
        background: threat_level==='CRITICAL' ? 'color-mix(in oklab, var(--crit) 8%, var(--surface))' : ''}}>
        <span className="live-dot">SYSTEM</span>
        <span className="mono tiny" style={{color:'var(--ink-3)'}}>central-manager-01 · mass-hq · VLAN 12</span>
        <div className="flex-1"/>
        <span className="tiny c-ink2">last sync</span>
        <span className="mono tiny c-cyan">live</span>
      </div>

      {/* Row 1: Threat light + severity cards */}
      <div style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:18}}>
        <Section title="Threat Level" kicker="LIVE STATE" scan={false}>
          <div style={{display:'flex',justifyContent:'center',padding:'10px 0 4px'}}>
            <TrafficLight/>
          </div>
          <hr className="sep"/>
          <div className="between">
            <span className="tiny c-ink3">Composite confidence</span>
            <span className="num c-cyan">{(ai.confidence*100).toFixed(1)}%</span>
          </div>
          <div style={{height:4,background:'var(--surface-2)',borderRadius:99,marginTop:8}}>
            <div style={{width:(ai.confidence*100)+'%',height:'100%',background:'var(--cyan)',borderRadius:99,boxShadow:'0 0 10px var(--cyan)'}}/>
          </div>
        </Section>
        <div style={{display:'grid',gap:14}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:14}}>
            <SeverityKPI label="Critical" count={counts.critical} total={counts.total} color="var(--crit)"/>
            <SeverityKPI label="High"     count={counts.high}     total={counts.total} color="var(--hi)"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:14}}>
            <Section title="Incident Rate" kicker="msgs / 60s window" right={<span className="tag c-cyan">LIVE</span>}>
              <IncidentRateChart/>
            </Section>
            <Section title="By Domain" kicker="Incident split">
              <DomainDonut/>
            </Section>
          </div>
        </div>
      </div>

      {/* Row 2 */}
      <div style={{display:'grid',gridTemplateColumns:'1.4fr 1fr',gap:18}}>
        <Section title="Recent Incidents" kicker="Live feed" right={<span className="tag c-crit">CRITICAL</span>}>
          <RecentIncidents/>
        </Section>
        <Section title={'Agent Health · ' + overviewTotal + ' Nodes'} kicker="Honeycomb grid" right={<span className="tag c-ok">{overviewHealthy}/{overviewTotal} ALIVE</span>}>
          <div style={{display:'flex',gap:18,alignItems:'flex-start'}}>
            <Honeycomb allAgents={allAgents} healthMap={healthMap}/>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:6,fontSize:11,minWidth:0}}>
              {allAgents.map(function(a){
                var up = healthMap[a.id] === true;
                var col = up ? 'var(--ok)' : 'var(--crit)';
                return (
                  <div key={a.id} className="between" style={{borderBottom:'1px dashed var(--line-2)',paddingBottom:4}}>
                    <span className="mono" style={{fontSize:11,color:'var(--ink-2)'}}>{a.shortId ? (a.icon + ' ' + a.shortId) : a.id}</span>
                    <span className="tag" style={{color:col,borderColor:'color-mix(in oklab,'+col+' 35%,transparent)'}}>{up?'LIVE':'DOWN'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

Object.assign(window,{ OverviewPage, useTween, Counter });
