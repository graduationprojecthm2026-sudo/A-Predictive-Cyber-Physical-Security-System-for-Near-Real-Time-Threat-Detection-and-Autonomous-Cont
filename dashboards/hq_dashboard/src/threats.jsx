// Threat Intelligence Feed v2: IOC Lookup + Add IOC + Threat Actors
function ConfBar({value}){
  const color=value>=0.9?'var(--crit)':value>=0.7?'var(--hi)':value>=0.5?'var(--warn)':'var(--ok)';
  return(
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{width:52,height:5,borderRadius:99,background:'oklch(0.20 0.022 252)'}}>
        <div style={{width:(value*100)+'%',height:'100%',borderRadius:99,
          background:`linear-gradient(90deg,${color},color-mix(in oklab,${color} 60%,transparent))`,
          boxShadow:`0 0 6px ${color}`}}/>
      </div>
      <span style={{fontSize:10,fontWeight:700,color,fontFamily:'var(--font-mono)',minWidth:32}}>{Math.round(value*100)}%</span>
    </div>
  );
}
function TypeBadge({type}){
  const cfg={ip:{c:'var(--cyan)'},domain:{c:'var(--hi)'},hash:{c:'var(--violet)'},process:{c:'var(--crit)'},cve:{c:'var(--warn)'}};
  const c=(cfg[type]||{c:'var(--ink-3)'}).c;
  return <span style={{display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:1,color:c,border:`1px solid color-mix(in oklab,${c} 35%,transparent)`,background:`color-mix(in oklab,${c} 10%,transparent)`}}>{(type||'?').toUpperCase()}</span>;
}
function ActorCard({actor,iocs,onSelect,selected}){
  const maxConf=Math.max(...iocs.map(i=>i.confidence||0));
  const color=maxConf>=0.95?'var(--crit)':maxConf>=0.8?'var(--hi)':'var(--warn)';
  const families=[...new Set(iocs.map(i=>i.malware_family).filter(Boolean))];
  const isSel=selected===actor;
  const emoji=actor==='APT28'?'🐻':actor==='APT29'?'🦅':actor==='Lazarus'?'☠':actor==='Multiple'?'⚡':'🎭';
  return(
    <div onClick={()=>onSelect(isSel?null:actor)} style={{padding:16,borderRadius:12,cursor:'pointer',transition:'all .2s',
      background:isSel?`color-mix(in oklab,${color} 12%,oklch(0.20 0.025 252))`:'oklch(0.20 0.025 252 / .8)',
      border:`1px solid ${isSel?color:'var(--line)'}`,
      boxShadow:isSel?`0 0 24px color-mix(in oklab,${color} 25%,transparent)`:'none'}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:10}}>
        <div style={{width:38,height:38,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,
          background:`color-mix(in oklab,${color} 15%,transparent)`,border:`1px solid color-mix(in oklab,${color} 30%,transparent)`}}>{emoji}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--ink)',marginBottom:2}}>{actor}</div>
          <div style={{fontSize:10,color:'var(--ink-3)'}}>{iocs.length} IOCs · max {Math.round(maxConf*100)}% conf</div>
        </div>
        <div style={{fontSize:22,fontWeight:700,color,lineHeight:1}}>{iocs.length}</div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
        {families.slice(0,4).map(f=><span key={f} style={{fontSize:9,padding:'1px 6px',borderRadius:99,background:`color-mix(in oklab,${color} 10%,transparent)`,border:`1px solid color-mix(in oklab,${color} 25%,transparent)`,color}}>{f}</span>)}
      </div>
    </div>
  );
}
function LookupPanel(){
  const [query,setQuery]=React.useState('');
  const [result,setResult]=React.useState(null);
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState(null);
  async function doLookup(q){
    const val=(q||query).trim();
    if(!val) return;
    setQuery(val);setLoading(true);setResult(null);setError(null);
    try{
      for(const t of ['ip','domain','hash','process','cve']){
        const r=await fetch('/api/8009/iocs/lookup?type='+t+'&value='+encodeURIComponent(val));
        if(r.ok){setResult(await r.json());setLoading(false);return;}
      }
      setError('No match found for: '+val);
    }catch(e){setError('Lookup failed: '+e.message);}
    finally{setLoading(false);}
  }
  const color=result?(result.confidence>=0.9?'var(--crit)':result.confidence>=0.7?'var(--hi)':'var(--warn)'):'var(--cyan)';
  return(
    <div style={{padding:20,borderRadius:12,background:'oklch(0.20 0.025 252 / .8)',border:'1px solid var(--line)'}}>
      <div className="mono tiny" style={{color:'var(--cyan)',letterSpacing:3,marginBottom:12,textShadow:'0 0 8px var(--cyan)'}}>🔍 REAL-TIME IOC ENRICHMENT LOOKUP</div>
      <div style={{display:'flex',gap:8,marginBottom:12}}>
        <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doLookup()}
          placeholder="Enter IP, domain, hash, process, CVE..."
          style={{flex:1,background:'oklch(0.16 0.020 252)',border:'1px solid var(--line)',borderRadius:8,color:'var(--ink)',padding:'10px 14px',fontSize:12,fontFamily:'var(--font-mono)',outline:'none'}}/>
        <button onClick={()=>doLookup()} disabled={loading}
          style={{padding:'10px 20px',borderRadius:8,fontSize:12,fontWeight:700,background:'color-mix(in oklab,var(--cyan) 15%,transparent)',border:'1px solid color-mix(in oklab,var(--cyan) 40%,transparent)',color:'var(--cyan)',cursor:'pointer',fontFamily:'inherit',boxShadow:'0 0 12px color-mix(in oklab,var(--cyan) 20%,transparent)'}}>
          {loading?'…':'LOOKUP'}
        </button>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14,alignItems:'center'}}>
        <span style={{fontSize:9,color:'var(--ink-3)'}}>Quick test:</span>
        {['185.220.101.50','mimikatz','CVE-2021-44228','evil-c2.example.com','45.142.212.100'].map(ex=>(
          <button key={ex} onClick={()=>doLookup(ex)}
            style={{fontSize:9,padding:'2px 8px',borderRadius:99,cursor:'pointer',background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',color:'var(--ink-3)',fontFamily:'var(--font-mono)'}}>{ex}</button>
        ))}
      </div>
      {error&&<div style={{padding:'10px 14px',borderRadius:8,background:'color-mix(in oklab,var(--ok) 8%,transparent)',border:'1px solid color-mix(in oklab,var(--ok) 25%,transparent)',color:'var(--ok)',fontSize:12,fontFamily:'var(--font-mono)'}}>✓ CLEAN: {error}</div>}
      {result&&(
        <div style={{padding:16,borderRadius:10,background:`color-mix(in oklab,${color} 8%,transparent)`,border:`1px solid color-mix(in oklab,${color} 30%,transparent)`,boxShadow:`0 0 20px color-mix(in oklab,${color} 12%,transparent)`}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
            <span style={{fontSize:22,animation:'ti-pulse 1s infinite'}}>⚠</span>
            <div><div style={{fontSize:14,fontWeight:700,color,textShadow:`0 0 8px ${color}`}}>IOC MATCH FOUND</div>
              <div style={{fontSize:10,color:'var(--ink-3)'}}>Confidence: {Math.round(result.confidence*100)}%</div></div>
            <TypeBadge type={result.type}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8,marginBottom:10}}>
            {[{l:'Value',v:result.value},{l:'Category',v:(result.category||'').replace(/_/g,' ')},{l:'Threat Actor',v:result.threat_actor||'—'},{l:'Malware',v:result.malware_family||'—'},{l:'Source',v:result.source},{l:'Confidence',v:Math.round(result.confidence*100)+'%'}].map(x=>(
              <div key={x.l} style={{background:'oklch(0.18 0.022 252 / .6)',borderRadius:6,padding:'7px 10px'}}>
                <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div>
                <div className="mono" style={{fontSize:11,color:'var(--ink)',wordBreak:'break-all'}}>{x.v}</div>
              </div>
            ))}
          </div>
          {result.description&&<div style={{padding:'10px 12px',borderRadius:6,background:'oklch(0.16 0.020 252)',fontSize:11,color:'var(--ink-2)',lineHeight:1.6,fontStyle:'italic'}}>"{result.description}"</div>}
        </div>
      )}
    </div>
  );
}
function AddIOCPanel({onAdded}){
  const [form,setForm]=React.useState({type:'ip',value:'',category:'c2',threat_actor:'',malware_family:'',confidence:0.8,source:'manual',description:''});
  const [status,setStatus]=React.useState(null);
  const [loading,setLoading]=React.useState(false);
  function upd(k,v){setForm(function(f){var u=Object.assign({},f);u[k]=v;return u;});}
  async function submit(){
    if(!form.value.trim()){setStatus({ok:false,msg:'IOC value required'});return;}
    setLoading(true);setStatus(null);
    try{
      var formData=Object.assign({},form,{confidence:parseFloat(form.confidence)});
      const r=await fetch('/api/8009/iocs/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(formData)});
      if(r.ok){setStatus({ok:true,msg:'Added: '+form.value});setForm(function(f){var u=Object.assign({},f);u.value='';u.description='';u.threat_actor='';u.malware_family='';return u;});onAdded&&onAdded();}
      else{const d=await r.json();setStatus({ok:false,msg:d.detail||'Failed'});}
    }catch(e){setStatus({ok:false,msg:e.message});}
    finally{setLoading(false);}
  }
  const inp={background:'oklch(0.16 0.020 252)',border:'1px solid var(--line)',borderRadius:6,color:'var(--ink)',padding:'8px 12px',fontSize:12,fontFamily:'var(--font-mono)',outline:'none',width:'100%',boxSizing:'border-box'};
  return(
    <div style={{padding:20,borderRadius:12,background:'oklch(0.20 0.025 252 / .8)',border:'1px solid var(--line)'}}>
      <div className="mono tiny" style={{color:'var(--violet)',letterSpacing:3,marginBottom:14,textShadow:'0 0 8px var(--violet)'}}>➕ ADD NEW IOC: LIVE DATABASE UPDATE</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>TYPE</div>
          <select value={form.type} onChange={e=>upd('type',e.target.value)} style={{...inp,cursor:'pointer'}}>
            {['ip','domain','hash','process','cve'].map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select></div>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>CATEGORY</div>
          <select value={form.category} onChange={e=>upd('category',e.target.value)} style={{...inp,cursor:'pointer'}}>
            {['c2','reconnaissance','credential_attack','credential_theft','exploitation','dns_tunnel','vulnerability','malware_test'].map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
          </select></div>
        <div style={{gridColumn:'1/-1'}}><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>IOC VALUE *</div>
          <input value={form.value} onChange={e=>upd('value',e.target.value)} placeholder="IP, domain, hash, process, CVE..." style={inp}/></div>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>THREAT ACTOR</div>
          <input value={form.threat_actor} onChange={e=>upd('threat_actor',e.target.value)} placeholder="e.g. APT28" style={inp}/></div>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>MALWARE FAMILY</div>
          <input value={form.malware_family} onChange={e=>upd('malware_family',e.target.value)} placeholder="e.g. Cobalt Strike" style={inp}/></div>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>CONFIDENCE: {Math.round(form.confidence*100)}%</div>
          <input type="range" min="0.1" max="1.0" step="0.05" value={form.confidence} onChange={e=>upd('confidence',e.target.value)} style={{width:'100%',accentColor:'var(--violet)'}}/></div>
        <div><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>SOURCE</div>
          <select value={form.source} onChange={e=>upd('source',e.target.value)} style={{...inp,cursor:'pointer'}}>
            {['manual','local','otx','virustotal','misp','nvd'].map(s=><option key={s} value={s}>{s}</option>)}
          </select></div>
        <div style={{gridColumn:'1/-1'}}><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>DESCRIPTION</div>
          <input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Brief description..." style={inp}/></div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button onClick={submit} disabled={loading} style={{padding:'9px 24px',borderRadius:8,fontSize:12,fontWeight:700,background:'color-mix(in oklab,var(--violet) 20%,transparent)',border:'1px solid color-mix(in oklab,var(--violet) 40%,transparent)',color:'var(--violet)',cursor:'pointer',fontFamily:'inherit',boxShadow:'0 0 12px color-mix(in oklab,var(--violet) 20%,transparent)'}}>
          {loading?'Adding…':'ADD TO DATABASE'}
        </button>
        {status&&<div style={{fontSize:11,color:status.ok?'var(--ok)':'var(--crit)',fontFamily:'var(--font-mono)'}}>{status.ok?'✓ ':'✗ '}{status.msg}</div>}
      </div>
    </div>
  );
}
function ThreatFeedPage(){
  const [iocs,setIocs]=React.useState([]);
  const [stats,setStats]=React.useState(null);
  const [status,setStatus]=React.useState(null);
  const [loading,setLoading]=React.useState(true);
  const [lastSync,setLastSync]=React.useState(null);
  const [search,setSearch]=React.useState('');
  const [typeFilter,setTypeFilter]=React.useState('all');
  const [catFilter,setCatFilter]=React.useState('all');
  const [selected,setSelected]=React.useState(null);
  const [actorSel,setActorSel]=React.useState(null);
  const [tab,setTab]=React.useState('iocs');
  async function load(){
    try{
      const [hr,sr,ir]=await Promise.all([fetch('/api/8009/health'),fetch('/api/8009/stats'),fetch('/api/8009/iocs')]);
      if(hr.ok){const d=await hr.json();setStatus(d);}
      if(sr.ok){const d=await sr.json();setStats(d);}
      if(ir.ok){const d=await ir.json();setIocs(d.iocs||[]);}
      setLastSync(Date.now());
    }catch(e){console.error(e);setStatus(null);}
    finally{setLoading(false);}
  }
  React.useEffect(()=>{load();const id=setInterval(load,10000);return()=>clearInterval(id);},[]);
  function fmtTime(ts){if(!ts)return'never';const d=new Date(ts);if(isNaN(d))return'—';const s=Math.floor((Date.now()-d.getTime())/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';}
  const actorGroups=React.useMemo(()=>{const m={};iocs.forEach(i=>{const a=i.threat_actor||'Unknown';if(!m[a])m[a]=[];m[a].push(i);});return Object.entries(m).sort((a,b)=>b[1].length-a[1].length);},[iocs]);
  const types=['all',...Array.from(new Set(iocs.map(i=>i.type).filter(Boolean))).sort()];
  const filtered=React.useMemo(()=>{
    let arr=actorSel?iocs.filter(i=>(i.threat_actor||'Unknown')===actorSel):iocs;
    if(typeFilter!=='all')arr=arr.filter(i=>i.type===typeFilter);
    if(catFilter!=='all')arr=arr.filter(i=>i.category===catFilter);
    if(search.trim()){const q=search.toLowerCase();arr=arr.filter(i=>(i.value||'').toLowerCase().includes(q)||(i.threat_actor||'').toLowerCase().includes(q)||(i.malware_family||'').toLowerCase().includes(q)||(i.description||'').toLowerCase().includes(q));}
    return arr.sort((a,b)=>b.confidence-a.confidence);
  },[iocs,typeFilter,catFilter,search,actorSel]);
  function fmt(t){if(!t)return'—';return t.split('_').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');}
  const th={padding:'9px 14px',textAlign:'left',fontSize:9,letterSpacing:2,textTransform:'uppercase',color:'var(--ink-3)',borderBottom:'1px solid var(--line)'};
  const td={padding:'9px 14px',fontSize:11,borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'};
  const TABS=[{id:'iocs',l:'📋 IOC Database'},{id:'actors',l:'🎭 Threat Actors'},{id:'lookup',l:'🔍 IOC Lookup'},{id:'add',l:'➕ Add IOC'}];
  if(loading)return <div style={{padding:60,textAlign:'center',color:'var(--ink-3)'}}>Loading threat intelligence from /api/8009...</div>;
  if(!loading && !status && iocs.length===0)return <div style={{padding:60,textAlign:'center',color:'var(--crit)',fontFamily:'var(--font-mono)',fontSize:13}}>Threat Intelligence Agent offline. IOC database unavailable</div>;
  return(
    <div style={{paddingBottom:60}}>
      <style>{`@keyframes ti-pulse{0%,100%{opacity:1}50%{opacity:.3}} .ti-row:hover td{background:oklch(0.22 0.025 252/.5);cursor:pointer;} .ti-row{transition:background .15s;} .ti-tab:hover{background:oklch(0.22 0.025 252)!important;} input::placeholder{color:var(--ink-4);} select option{background:oklch(0.18 0.022 252);}`}</style>
      <div style={{padding:'20px 26px 16px',borderBottom:'1px solid var(--line)',background:'linear-gradient(180deg,oklch(0.18 0.025 252/.6),transparent)'}}>
        <div className="mono tiny" style={{color:'var(--cyan)',letterSpacing:3,marginBottom:4,textShadow:'0 0 10px var(--cyan)'}}>INTEL · EXTERNAL CTI FEEDS</div>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <h2 style={{margin:0,fontSize:24,fontWeight:700,color:'var(--ink)'}}>Threat Intelligence</h2>
          <span style={{display:'flex',alignItems:'center',gap:6,fontSize:9,color:'var(--ok)',letterSpacing:2}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:'var(--ok)',display:'inline-block',animation:'ti-pulse 2s infinite',boxShadow:'0 0 6px var(--ok)'}}/>LIVE · ti-agent-hq-01
          </span>
        </div>
        <div className="mono tiny" style={{color:'var(--ink-3)',marginTop:4}}>/api/8009 · SQLite IOC DB · refresh 15s{lastSync?' · synced '+fmtTime(lastSync):''}</div>
      </div>
      <div style={{display:'flex',gap:10,padding:'14px 26px',borderBottom:'1px solid var(--line)',flexWrap:'wrap'}}>
        {[{l:'Agent',v:(status && status.status && status.status.toUpperCase())||'OFFLINE',c:(status && status.status==='running')?'var(--ok)':'var(--crit)',big:true},{l:'Total IOCs',v:(stats && stats.total_iocs)||0,c:'var(--cyan)'},{l:'Enrichments',v:(stats && stats.total_matches)||0,c:'var(--hi)'},{l:'Actors',v:actorGroups.length,c:'var(--warn)'}].map(x=>(
          <div key={x.l} style={{padding:'8px 16px',borderRadius:8,minWidth:90,background:'oklch(0.20 0.025 252/.6)',border:`1px solid color-mix(in oklab,${x.c} 20%,var(--line))`,boxShadow:`0 0 10px color-mix(in oklab,${x.c} 8%,transparent)`}}>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div>
            <div style={{fontSize:x.big?13:20,fontWeight:700,color:x.c,lineHeight:1}}>{x.v}</div>
          </div>
        ))}
        {stats && stats.by_type &&(
          <div style={{padding:'8px 14px',borderRadius:8,display:'flex',gap:14,alignItems:'center',background:'oklch(0.20 0.025 252/.6)',border:'1px solid var(--line)'}}>
            {Object.entries(stats.by_type).map(function(entry){var t=entry[0];var c=entry[1];var cols={ip:'var(--cyan)',domain:'var(--hi)',hash:'var(--violet)',process:'var(--crit)',cve:'var(--warn)'};return(<div key={t} style={{textAlign:'center'}}><div style={{fontSize:16,fontWeight:700,color:cols[t]||'var(--ink-3)'}}>{c}</div><div className="mono tiny" style={{color:'var(--ink-3)'}}>{t.toUpperCase()}</div></div>);})}
          </div>
        )}
        {stats && stats.by_source &&(
          <div style={{padding:'8px 14px',borderRadius:8,display:'flex',gap:14,alignItems:'center',background:'oklch(0.20 0.025 252/.6)',border:'1px solid var(--line)'}}>
            <div className="mono tiny" style={{color:'var(--ink-3)',marginRight:4}}>SOURCES:</div>
            {Object.entries(stats.by_source).map(function(entry){var src=entry[0];var cnt=entry[1];return(<div key={src} style={{textAlign:'center'}}><div style={{fontSize:14,fontWeight:700,color:'var(--ink)'}}>{cnt}</div><div className="mono tiny" style={{color:'var(--ink-3)'}}>{src}</div></div>);})}
          </div>
        )}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center'}}><button className="btn" onClick={load}>↻ Refresh</button></div>
      </div>
      <div style={{display:'flex',gap:4,padding:'10px 26px 0',borderBottom:'1px solid var(--line)'}}>
        {TABS.map(t=>(
          <button key={t.id} className="ti-tab" onClick={()=>setTab(t.id)} style={{background:tab===t.id?'color-mix(in oklab,var(--cyan) 10%,oklch(0.22 0.025 252))':'transparent',border:tab===t.id?'1px solid color-mix(in oklab,var(--cyan) 35%,transparent)':'1px solid transparent',borderBottom:'none',borderRadius:'8px 8px 0 0',color:tab===t.id?'var(--cyan)':'var(--ink-3)',padding:'9px 18px',fontSize:11,fontFamily:'var(--font-mono)',cursor:'pointer',boxShadow:tab===t.id?'0 0 12px color-mix(in oklab,var(--cyan) 15%,transparent)':'none'}}>{t.l}</button>
        ))}
      </div>
      {tab==='iocs'&&(
        <div>
          {stats && stats.by_category &&(
            <div style={{padding:'10px 26px',borderBottom:'1px solid var(--line)',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              <span className="mono tiny" style={{color:'var(--ink-3)',marginRight:4}}>FILTER:</span>
              <button onClick={()=>setCatFilter('all')} style={{fontSize:9,padding:'3px 10px',borderRadius:99,cursor:'pointer',background:catFilter==='all'?'color-mix(in oklab,var(--cyan) 15%,transparent)':'oklch(0.18 0.022 252)',border:`1px solid ${catFilter==='all'?'color-mix(in oklab,var(--cyan) 40%,transparent)':'var(--line)'}`,color:catFilter==='all'?'var(--cyan)':'var(--ink-3)',fontFamily:'var(--font-mono)'}}>ALL ({iocs.length})</button>
              {Object.entries(stats.by_category).sort((a,b)=>b[1]-a[1]).map(([cat,count])=>{const cc={c2:'var(--crit)',reconnaissance:'var(--cyan)',credential_attack:'var(--hi)',vulnerability:'var(--warn)'};const c=cc[cat]||'var(--ink-2)';const active=catFilter===cat;return(<button key={cat} onClick={()=>setCatFilter(active?'all':cat)} style={{fontSize:9,padding:'3px 10px',borderRadius:99,cursor:'pointer',background:active?`color-mix(in oklab,${c} 15%,transparent)`:'oklch(0.18 0.022 252)',border:`1px solid ${active?`color-mix(in oklab,${c} 40%,transparent)`:'var(--line)'}`,color:active?c:'var(--ink-3)',fontFamily:'var(--font-mono)',boxShadow:active?`0 0 8px color-mix(in oklab,${c} 20%,transparent)`:'none'}}>{count} {cat.replace(/_/g,' ')}</button>);})}
              {actorSel&&<button onClick={()=>setActorSel(null)} style={{fontSize:9,padding:'3px 10px',borderRadius:99,cursor:'pointer',background:'color-mix(in oklab,var(--warn) 15%,transparent)',border:'1px solid color-mix(in oklab,var(--warn) 40%,transparent)',color:'var(--warn)',fontFamily:'var(--font-mono)'}}>Actor: {actorSel} ✕</button>}
            </div>
          )}
          <div style={{display:'flex',gap:8,padding:'10px 26px',borderBottom:'1px solid var(--line)',flexWrap:'wrap',alignItems:'center'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search value, actor, family..." style={{background:'oklch(0.16 0.020 252)',border:'1px solid var(--line)',borderRadius:8,color:'var(--ink)',padding:'8px 14px',fontSize:12,fontFamily:'var(--font-mono)',outline:'none',width:280}}/>
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',borderRadius:6,color:'var(--ink)',padding:'8px 12px',fontSize:11,fontFamily:'var(--font-mono)',outline:'none',cursor:'pointer'}}>
              {types.map(t=><option key={t} value={t}>{t==='all'?'All Types':t.toUpperCase()}</option>)}
            </select>
            <div className="mono tiny" style={{marginLeft:'auto',color:'var(--ink-3)'}}>{filtered.length} IOCs</div>
          </div>
          <div style={{padding:'0 26px',overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'oklch(0.18 0.022 252/.5)'}}>{['Confidence','Type','IOC Value','Category','Threat Actor','Malware Family','Source'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.length===0&&<tr><td colSpan={7} style={{...td,textAlign:'center',color:'var(--ink-3)',padding:40}}>No IOCs match</td></tr>}
                {filtered.map(ioc=>{
                  const isExp=selected===ioc.id;
                  return(<React.Fragment key={ioc.id}>
                    <tr className="ti-row" onClick={()=>setSelected(isExp?null:ioc.id)}>
                      <td style={td}><ConfBar value={ioc.confidence}/></td>
                      <td style={td}><TypeBadge type={ioc.type}/></td>
                      <td style={{...td,fontFamily:'var(--font-mono)',color:'var(--ink)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11}}>{ioc.value}</td>
                      <td style={{...td,fontSize:10,color:ioc.category==='c2'?'var(--crit)':ioc.category==='vulnerability'?'var(--warn)':ioc.category==='reconnaissance'?'var(--cyan)':'var(--ink-2)'}}>{fmt(ioc.category)}</td>
                      <td style={{...td,fontSize:10,color:'var(--hi)',fontFamily:'var(--font-mono)'}}>{ioc.threat_actor||'—'}</td>
                      <td style={{...td,fontSize:10,color:'var(--ink-2)'}}>{ioc.malware_family||'—'}</td>
                      <td style={td}><span style={{display:'inline-block',padding:'2px 7px',borderRadius:4,fontSize:9,background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',color:'var(--ink-3)',fontFamily:'var(--font-mono)'}}>{ioc.source||'local'}</span></td>
                    </tr>
                    {isExp&&(<tr style={{background:'color-mix(in oklab,var(--cyan) 4%,transparent)'}}>
                      <td colSpan={7} style={{padding:'16px 20px',borderBottom:'1px solid color-mix(in oklab,var(--cyan) 15%,transparent)'}}>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
                          <div style={{gridColumn:'1/-1',background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',borderRadius:8,padding:'10px 14px'}}>
                            <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:4}}>DESCRIPTION</div>
                            <div style={{fontSize:12,color:'var(--ink-2)',lineHeight:1.6}}>{ioc.description||'No description.'}</div>
                          </div>
                          {[{l:'Value',v:ioc.value},{l:'Type',v:ioc.type},{l:'Threat Actor',v:ioc.threat_actor||'—'},{l:'Malware',v:ioc.malware_family||'—'},{l:'Confidence',v:Math.round(ioc.confidence*100)+'%'},{l:'Source',v:ioc.source},{l:'Added',v:ioc.added_at}].map(x=>(<div key={x.l} style={{background:'oklch(0.18 0.022 252)',border:'1px solid var(--line)',borderRadius:6,padding:'7px 10px'}}><div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:2}}>{x.l}</div><div className="mono" style={{fontSize:11,color:'var(--ink)',wordBreak:'break-all'}}>{x.v}</div></div>))}
                        </div>
                      </td>
                    </tr>)}
                  </React.Fragment>);
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab==='actors'&&(
        <div style={{padding:'20px 26px'}}>
          <div className="mono tiny" style={{color:'var(--ink-3)',marginBottom:16,letterSpacing:2}}>{actorGroups.length} THREAT ACTORS · CLICK CARD TO FILTER IOC TABLE</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
            {actorGroups.map(([actor,aIocs])=><ActorCard key={actor} actor={actor} iocs={aIocs} selected={actorSel} onSelect={(a)=>{setActorSel(a);if(a){setTab('iocs');}}}/>)}
          </div>
        </div>
      )}
      {tab==='lookup'&&<div style={{padding:'20px 26px'}}><LookupPanel/></div>}
      {tab==='add'&&<div style={{padding:'20px 26px'}}><AddIOCPanel onAdded={()=>{load();setTab('iocs');}}/></div>}
    </div>
  );
}
Object.assign(window,{ThreatFeedPage});