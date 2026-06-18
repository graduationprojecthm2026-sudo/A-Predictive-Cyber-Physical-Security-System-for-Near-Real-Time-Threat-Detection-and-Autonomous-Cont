// Behavioral Timeline: "Live Alert Throughput"

function Sparkline({data,color,h=28,w=120}){
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max-min || 1;
  const pts = data.map((d,i)=>[(i/(data.length-1))*w, h - ((d-min)/range)*h]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{display:'block'}}>
      <defs>
        <linearGradient id={"sp"+color} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".5"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={`M 0 ${h} L `+pts.map(p=>p.join(' ')).join(' L ')+` L ${w} ${h} Z`} fill={`url(#sp${color})`}/>
      <path d={'M '+pts.map(p=>p.join(' ')).join(' L ')} stroke={color} strokeWidth="1.4" fill="none"
        style={{filter:`drop-shadow(0 0 4px ${color})`}}/>
    </svg>
  );
}

function HeartbeatMonitor(){
  const { t, throughput } = useHQ();
  const [hist,setHist] = React.useState(()=>Array.from({length:90},()=>({
    ndr:0, edr:0, iot:0, pac:0
  })));
  React.useEffect(()=>{
    setHist(h=>{
      const next = h.slice(1);
      next.push({ ndr: throughput.ndr, edr: throughput.edr, iot: throughput.iot, pac: throughput.pac });
      return next;
    });
  },[t]);

  const W = 980, H = 320, P = 28;
  var dataMax = 0;
  for (var tmi = 0; tmi < hist.length; tmi++) {
    if (hist[tmi].n > dataMax) dataMax = hist[tmi].n;
    if (hist[tmi].e > dataMax) dataMax = hist[tmi].e;
    if (hist[tmi].i > dataMax) dataMax = hist[tmi].i;
    if (hist[tmi].p > dataMax) dataMax = hist[tmi].p;
  }
  var max = Math.max(dataMax * 1.2, 1);
  const x = (i)=> P + (i/(hist.length-1))*(W-2*P);
  const y = (v)=> H - P - (v/max)*(H-2*P);
  const series = [
    { key:'ndr', color:'var(--cyan)',   label:'NDR · Network Detection',  current: throughput.ndr },
    { key:'edr', color:'var(--violet)', label:'EDR · Endpoint Detection', current: throughput.edr },
    { key:'iot', color:'var(--ok)',     label:'IoT · Gateway readings',   current: throughput.iot },
    { key:'pac', color:'var(--warn)',   label:'PAC · Access events',      current: throughput.pac },
  ];

  return (
    <div style={{position:'relative'}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:H,display:'block'}}>
        <defs>
          {series.map(s=>(
            <linearGradient key={s.key} id={'h-'+s.key} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity=".5"/>
              <stop offset="100%" stopColor={s.color} stopOpacity="0"/>
            </linearGradient>
          ))}
        </defs>

        {[0,1,2,3,4].map(i=>(
          <line key={i} x1={P} x2={W-P} y1={P + i*((H-2*P)/4)} y2={P + i*((H-2*P)/4)} stroke="var(--line)" opacity=".4"/>
        ))}

        {series.map(s=>{
          const pts = hist.map((d,i)=>[x(i), y(d[s.key])]);
          const area = `M ${pts[0][0]} ${H-P} ` + pts.map(p=>`L ${p[0]} ${p[1]}`).join(' ') + ` L ${pts[pts.length-1][0]} ${H-P} Z`;
          const line = `M ` + pts.map(p=>`${p[0]} ${p[1]}`).join(' L ');
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#h-${s.key})`}/>
              <path d={line} stroke={s.color} strokeWidth="1.6" fill="none" style={{filter:`drop-shadow(0 0 6px ${s.color})`}}/>
              <circle cx={x(hist.length-1)} cy={y(hist[hist.length-1][s.key])} r="4" fill={s.color}
                style={{filter:`drop-shadow(0 0 6px ${s.color})`}}/>
            </g>
          );
        })}


        <line x1={x(hist.length-1)} x2={x(hist.length-1)} y1={P} y2={H-P} stroke="var(--cyan)" opacity=".6"/>
        <text x={x(hist.length-1)-6} y={P+12} fill="var(--cyan)" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">NOW</text>
      </svg>

      {/* Particles at the NOW marker */}
      <div style={{position:'absolute',right:'2.5%',top:0,bottom:0,width:24,pointerEvents:'none'}}>
        {[0,1,2,3,4].map(i=>(
          <div key={i} style={{
            position:'absolute',bottom:0,left:Math.random()*16,
            width:3,height:3,borderRadius:99,background:'var(--cyan)',boxShadow:'0 0 8px var(--cyan)',
            animation:`floaty 2.4s ${i*0.4}s infinite`
          }}/>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginTop:14}}>
        {series.map(s=>(
          <div key={s.key} className="card" style={{padding:12}}>
            <div className="between">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:8,height:8,borderRadius:99,background:s.color,boxShadow:`0 0 8px ${s.color}`,animation:'pulse 1.4s infinite'}}/>
                <span className="tiny upper" style={{fontSize:10}}>{s.label}</span>
              </div>
              <span className="num" style={{color:s.color,fontWeight:600}}>{Math.round(s.current * 60)}</span>
            </div>
            <div style={{marginTop:8}}>
              <Sparkline data={hist.slice(-30).map(d=>d[s.key])} color={s.color} w={200} h={32}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelinePage(){
  var hqData = useHQ();
  var anomalySpike = hqData.anomalySpike;
  var throughput = hqData.throughput;
  var ndrRate = (throughput && typeof throughput.ndr === 'number') ? throughput.ndr.toFixed(0) + ' msg/min' : '0 msg/min';
  var peakRate = Math.max(
    (throughput && throughput.ndr) || 0,
    (throughput && throughput.edr) || 0,
    (throughput && throughput.iot) || 0,
    (throughput && throughput.pac) || 0
  ).toFixed(0) + ' msg/min';
  var domainsActive = [
    (throughput && throughput.ndr),
    (throughput && throughput.edr),
    (throughput && throughput.iot),
    (throughput && throughput.pac)
  ].filter(function(v){ return v && v > 0; }).length + '/4';

  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}
         data-screen-label="Behavioral Timeline">
      <Section
        title="Live Alert Throughput"
        kicker="msgs / min"
        right={
          <div className="row" style={{gap:10}}>
            {anomalySpike && <span className="tag bg-crit" style={{color:'var(--crit)',animation:'pulse 1.4s infinite'}}>⚠ ANOMALY</span>}
            <span className="live-dot">streaming</span>
          </div>
        }
      >
        <HeartbeatMonitor/>
      </Section>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
        {[
          {label:'Mean rate · NDR', v: ndrRate,        c:'var(--cyan)'},
          {label:'Peak rate · 1min', v: peakRate,      c:'var(--hi)'},
          {label:'Domains active',   v: domainsActive, c:'var(--ok)'},
        ].map(s=>(
          <div key={s.label} className="card card-pad">
            <div className="tiny upper" style={{fontSize:10}}>{s.label}</div>
            <div className="num" style={{fontSize:28,color:s.c,fontWeight:600,marginTop:6}}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window,{ TimelinePage, Sparkline });
