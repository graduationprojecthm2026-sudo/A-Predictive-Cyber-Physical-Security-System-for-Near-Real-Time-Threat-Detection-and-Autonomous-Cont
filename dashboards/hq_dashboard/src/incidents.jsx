(function(){
const SEV_COLORS={critical:"#ff4444",high:"#ff8c00",medium:"#ffcc00",low:"#44bb44"};
const ALERT_COLORS={isolation_violation:"#ff4444",immovable_violation:"#ff6b35",baseline_drift:"#ff4444",risk_score_threshold:"#ff8c00",privilege_escalation:"#ff4444",ransomware_behavior:"#ff0000",brute_force_ssh:"#ff6b35",behavioral_anomaly:"#ffaa00",dns_tunneling:"#ff6b35",slow_port_scan:"#ffaa00",c2_beacon:"#ff4444",agent_down:"#888888"};
const SEVERITY_ORDER={critical:0,high:1,medium:2,low:3};

function fmtTime(ts){
  if(!ts)return"—";
  const d=new Date(ts);
  if(isNaN(d))return"—";
  return d.toLocaleTimeString('en-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function fmt(t){if(!t)return"Unknown";return t.split("_").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");}

function IncidentTable({data,label,color,badge}){
  const[search,setSearch]=React.useState("");
  const[sev,setSev]=React.useState("all");
  const[type,setType]=React.useState("all");
  const[sortBy,setSortBy]=React.useState("time");
  const[sortDir,setSortDir]=React.useState("desc");
  const[page,setPage]=React.useState(1);
  const[exp,setExp]=React.useState(null);
  const PG=20;
  var confirmState=React.useState({});var confirmed=confirmState[0];var setConfirmed=confirmState[1];
  var dismissState=React.useState({});var dismissed=dismissState[0];var setDismissed=dismissState[1];

  React.useEffect(()=>{setPage(1);},[search,sev,type,sortBy,sortDir]);

  const types=React.useMemo(()=>{const s=new Set(data.map(i=>i.alert_type).filter(Boolean));return["all",...Array.from(s).sort()];},[data]);

  const filtered=React.useMemo(()=>{
    let a=data;
    if(sev!=="all")a=a.filter(i=>(i.severity||"").toLowerCase()===sev);
    if(type!=="all")a=a.filter(i=>i.alert_type===type);
    if(search.trim()){const q=search.toLowerCase();a=a.filter(i=>(i.incident_id||"").toLowerCase().includes(q)||(i.alert_type||"").toLowerCase().includes(q)||(i.host_id||"").toLowerCase().includes(q)||(i.details?.src_ip||"").toLowerCase().includes(q)||(i.details?.detail||"").toLowerCase().includes(q));}
    return[...a].sort((a,b)=>{
      if(sortBy==="time"){const av=new Date(a.created_at||a.timestamp||0).getTime(),bv=new Date(b.created_at||b.timestamp||0).getTime();return sortDir==="asc"?av-bv:bv-av;}
      if(sortBy==="severity"){const av=SEVERITY_ORDER[(a.severity||"low").toLowerCase()]??9,bv=SEVERITY_ORDER[(b.severity||"low").toLowerCase()]??9;return sortDir==="asc"?av-bv:bv-av;}
      if(sortBy==="host"){const av=a.host_id||"",bv=b.host_id||"";return sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av);}
      const av=a.alert_type||"",bv=b.alert_type||"";return sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av);
    });
  },[data,sev,type,search,sortBy,sortDir]);

  const totalPages=Math.max(1,Math.ceil(filtered.length/PG));
  const items=filtered.slice((page-1)*PG,page*PG);
  const counts=React.useMemo(()=>({total:data.length,critical:data.filter(i=>(i.severity||"").toLowerCase()==="critical").length,high:data.filter(i=>(i.severity||"").toLowerCase()==="high").length}),[data]);

  function toggleSort(col){if(sortBy===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortBy(col);setSortDir("desc");}}

  function handleConfirm(incidentId){fetch('/api/8020/confirm/'+encodeURIComponent(incidentId),{method:'POST'}).then(function(r){if(r.ok){var next=Object.assign({},confirmed);next[incidentId]=true;setConfirmed(next);}}).catch(function(){});}
  function handleDismiss(incidentId){fetch('/api/8020/dismiss/'+encodeURIComponent(incidentId),{method:'POST'}).then(function(r){if(r.ok){var next=Object.assign({},dismissed);next[incidentId]=true;setDismissed(next);}}).catch(function(){});}

  const inp={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"6px",color:"#e0e6f0",padding:"7px 12px",fontSize:"12px",fontFamily:"inherit",outline:"none"};
  const td={padding:"10px 14px",fontSize:"11px",borderBottom:"1px solid rgba(255,255,255,0.04)",verticalAlign:"middle"};
  const th={padding:"9px 14px",textAlign:"left",fontSize:"9px",letterSpacing:"2px",textTransform:"uppercase",color:"#4a5568",borderBottom:"1px solid rgba(255,255,255,0.06)",cursor:"pointer",userSelect:"none"};

  return React.createElement("div",null,
    React.createElement("div",{style:{display:"flex",gap:"10px",padding:"14px 28px",borderBottom:"1px solid rgba(255,255,255,.05)",flexWrap:"wrap"}},
      [{l:"Total",v:counts.total,c:"#888"},{l:"Critical",v:counts.critical,c:"#ff4444"},{l:"High",v:counts.high,c:"#ff8c00"},{l:"Confirmed",v:Object.keys(confirmed).length,c:"#44cc44"},{l:"Dismissed",v:Object.keys(dismissed).length,c:"#888"}].map(({l,v,c})=>
        React.createElement("div",{key:l,style:{background:"rgba(255,255,255,.04)",border:`1px solid ${c}33`,borderRadius:"6px",padding:"8px 16px",minWidth:"80px"}},
          React.createElement("div",{style:{fontSize:"9px",letterSpacing:"2px",textTransform:"uppercase",opacity:.5,marginBottom:"2px"}},l),
          React.createElement("div",{style:{fontSize:"22px",fontWeight:700,color:c,lineHeight:1}},v)))),
    React.createElement("div",{style:{display:"flex",gap:"10px",padding:"14px 28px",borderBottom:"1px solid rgba(255,255,255,.05)",flexWrap:"wrap",alignItems:"center"}},
      React.createElement("input",{style:{...inp,width:"240px"},placeholder:"Search host, ID, type, detail...",value:search,onChange:e=>setSearch(e.target.value)}),
      React.createElement("select",{style:{...inp,cursor:"pointer"},value:sev,onChange:e=>setSev(e.target.value)},
        ["all","critical","high","medium","low"].map(v=>React.createElement("option",{key:v,value:v},v==="all"?"All Severities":v.charAt(0).toUpperCase()+v.slice(1)))),
      React.createElement("select",{style:{...inp,cursor:"pointer"},value:type,onChange:e=>setType(e.target.value)},
        types.map(v=>React.createElement("option",{key:v,value:v},v==="all"?"All Types":fmt(v)))),
      React.createElement("div",{style:{marginLeft:"auto",fontSize:"11px",color:"#4a5568"}},filtered.length+" incidents · page "+page+"/"+totalPages)),
    React.createElement("div",{style:{overflowX:"auto",padding:"0 28px"}},
      React.createElement("table",{style:{width:"100%",borderCollapse:"collapse"}},
        React.createElement("thead",null,React.createElement("tr",null,
          ["severity","incident_id","alert_type","host","mitre","agent","time","status","action"].map((col,i)=>{
            const labels=["Sev","Incident ID","Alert Type","Host","MITRE","Agent","Time","Status","Action"];
            const sortable=["severity","alert_type","host","time"].includes(col);
            return React.createElement("th",{key:col,style:th,onClick:sortable?()=>toggleSort(col==="host"?"host":col):undefined},labels[i]," ",sortable?(sortBy===col?(sortDir==="desc"?"↓":"↑"):"⇅"):"");}))),
        React.createElement("tbody",null,
          items.length===0&&React.createElement("tr",null,React.createElement("td",{colSpan:9,style:{...td,textAlign:"center",color:"#4a5568",padding:"40px"}},"No incidents match")),
          items.map(inc=>{
            const s=(inc.severity||"low").toLowerCase();
            const isE=exp===inc.incident_id;
            const host=inc.host_id||inc.details?.src_ip||"—";
            const ts=inc.created_at||inc.timestamp||inc.escalated_at;
            return React.createElement(React.Fragment,{key:inc.incident_id},
              React.createElement("tr",{className:"irow",style:{cursor:"pointer",opacity:dismissed[inc.incident_id]?0.4:1},onClick:()=>setExp(isE?null:inc.incident_id)},
                React.createElement("td",{style:td},React.createElement("span",{style:{display:"inline-block",padding:"2px 8px",borderRadius:"3px",fontSize:"9px",fontWeight:700,textTransform:"uppercase",color:SEV_COLORS[s]||"#888",border:`1px solid ${SEV_COLORS[s]||"#888"}44`,background:`${SEV_COLORS[s]||"#888"}11`}},s)),
                React.createElement("td",{style:{...td,color:"#4a7a9b",fontFamily:"monospace",fontSize:"10px"}},inc.incident_id),
                React.createElement("td",{style:td},React.createElement("span",{style:{display:"inline-flex",alignItems:"center",gap:"6px"}},React.createElement("span",{style:{width:"6px",height:"6px",borderRadius:"50%",background:ALERT_COLORS[inc.alert_type]||"#666",flexShrink:0}}),fmt(inc.alert_type))),
                React.createElement("td",{style:{...td,fontFamily:"monospace"}},host),
                React.createElement("td",{style:{...td,color:"#ff8c44",fontFamily:"monospace",fontSize:"10px"}},inc.details?.mitre_technique||"—"),
                React.createElement("td",{style:{...td,color:"#4a5568",fontSize:"10px"}},inc.agent_type||inc.manager_id||inc.agent_id||"—"),
                React.createElement("td",{style:{...td,color:"#4a6a7a",fontSize:"10px",whiteSpace:"nowrap"}},fmtTime(ts)),
                React.createElement("td",{style:{...td,fontSize:"10px",color:"#4a8a6a"}},inc.status||"—"),
                React.createElement("td",{style:{...td},onClick:function(e){e.stopPropagation();}},
                  confirmed[inc.incident_id]
                    ? React.createElement("span",{style:{display:"inline-block",padding:"2px 6px",borderRadius:3,fontSize:9,background:"rgba(0,255,0,0.12)",border:"1px solid rgba(0,255,0,0.25)",color:"#44cc44",fontWeight:700}},"CONFIRMED")
                    : dismissed[inc.incident_id]
                    ? React.createElement("span",{style:{display:"inline-block",padding:"2px 6px",borderRadius:3,fontSize:9,background:"rgba(120,120,120,0.12)",border:"1px solid rgba(150,150,150,0.25)",color:"#888"}},"DISMISSED")
                    : React.createElement("div",{style:{display:"flex",gap:4}},
                        React.createElement("button",{style:{fontSize:9,padding:"2px 6px",background:"rgba(0,255,0,0.12)",border:"1px solid rgba(0,255,0,0.25)",color:"#44cc44",borderRadius:3,cursor:"pointer"},onClick:function(){handleConfirm(inc.incident_id);}},"✓ TP"),
                        React.createElement("button",{style:{fontSize:9,padding:"2px 6px",background:"rgba(255,0,0,0.12)",border:"1px solid rgba(255,0,0,0.25)",color:"#cc4444",borderRadius:3,cursor:"pointer"},onClick:function(){handleDismiss(inc.incident_id);}},"✕ FP")
                      )
                )),
              isE&&React.createElement("tr",{style:{background:"rgba(0,212,255,.03)"}},
                React.createElement("td",{colSpan:9,style:{padding:"0"}},
                  React.createElement("div",{style:{padding:"16px 28px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"10px"}},
                    inc.details?.detail&&React.createElement("div",{style:{gridColumn:"1/-1",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:"6px",padding:"10px 14px"}},React.createElement("div",{style:{fontSize:"9px",letterSpacing:"2px",color:"#4a5568",marginBottom:"4px"}},"DETAIL"),React.createElement("div",{style:{fontSize:"12px",color:"#e0e6f0"}},inc.details.detail)),
                    Object.entries(inc.details||{}).filter(([k])=>k!=="detail"&&k!=="mitre_technique").map(([k,v])=>React.createElement("div",{key:k,style:{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:"6px",padding:"10px 14px"}},React.createElement("div",{style:{fontSize:"9px",letterSpacing:"2px",color:"#4a5568",marginBottom:"4px"}},k.replace(/_/g," ").toUpperCase()),React.createElement("div",{style:{fontSize:"12px",color:"#c0cfe0",wordBreak:"break-all"}},Array.isArray(v)?v.join(", "):String(v)))),
                    inc.recommended_actions?.length>0&&React.createElement("div",{style:{gridColumn:"1/-1",background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:"6px",padding:"10px 14px"}},React.createElement("div",{style:{fontSize:"9px",letterSpacing:"2px",color:"#4a5568",marginBottom:"6px"}},"RECOMMENDED ACTIONS"),inc.recommended_actions.map(a=>React.createElement("span",{key:a,style:{display:"inline-block",background:"rgba(255,140,0,.12)",border:"1px solid rgba(255,140,0,.25)",borderRadius:"3px",padding:"2px 7px",fontSize:"10px",color:"#ffaa44",margin:"2px"}},a.replace(/_/g," "))))))));
          })))),
    React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"20px"}},
      React.createElement("button",{disabled:page===1,onClick:()=>setPage(1),style:{...inp,width:"auto",padding:"5px 10px",cursor:page===1?"not-allowed":"pointer",color:page===1?"#333":"#888"}},"«"),
      React.createElement("button",{disabled:page===1,onClick:()=>setPage(p=>p-1),style:{...inp,width:"auto",padding:"5px 10px",cursor:page===1?"not-allowed":"pointer",color:page===1?"#333":"#888"}},"‹"),
      Array.from({length:Math.min(7,totalPages)},(_,i)=>{let p=totalPages<=7?i+1:page<=4?i+1:page>=totalPages-3?totalPages-6+i:page-3+i;return React.createElement("button",{key:p,onClick:()=>setPage(p),style:{...inp,width:"auto",padding:"5px 10px",cursor:"pointer",background:p===page?"rgba(0,212,255,.15)":"rgba(255,255,255,.04)",border:p===page?"1px solid rgba(0,212,255,.4)":"1px solid rgba(255,255,255,.08)",color:p===page?"#00d4ff":"#888"}},p);}),
      React.createElement("button",{disabled:page===totalPages,onClick:()=>setPage(p=>p+1),style:{...inp,width:"auto",padding:"5px 10px",cursor:page===totalPages?"not-allowed":"pointer",color:page===totalPages?"#333":"#888"}},"›"),
      React.createElement("button",{disabled:page===totalPages,onClick:()=>setPage(totalPages),style:{...inp,width:"auto",padding:"5px 10px",cursor:page===totalPages?"not-allowed":"pointer",color:page===totalPages?"#333":"#888"}},"»")));
}

function IncidentsPage(){
  const[liveData,setLiveData]=React.useState([]);
  const[histData,setHistData]=React.useState([]);
  const[loading,setLoading]=React.useState(true);
  const[lastSync,setLastSync]=React.useState(null);
  const[activeTab,setActiveTab]=React.useState("live");

  async function load(){
    try{
      const[lr,hr]=await Promise.all([
        fetch("/api/8020/incidents?limit=1000"),
        fetch("/api/8020/history?limit=2000"),
      ]);
      if(lr.ok){const d=await lr.json();setLiveData(Array.isArray(d)?d:(d.incidents||[]));}
      if(hr.ok){const d=await hr.json();setHistData(d.incidents||[]);}
      setLastSync(Date.now());
    }catch(e){}
    finally{setLoading(false);}
  }

  React.useEffect(()=>{load();const id=setInterval(load,10000);return()=>clearInterval(id);},[]);

  const inp={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"6px",color:"#e0e6f0",padding:"7px 12px",fontSize:"12px",fontFamily:"inherit",outline:"none"};

  if(loading)return React.createElement("div",{style:{color:"#4a5568",padding:"60px",textAlign:"center"}},"Loading incidents...");

  const tabStyle=(active,color)=>({
    padding:"10px 24px",
    cursor:"pointer",
    fontSize:"11px",
    letterSpacing:"2px",
    textTransform:"uppercase",
    fontWeight:600,
    border:"none",
    background:active?"rgba(0,212,255,.1)":"transparent",
    color:active?color:"#4a5568",
    borderBottom:active?`2px solid ${color}`:"2px solid transparent",
    fontFamily:"JetBrains Mono,monospace",
  });

  return React.createElement("div",{style:{color:"#e0e6f0",fontFamily:"JetBrains Mono,monospace",paddingBottom:"40px"}},
    React.createElement("style",null,"@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.irow:hover td{background:rgba(255,255,255,.02)} input::placeholder{color:#4a5568}"),

    // Header
    React.createElement("div",{style:{padding:"20px 28px 14px",borderBottom:"1px solid rgba(0,212,255,.15)"}},
      React.createElement("div",{style:{fontSize:"10px",letterSpacing:"3px",color:"#00d4ff",opacity:.7,marginBottom:"4px"}},"INTEL · INVESTIGATION"),
      React.createElement("div",{style:{display:"flex",alignItems:"center",gap:"12px"}},
        React.createElement("h1",{style:{fontSize:"22px",fontWeight:700,color:"#fff",margin:0}},"Incidents"),
        React.createElement("span",{style:{display:"flex",alignItems:"center",gap:"5px",fontSize:"9px",color:"#44ee88",letterSpacing:"1px"}},
          React.createElement("span",{style:{width:"6px",height:"6px",borderRadius:"50%",background:"#44ee88",display:"inline-block",animation:"pulse 2s infinite"}}),"LIVE")),
      React.createElement("div",{style:{fontSize:"10px",color:"#4a5568",marginTop:"4px"}},"central-manager-01 · auto-refresh 10s"+(lastSync?" · synced "+fmtTime(lastSync):""))),

    // Tabs
    React.createElement("div",{style:{display:"flex",borderBottom:"1px solid rgba(255,255,255,.08)",padding:"0 28px",gap:"4px"}},
      React.createElement("button",{style:tabStyle(activeTab==="live","#00d4ff"),onClick:()=>setActiveTab("live")},
        "⚡ Live Kafka  ("+liveData.length+")"),
      React.createElement("button",{style:tabStyle(activeTab==="history","#ff8c00"),onClick:()=>setActiveTab("history")},
        "🗄 DB History  ("+histData.length+")")),

    // Tab description
    React.createElement("div",{style:{padding:"10px 28px",fontSize:"10px",color:"#4a5568",borderBottom:"1px solid rgba(255,255,255,.05)"}},
      activeTab==="live"
        ? "Live incidents from Kafka. Current session only, resets on restart"
        : "Persistent incident history from PostgreSQL. Survives restarts, full day record"),

    // Table
    activeTab==="live"
      ? React.createElement(IncidentTable,{data:liveData,label:"Live",color:"#00d4ff"})
      : React.createElement(IncidentTable,{data:histData,label:"History",color:"#ff8c00"}));
}

Object.assign(window,{IncidentsPage});
})();
