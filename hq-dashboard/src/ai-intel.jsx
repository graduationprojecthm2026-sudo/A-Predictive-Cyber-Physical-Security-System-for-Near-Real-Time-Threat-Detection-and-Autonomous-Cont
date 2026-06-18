// AI Intelligence Layer: "Neural Command Center"

function NeuralNetBG(){
  const { t } = useHQ();
  const nodes = React.useMemo(()=>{
    const out = [];
    const layers = [4,6,6,4];
    let xAcc = 8;
    layers.forEach((n,li)=>{
      for (let i=0;i<n;i++){
        out.push({ x: xAcc, y: 12 + (i+0.5)*(76/n), li, i });
      }
      xAcc += (84/(layers.length-1));
    });
    return out;
  },[]);
  const edges = [];
  for (let i=0;i<nodes.length;i++){
    for (let j=0;j<nodes.length;j++){
      if (nodes[j].li === nodes[i].li+1) edges.push([nodes[i],nodes[j]]);
    }
  }
  return (
    <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:.45,pointerEvents:'none'}}>
      {edges.map((e,i)=>{
        const live = (Math.sin(t/3 + i)+1)/2 > .7;
        return <line key={i} x1={e[0].x} y1={e[0].y} x2={e[1].x} y2={e[1].y}
          stroke={live?'var(--cyan)':'var(--line-2)'} strokeWidth={live?.18:.08} opacity={live?.7:.3}/>;
      })}
      {nodes.map((n,i)=>{
        const lit = (Math.sin(t/2 + i*1.3)+1)/2 > .6;
        return <circle key={i} cx={n.x} cy={n.y} r={lit?1.2:.7}
          fill={lit?'var(--cyan)':'var(--violet)'}
          style={{filter:lit?'drop-shadow(0 0 1.5px var(--cyan))':''}}/>;
      })}
    </svg>
  );
}

