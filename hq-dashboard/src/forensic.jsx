// Forensic Collection Agent Dashboard
// Endpoints: /api/8021/health, /api/8021/status, /api/8021/bundles

function ForensicPage(){
  const [status,  setStatus]  = React.useState(null);
  const [bundles, setBundles] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [lastSync,setLastSync]= React.useState(null);
  const [selected,setSelected]= React.useState(null);
  const [trigger, setTrigger] = React.useState(null);
  const [trigRes, setTrigRes] = React.useState(null);

  async function load(){
    try{
      const [sr,br]=await Promise.all([fetch('/api/8021/status'),fetch('/api/8021/bundles')]);
      if(sr.ok){const d=await sr.json();setStatus(d);}
      if(br.ok){const d=await br.json();setBundles(d.bundles||[]);}
      setLastSync(Date.now());
    }catch(e){console.error(e);}
    finally{setLoading(false);}
  }

  React.useEffect(()=>{load();const id=setInterval(load,5000);return()=>clearInterval(id);},[]);

  async function triggerBundle(incidentId){
    if(!incidentId||!incidentId.trim()) return;
    setTrigRes({loading:true});
    try{
      const r=await fetch('/api/8021/bundles/'+encodeURIComponent(incidentId.trim()));
      if(r.ok){const d=await r.json();setTrigRes({ok:true,data:d});}
      else{setTrigRes({ok:false,msg:'No bundle found for: '+incidentId});}
    }catch(e){setTrigRes({ok:false,msg:e.message});}
  }

  function fmtTime(ts){if(!ts)return'never';const d=new Date(ts);if(isNaN(d))return'—';const s=Math.floor((Date.now()-d.getTime())/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
  function fmtBytes(b){if(!b)return'0 B';if(b<1024)return b+' B';if(b<1048576)return Math.round(b/1024)+' KB';return (b/1048576).toFixed(1)+' MB';}
  function sevColor(s){return s==='CRITICAL'?'var(--crit)':s==='HIGH'?'var(--hi)':s==='MEDIUM'?'var(--warn)':'var(--ok)';}

  var alive = status && status.agent_id;
  var th={padding:'9px 14px',textAlign:'left',fontSize:9,letterSpacing:2,textTransform:'uppercase',color:'var(--ink-3)',borderBottom:'1px solid var(--line)'};
  var td={padding:'9px 14px',fontSize:11,borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'};

  if(loading)return <div style={{padding:60,textAlign:'center',color:'var(--ink-3)'}}>Loading forensic agent from /api/8021...</div>;

  return(
    <div style={{paddingBottom:60}}>
      <style>{`@keyframes fa-pulse{0%,100%{opacity:1}50%{opacity:.3}} .fa-row:hover td{background:oklch(0.22 0.025 252/.5);cursor:pointer;} .fa-row{transition:background .15s;}`}</style>

      {/* Header */}
      <div style={{padding:'20px 26px 16px',borderBottom:'1px solid var(--line)',background:'linear-gradient(180deg,oklch(0.18 0.025 252/.5),transparent)'}}>
        <div className="mono tiny" style={{color:'var(--violet)',letterSpacing:3,marginBottom:4,textShadow:'0 0 10px var(--violet)'}}>FORENSIC · EVIDENCE COLLECTION</div>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <h2 style={{margin:0,fontSize:24,fontWeight:700,color:'var(--ink)'}}>Forensic Collection Agent</h2>
          <span style={{display:'flex',alignItems:'center',gap:6,fontSize:9,color:alive?'var(--ok)':'var(--crit)',letterSpacing:2}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:alive?'var(--ok)':'var(--crit)',display:'inline-block',animation:'fa-pulse 2s infinite',boxShadow:`0 0 6px ${alive?'var(--ok)':'var(--crit)'}`}}/>
            {alive?'LIVE · '+status.agent_id:'OFFLINE'}
          </span>
        </div>
        <div className="mono tiny" style={{color:'var(--ink-3)',marginTop:4}}>/api/8021 · Kafka replay evidence · ZIP bundles · refresh 10s{lastSync?' · synced '+fmtTime(lastSync):''}</div>
      </div>

      {/* Stats */}
      <div style={{display:'flex',gap:10,padding:'14px 26px',borderBottom:'1px solid var(--line)',flexWrap:'wrap'}}>
        {[
          {l:'Agent',       v:(status && status.agent_id)?'RUNNING':'OFFLINE', c:alive?'var(--ok)':'var(--crit)',big:true},
          {l:'Incidents In', v:(status && status.incidents_received)||0,       c:'var(--cyan)'},
          {l:'Bundles Created',v:(status && status.bundles_created)||0,        c:'var(--violet)'},
          {l:'Bundles on Disk',v:(status && status.bundles_on_disk)||0,        c:'var(--hi)'},
          {l:'Errors',      v:(status && status.collection_errors)||0,         c:(status && status.collection_errors)>0?'var(--crit)':'var(--ok)'},
          {l:'Integrity',   v:'SHA-256',                                        c:'var(--ok)'},
        ].map(x=>(
          <div key={x.l} style={{padding:'8px 16px',borderRadius:8,minWidth:100,
            background:'oklch(0.20 0.025 252/.6)',
            border:`1px solid color-mix(in oklab,${x.c} 20%,var(--line))`,
            boxShadow:`0 0 10px color-mix(in oklab,${x.c} 8%,transparent)`}}>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div>
            <div style={{fontSize:x.big?12:20,fontWeight:700,color:x.c,lineHeight:1}}>{x.v}</div>
          </div>
        ))}
        {status&&(
          <div style={{padding:'8px 16px',borderRadius:8,background:'oklch(0.20 0.025 252/.6)',border:'1px solid var(--line)'}}>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>BUNDLE DIRECTORY</div>
            <div className="mono" style={{fontSize:10,color:'var(--ink-2)'}}>{status.bundle_directory}</div>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginTop:2}}>{status.collection_method}</div>
          </div>
        )}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center'}}>
          <button className="btn" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* How it works */}
      <div style={{margin:'16px 26px',padding:16,borderRadius:10,
        background:'color-mix(in oklab,var(--violet) 6%,oklch(0.18 0.022 252))',
        border:'1px solid color-mix(in oklab,var(--violet) 20%,transparent)'}}>
        <div className="mono tiny" style={{color:'var(--violet)',marginBottom:8,letterSpacing:2}}>HOW IT WORKS</div>
        <div style={{display:'flex',gap:0,flexWrap:'wrap'}}>
          {[
            {n:'1',t:'HIGH/CRITICAL incident arrives on hq.incidents Kafka topic'},
            {n:'2',t:'Agent replays Kafka topics: data.alerts, iot.alerts, pac.alerts, ti.enriched, soar.commands'},
            {n:'3',t:'Filters messages by time window (±5 min) and affected host IPs'},
            {n:'4',t:'Packages all evidence into a timestamped ZIP bundle on disk'},
          ].map((s,i)=>(
            <div key={s.n} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'6px 14px 6px 0',flex:'1 1 240px'}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:'color-mix(in oklab,var(--violet) 20%,transparent)',border:'1px solid color-mix(in oklab,var(--violet) 40%,transparent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'var(--violet)',flexShrink:0}}>{s.n}</div>
              <div style={{fontSize:11,color:'var(--ink-2)',lineHeight:1.5,paddingTop:4}}>{s.t}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bundle lookup */}
      <div style={{margin:'0 26px 20px',padding:16,borderRadius:10,
        background:'oklch(0.20 0.025 252/.8)',border:'1px solid var(--line)'}}>
        <div className="mono tiny" style={{color:'var(--cyan)',letterSpacing:3,marginBottom:12}}>🔍 BUNDLE LOOKUP: CHECK BY INCIDENT ID</div>
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <input value={trigger||''} onChange={e=>setTrigger(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&triggerBundle(trigger)}
            placeholder="Enter incident ID e.g. INC-DATA-74B681AA..."
            style={{flex:1,background:'oklch(0.16 0.020 252)',border:'1px solid var(--line)',borderRadius:8,color:'var(--ink)',padding:'9px 14px',fontSize:12,fontFamily:'var(--font-mono)',outline:'none'}}/>
          <button onClick={()=>triggerBundle(trigger)}
            style={{padding:'9px 20px',borderRadius:8,fontSize:12,fontWeight:700,background:'color-mix(in oklab,var(--cyan) 15%,transparent)',border:'1px solid color-mix(in oklab,var(--cyan) 40%,transparent)',color:'var(--cyan)',cursor:'pointer',fontFamily:'inherit'}}>
            LOOKUP
          </button>
        </div>
        {/* Quick pick from recent incidents */}
        {bundles.length>0&&(
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span className="mono tiny" style={{color:'var(--ink-3)'}}>Recent:</span>
            {bundles.slice(0,4).map(b=>(
              <button key={b.incident_id} onClick={()=>{setTrigger(b.incident_id);triggerBundle(b.incident_id);}}
                style={{fontSize:9,padding:'2px 8px',borderRadius:99,cursor:'pointer',background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',color:'var(--ink-3)',fontFamily:'var(--font-mono)'}}>
                {b.incident_id}
              </button>
            ))}
          </div>
        )}
        {trigRes&&!trigRes.loading&&(
          <div style={{marginTop:12,padding:12,borderRadius:8,
            background:trigRes.ok?'color-mix(in oklab,var(--ok) 8%,transparent)':'color-mix(in oklab,var(--crit) 8%,transparent)',
            border:`1px solid ${trigRes.ok?'color-mix(in oklab,var(--ok) 25%,transparent)':'color-mix(in oklab,var(--crit) 25%,transparent)'}`}}>
            {trigRes.ok?(
              <div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--ok)',marginBottom:8}}>✓ Bundle Found</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:6}}>
                  {[{l:'Incident',v:trigRes.data.incident_id},{l:'Severity',v:trigRes.data.severity||'—'},{l:'Alert Type',v:trigRes.data.alert_type||'—'},{l:'Host',v:trigRes.data.host_id||'—'},{l:'Size',v:fmtBytes(trigRes.data.bundle_size)},{l:'Created',v:trigRes.data.created_at?fmtTime(trigRes.data.created_at):'—'}].map(x=>(
                    <div key={x.l} style={{background:'oklch(0.18 0.022 252)',borderRadius:5,padding:'6px 10px'}}>
                      <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div>
                      <div className="mono" style={{fontSize:11,color:'var(--ink)',wordBreak:'break-all'}}>{x.v}</div>
                    </div>
                  ))}
                </div>
                {trigRes.data.files&&(
                  <div style={{marginTop:8}}>
                    <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>BUNDLE CONTENTS</div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {trigRes.data.files.map(f=><span key={f} style={{fontSize:9,padding:'2px 8px',borderRadius:99,background:'color-mix(in oklab,var(--ok) 10%,transparent)',border:'1px solid color-mix(in oklab,var(--ok) 25%,transparent)',color:'var(--ok)',fontFamily:'var(--font-mono)'}}>{f}</span>)}
                    </div>
                  </div>
                )}
              </div>
            ):(
              <div style={{fontSize:12,color:'var(--crit)'}}>{trigRes.msg}</div>
            )}
          </div>
        )}
      </div>

      {/* Bundles table */}
      <div style={{padding:'0 26px'}}>
        <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:12,letterSpacing:2}}>
          EVIDENCE BUNDLES · {bundles.length} TOTAL · AUTO-COLLECTED ON HIGH/CRITICAL INCIDENTS
        </div>
        {bundles.length===0?(
          <div style={{padding:'40px 20px',textAlign:'center',borderRadius:10,
            background:'oklch(0.18 0.022 252/.5)',border:'1px solid var(--line)'}}>
            <div style={{fontSize:28,marginBottom:8}}>📦</div>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>NO BUNDLES YET</div>
            <div style={{fontSize:11,color:'var(--ink-3)',maxWidth:400,margin:'0 auto',lineHeight:1.6}}>
              Bundles are automatically created when HIGH or CRITICAL incidents arrive on the hq.incidents Kafka topic. When the attack scenario runs, bundles will appear here.
            </div>
          </div>
        ):(
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'oklch(0.18 0.022 252/.5)'}}>
                {['Severity','Incident ID','Alert Type','Host','Bundle Size','SHA-256','Created','Actions'].map(h=>(
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bundles.map(function(b){
                var isExp=selected===b.incident_id;
                var sc=sevColor(b.severity);
                var sha=b.sha256 ? b.sha256.slice(0,16)+'...' : '—';
                return(
                  <React.Fragment key={b.incident_id||b.filename}>
                    <tr className="fa-row" onClick={function(){setSelected(isExp?null:b.incident_id);}}>
                      <td style={td}>
                        <span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:9,fontWeight:700,textTransform:'uppercase',color:sc,border:'1px solid color-mix(in oklab,'+sc+' 35%,transparent)',background:'color-mix(in oklab,'+sc+' 10%,transparent)'}}>
                          {b.severity||'—'}
                        </span>
                      </td>
                      <td className="mono" style={{padding:'9px 14px',fontSize:10,color:'var(--ink-3)',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>{b.incident_id||'—'}</td>
                      <td style={{padding:'9px 14px',fontSize:10,color:'var(--ink-2)',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>{b.alert_type?(b.alert_type.split('_').map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(' ')):'—'}</td>
                      <td className="mono" style={{padding:'9px 14px',fontSize:11,borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>{b.host_id||'—'}</td>
                      <td className="mono" style={{padding:'9px 14px',fontSize:10,color:'var(--violet)',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>{fmtBytes(b.size_bytes)}</td>
                      <td className="mono" style={{padding:'9px 14px',fontSize:9,color:'var(--ink-3)',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle',letterSpacing:'.03em'}}>{sha}</td>
                      <td className="mono" style={{padding:'9px 14px',fontSize:10,color:'var(--ink-3)',whiteSpace:'nowrap',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>{fmtTime(b.created_at)}</td>
                      <td style={td}>
                        <button onClick={function(e){e.stopPropagation();setTrigger(b.incident_id);triggerBundle(b.incident_id);}}
                          style={{fontSize:9,padding:'3px 10px',borderRadius:4,cursor:'pointer',background:'color-mix(in oklab,var(--cyan) 12%,transparent)',border:'1px solid color-mix(in oklab,var(--cyan) 30%,transparent)',color:'var(--cyan)',fontFamily:'var(--font-mono)'}}>
                          INSPECT
                        </button>
                      </td>
                    </tr>
                    {isExp&&(
                      <tr style={{background:'color-mix(in oklab,var(--violet) 4%,transparent)'}}>
                        <td colSpan={8} style={{padding:'14px 20px',borderBottom:'1px solid color-mix(in oklab,var(--violet) 15%,transparent)'}}>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
                            {[{l:'Filename',v:b.filename},{l:'Incident ID',v:b.incident_id},{l:'Severity',v:b.severity||'—'},{l:'Alert Type',v:b.alert_type||'—'},{l:'Host',v:b.host_id||'—'},{l:'Size',v:fmtBytes(b.size_bytes)},{l:'SHA-256',v:b.sha256||'—'},{l:'Created',v:b.created_at}].map(function(x){return(
                              <div key={x.l} style={{background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',borderRadius:6,padding:'7px 10px'}}>
                                <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div>
                                <div className="mono" style={{fontSize:11,color:'var(--ink)',wordBreak:'break-all'}}>{x.v}</div>
                              </div>
                            );})}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
Object.assign(window,{ForensicPage});