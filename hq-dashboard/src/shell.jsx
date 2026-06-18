// Sidebar + topbar + small shared atoms

function Logo({collapsed}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'18px 18px 10px'}}>
      <div style={{
        width:32,height:32,borderRadius:8,position:'relative',
        background:'linear-gradient(135deg, var(--cyan), var(--violet))',
        boxShadow:'0 0 18px color-mix(in oklab, var(--cyan) 35%, transparent)'
      }}>
        <div style={{position:'absolute',inset:4,border:'1px solid rgba(0,0,0,.4)',borderRadius:6,
          background:'oklch(0.16 0.025 252)',display:'grid',placeItems:'center',
          color:'var(--cyan)',fontFamily:'JetBrains Mono',fontSize:11,fontWeight:700}}>M</div>
      </div>
      {!collapsed && (
        <div>
          <div className="mono" style={{fontWeight:700,letterSpacing:'.12em',fontSize:13}}>MASS · HQ</div>
          <div className="tiny" style={{marginTop:2}}>Galala University</div>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { group:'OPERATIONS', items:[
    { id:'report',       name:'Report',             icon:'📄' },
    { id:'overview',     name:'Overview',           icon:'📊' },
    { id:'ai',           name:'AI Intelligence',    icon:'🧠', badge:'LIVE' },
    { id:'timeline',     name:'Behavioral Timeline',icon:'📈' },
    { id:'map',          name:'Campus Map',         icon:'🗺️' },
    { id:'correlations', name:'Correlations',       icon:'🕸️' },
    { id:'soar',         name:'SOAR Response',      icon:'⚡' },
    { id:'twin',         name:'Digital Twin',       icon:'🔄' },
  ]},
  { group:'INTEL', items:[
    { id:'incidents',  name:'Incidents',     icon:'🚨' },
    { id:'threats',    name:'Threat Feed',   icon:'📡' },
    { id:'prediction', name:'Prediction',    icon:'🔮' },
    { id:'killchain',  name:'Kill Chain',    icon:'⛓️' },
  ]},
  { group:'SYSTEM', items:[
    { id:'forensic',    name:'Forensic',     icon:'🔬' },
    { id:'topology',    name:'Topology',     icon:'🌐' },
    { id:'compliance',  name:'Compliance',   icon:'✅' },
    { id:'roi',         name:'ROI',          icon:'💰' },
    { id:'tenants',     name:'Tenants',      icon:'🏢' },
    { id:'marketplace', name:'Marketplace',  icon:'🛒' },
  ]},
];

function Sidebar({page,setPage,collapsed,setCollapsed}){
  return (
    <aside className={"sidebar "+(collapsed?'collapsed':'')}>
      <Logo collapsed={collapsed}/>
      <button onClick={()=>setCollapsed(!collapsed)} title="Collapse" style={{
        position:'absolute',right:-12,top:24,width:24,height:24,borderRadius:99,
        border:'1px solid var(--line-2)',background:'var(--bg-2)',color:'var(--ink-2)',cursor:'pointer'
      }}>{collapsed?'›':'‹'}</button>

      <div style={{padding:'8px 10px',overflowY:'auto',maxHeight:'calc(100vh - 80px)'}}>
        {NAV.map(group=>(
          <div key={group.group} style={{marginBottom:18}}>
            {!collapsed && <div className="upper" style={{fontSize:10,color:'var(--ink-4)',padding:'8px 10px'}}>{group.group}</div>}
            {group.items.map(item=>{
              const active = page===item.id;
              return (
                <button key={item.id} onClick={()=>setPage(item.id)} data-screen-label={item.name} style={{
                  width:'100%',display:'flex',alignItems:'center',gap:12,
                  padding: collapsed ? '10px' : '9px 12px',
                  borderRadius:8,border:'1px solid '+(active?'color-mix(in oklab, var(--cyan) 55%, var(--line))':'transparent'),
                  background: active ? 'color-mix(in oklab, var(--cyan) 12%, transparent)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-2)',
                  cursor:'pointer',fontFamily:'inherit',fontSize:13,marginBottom:2,
                  justifyContent: collapsed ? 'center':'flex-start',position:'relative',
                  boxShadow: active ? 'inset 2px 0 0 var(--cyan)' : 'none',
                }}>
                  <span style={{color:active?'var(--cyan)':'var(--ink-3)',fontFamily:'JetBrains Mono',width:14,textAlign:'center'}}>{item.icon}</span>
                  {!collapsed && <span style={{flex:1,textAlign:'left'}}>{item.name}</span>}
                  {!collapsed && item.badge && (
                    <span className="mono" style={{fontSize:9,padding:'2px 6px',borderRadius:99,background:'color-mix(in oklab, var(--ok) 18%, transparent)',color:'var(--ok)',border:'1px solid color-mix(in oklab, var(--ok) 45%, var(--line))'}}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

    </aside>
  );
}

function ThreatBadge(){
  const { threat_level } = useHQ();
  const color = {LOW:'var(--ok)', MEDIUM:'var(--warn)', HIGH:'var(--hi)', CRITICAL:'var(--crit)'}[threat_level];
  return (
    <div className="thr-badge mono" style={{color}}>
      <span className="dot"></span>
      THREAT · {threat_level}
    </div>
  );
}

function Topbar({page}){
  const { agents_healthy, agents_total, commands_issued, correlations_active } = useHQ();
  const navItem = NAV.flatMap(g => g.items).find(it => it.id === page);
  const title = navItem ? navItem.name : page;
  return (
    <div className="topbar">
      <div>
        <div className="tiny upper">MASS · HQ Manager</div>
        <div className="mono tiny" style={{marginTop:2,color:"var(--ink-3)"}}>192.168.12.10</div>
        <h2 style={{fontSize:18,marginTop:2}}>{title}</h2>
      </div>
      <div className="flex-1"></div>

      <div className="row" style={{gap:14}}>
        <Stat label="Agents" value={`${agents_healthy}/${agents_total}`} color={agents_healthy===agents_total?'var(--ok)':'var(--warn)'}/>
        <Stat label="Correlations" value={correlations_active} color="var(--cyan)"/>
        <Stat label="Response Actions" value={commands_issued} color="var(--violet)"/>
      </div>

      <ThreatBadge/>

      <span className="live-dot">LIVE · 5s</span>
    </div>
  );
}

function Stat({label,value,color}){
  return (
    <div style={{padding:'4px 10px',border:'1px solid var(--line)',borderRadius:8,background:'oklch(0.18 0.025 252 / .6)'}}>
      <div className="tiny upper" style={{fontSize:9}}>{label}</div>
      <div className="num" style={{color:color||'var(--ink)',fontWeight:600,fontSize:14,marginTop:1}}>{value}</div>
    </div>
  );
}

function Section({title,kicker,right,children,scan=true}){
  return (
    <div className="card bracket-card">
      {scan && <div className="scanline"><span/></div>}
      <div className="card-pad">
        <div className="between" style={{marginBottom:14}}>
          <div>
            <div className="tiny upper c-cyan" style={{fontSize:10}}>{kicker}</div>
            <h3 style={{fontSize:15,marginTop:4}}>{title}</h3>
          </div>
          <div>{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar, ThreatBadge, Stat, Section, NAV });