function RadialGauge({label,value,max=1,color,unit=''}){
  const v = useTween(value, 700);
  const pct = Math.min(1, v/max);
  const start = -Math.PI*0.85, end = Math.PI*-0.15;
  const ang = start + (end-start)*pct;
  const cx=80,cy=80,r=58;
  const tickArc = (sa,ea,rad)=>{
    const x1 = cx+rad*Math.cos(sa), y1=cy+rad*Math.sin(sa);
    const x2 = cx+rad*Math.cos(ea), y2=cy+rad*Math.sin(ea);
    return `M ${x1} ${y1} A ${rad} ${rad} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <div style={{position:'relative',width:160,height:120}}>
      <svg viewBox="0 0 160 130" width="160" height="130">
        <path d={tickArc(start,end,r)} stroke="var(--surface-2)" strokeWidth="8" fill="none" strokeLinecap="round"/>
        <path d={tickArc(start,ang,r)} stroke={color} strokeWidth="8" fill="none" strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 8px ${color})`}}/>
        <line x1={cx} y1={cy} x2={cx+r*0.9*Math.cos(ang)} y2={cy+r*0.9*Math.sin(ang)}
          stroke={color} strokeWidth="2" strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${color})`}}/>
        <circle cx={cx} cy={cy} r="5" fill="var(--bg)" stroke={color} strokeWidth="1.5"/>
        <text x={cx} y={cy+30} textAnchor="middle" fill="var(--ink)" fontSize="22" fontWeight="600" fontFamily="JetBrains Mono">
          {typeof value === 'number' && value < 10 ? value.toFixed(2) : Math.round(value)}{unit}
        </text>
      </svg>
      <div className="tiny upper text-center" style={{color:'var(--ink-3)',marginTop:-6}}>{label}</div>
    </div>
  );
}

function MitreRadar(){
  const { mitre } = useHQ();
  const cx=160, cy=160, R=120;
  const n = mitre.length;
  const pt = (i, r) => {
    const a = -Math.PI/2 + (i/n)*Math.PI*2;
    return [cx + Math.cos(a)*r, cy + Math.sin(a)*r];
  };
  const rings = [.25,.5,.75,1];
  const dataPts = mitre.map((m,i)=>pt(i, R*m.coverage));
  return (
    <svg viewBox="0 0 320 320" style={{width:'100%',height:320}}>
      <defs>
        <radialGradient id="radar-fill">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity=".6"/>
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity=".05"/>
        </radialGradient>
      </defs>
      {rings.map(r=>(
        <polygon key={r} points={mitre.map((_,i)=>pt(i,R*r).join(',')).join(' ')}
          fill="none" stroke="var(--line-2)" strokeOpacity={.5} strokeWidth=".8"/>
      ))}
      {mitre.map((m,i)=>{
        const [x,y]=pt(i,R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth=".8"/>;
      })}
      <polygon points={dataPts.map(p=>p.join(',')).join(' ')} fill="url(#radar-fill)"
        stroke="var(--cyan)" strokeWidth="2" style={{filter:'drop-shadow(0 0 8px var(--cyan))'}}/>
      {dataPts.map((p,i)=>(
        <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="var(--cyan)" style={{filter:'drop-shadow(0 0 4px var(--cyan))'}}/>
      ))}
      {mitre.map((m,i)=>{
        const [x,y] = pt(i, R+24);
        return (
          <g key={i}>
            <text x={x} y={y} textAnchor="middle" fill="var(--ink-2)" fontSize="10" fontFamily="JetBrains Mono">{m.name}</text>
            <text x={x} y={y+12} textAnchor="middle" fill="var(--cyan)" fontSize="9" fontFamily="JetBrains Mono">{Math.round(m.coverage*100)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function CorrelationChain(){
  const { t, counts } = useHQ();
  var iotCount = (counts.by_domain && counts.by_domain.iot)            || 0;
  var pacCount = (counts.by_domain && counts.by_domain.physical_access) || 0;
  var netCount = (counts.by_domain && counts.by_domain.data_network)    || 0;

  const flow = [
    { id:'IoT',     color:'var(--ok)',     x:50,  count: iotCount  },
    { id:'PAC',     color:'var(--warn)',   x:200, count: pacCount  },
    { id:'Network', color:'var(--cyan)',   x:350, count: netCount  },
    { id:'HQ',      color:'var(--violet)', x:500, count: '★'      },
  ];
  return (
    <svg viewBox="0 0 560 120" style={{width:'100%',height:120}}>
      {flow.map((n,i)=> i<flow.length-1 && (
        <g key={i}>
          <line x1={n.x+22} y1="60" x2={flow[i+1].x-22} y2="60" stroke="var(--line-2)" strokeWidth="1"/>
          {[0,.25,.5,.75].map(off=>{
            const phase = ((t/12) + off + i*0.1) % 1;
            const cx = (n.x+22) + (flow[i+1].x-22 - (n.x+22))*phase;
            return <circle key={off} cx={cx} cy="60" r="3"
              fill="var(--cyan)" opacity={1-phase*0.6}
              style={{filter:'drop-shadow(0 0 6px var(--cyan))'}}/>;
          })}
        </g>
      ))}
      {flow.map(n=>(
        <g key={n.id}>
          <circle cx={n.x} cy="60" r="22" fill="var(--bg-2)" stroke={n.color} strokeWidth="1.5"
            style={{filter:`drop-shadow(0 0 8px ${n.color})`}}/>
          <text x={n.x} y="56" textAnchor="middle" fill={n.color} fontFamily="JetBrains Mono" fontSize="9" fontWeight="700">{n.id}</text>
          <text x={n.x} y="70" textAnchor="middle" fill={n.color} fontFamily="JetBrains Mono" fontSize="10" fontWeight="600">{n.count}</text>
        </g>
      ))}
    </svg>
  );
}

function ReasoningBox(){
  const { ai, threat_level } = useHQ();
  const isCrit = threat_level==='CRITICAL' || threat_level==='HIGH';
  const color = isCrit ? 'var(--crit)' : 'var(--ok)';
  return (
    <div style={{
      position:'relative',padding:18,borderRadius:12,
      border:`1px solid color-mix(in oklab, ${color} 50%, var(--line))`,
      background:`color-mix(in oklab, ${color} 8%, transparent)`,
      overflow:'hidden',
    }}>
      <div style={{position:'absolute',inset:-2,borderRadius:14,border:`2px solid ${color}`,opacity:.25,
        animation:'pulse 2s infinite',pointerEvents:'none'}}/>
      <div className="between" style={{marginBottom:10}}>
        <div className="tiny upper" style={{color,fontWeight:600}}>Analytical Agent · Session Conclusion</div>
        <div className="mono tiny c-ink3">conf · <span style={{color}}>{(ai.confidence*100).toFixed(0)}%</span></div>
      </div>
      <p style={{margin:0,fontSize:14,lineHeight:1.55,color:'var(--ink)'}}>
        {ai.reasoning}
      </p>
    </div>
  );
}

function AIIntelPage(){
  const { ai, threat_level, correlations_active, agents_healthy, agents_total, counts } = useHQ();

  var sSimProfiles = React.useState(null);
  var simProfiles  = sSimProfiles[0];
  var setSimProfiles = sSimProfiles[1];

  React.useEffect(function(){
    var active = true;
    var doFetch = function() {
      fetch('/api/8008/similarity_profile')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!active) return;
          setSimProfiles((d && d.profiles) ? d.profiles.filter(function(p){ return p.alert_type && p.alert_type.length > 0; }) : []);
        })
        .catch(function() { if (active) setSimProfiles([]); });
    };
    doFetch();
    var id = setInterval(doFetch, 10000);
    return function() { active = false; clearInterval(id); };
  }, []);

  var iotCount = (counts.by_domain && counts.by_domain.iot)            || 0;
  var pacCount = (counts.by_domain && counts.by_domain.physical_access) || 0;
  var netCount = (counts.by_domain && counts.by_domain.data_network)    || 0;

  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18,position:'relative'}}
         data-screen-label="AI Intelligence · Neural Command Center">
      <div style={{position:'absolute',inset:0,opacity:.35,pointerEvents:'none'}}>
        <NeuralNetBG/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18,position:'relative'}}>
        <Section title="Live KPI Gauges" kicker="Analytical Agent · 8006/health">
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,justifyItems:'center'}}>
            <RadialGauge label="Correlations"  value={ai.correlations_fired}    max={50}  color="var(--crit)"/>
            <RadialGauge label="Incidents"     value={ai.sessions}              max={200} color="var(--cyan)"/>
            <RadialGauge label="Techniques"    value={ai.techniques_detected}   max={30}  color="var(--violet)"/>
            <RadialGauge label="IoT Bridges"   value={ai.unknown_similarities}  max={20}  color="var(--warn)"/>
            <RadialGauge label="Confidence"    value={ai.confidence*100}        max={100} color="var(--ok)" unit="%"/>
            <RadialGauge label="Active Agents" value={agents_healthy}           max={agents_total} color="var(--hi)"/>
          </div>
        </Section>
        <Section title="MITRE ATT&CK Coverage" kicker="Tactic radar · 10-stage kill-chain">
          <MitreRadar/>
        </Section>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr',gap:18,position:'relative'}}>
        <Section title="Multi-Domain Correlation Chain"
          kicker={'Flow · IoT('+iotCount+') → PAC('+pacCount+') → Network('+netCount+')'}
          right={<span className="tag c-cyan">{correlations_active} active</span>}>
          <CorrelationChain/>
          <div className="hairline"></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {[
              {l:'IoT incidents',   v: String(iotCount), c:'var(--ok)'    },
              {l:'PAC incidents',   v: String(pacCount), c:'var(--warn)'  },
              {l:'Network alerts',  v: String(netCount), c:'var(--cyan)'  },
              {l:'HQ correlations', v: String(correlations_active || 0), c:'var(--violet)'},
            ].map(s=>(
              <div key={s.l} style={{padding:10,border:'1px solid var(--line)',borderRadius:8,background:'oklch(0.2 0.025 252 / .6)'}}>
                <div className="tiny upper" style={{fontSize:9}}>{s.l}</div>
                <div className="num" style={{color:s.c,fontWeight:600,fontSize:20,marginTop:4}}>{s.v}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Unknown Technique Similarities" kicker="Live similarity analysis from Learning Agent">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {(!simProfiles || simProfiles.length === 0) ? (
              <div className="tiny c-ink3" style={{padding:'8px 0'}}>
                {simProfiles === null ? 'Loading...' : 'Insufficient data for similarity analysis. Waiting for diverse incident types.'}
              </div>
            ) : simProfiles.map(function(s){
              return (
                <div key={s.alert_type}>
                  <div className="between" style={{marginBottom:4}}>
                    <span className="mono tiny" style={{color:'var(--ink-2)'}}>{s.alert_type} <span style={{color:'var(--ink-4)'}}>({s.sample_count})</span></span>
                    <span className="num c-cyan">{Math.round(s.similarity*100)}%</span>
                  </div>
                  <div style={{height:4,background:'var(--surface-2)',borderRadius:99}}>
                    <div style={{width:(s.similarity*100)+'%',height:'100%',background:'var(--cyan)',borderRadius:99,boxShadow:'0 0 6px var(--cyan)'}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
      <div style={{position:'relative'}}>
        <ReasoningBox/>
      </div>
    </div>
  );
}

Object.assign(window,{ AIIntelPage });
