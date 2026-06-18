function KillChainPage() {
  var stateData = React.useState(null);
  var data = stateData[0]; var setData = stateData[1];
  var stateErr = React.useState(null);
  var error = stateErr[0]; var setError = stateErr[1];
  var stateSync = React.useState(null);
  var lastSync = stateSync[0]; var setLastSync = stateSync[1];

  var STAGES = [
    {id:'reconnaissance',       label:'Reconnaissance'},
    {id:'initial_access',       label:'Initial Access'},
    {id:'execution',            label:'Execution'},
    {id:'persistence',          label:'Persistence'},
    {id:'privilege_escalation', label:'Privilege Esc.'},
    {id:'lateral_movement',     label:'Lateral Movement'},
    {id:'collection',           label:'Collection'},
    {id:'exfiltration',         label:'Exfiltration'},
    {id:'impact',               label:'Impact'},
    {id:'discovery',            label:'Discovery'},
  ];

  function load() {
    fetch('/api/8006/health')
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) { setData(d); setLastSync(new Date().toLocaleTimeString()); setError(null); })
      .catch(function(e) { setError('' + e); });
  }

  React.useEffect(function() {
    load();
    var id = setInterval(load, 5000);
    return function() { clearInterval(id); };
  }, []);

  function handleResolve(correlationId) {
    fetch('/api/8020/resolve_killchain/' + encodeURIComponent(correlationId), {
      method: 'POST'
    }).then(function(r) {
      if (r.ok) { load(); }
    }).catch(function(){});
  }

  var tracker = data && data.kill_chain_tracker ? data.kill_chain_tracker : {};
  var statsObj = data && data.stats ? data.stats : {};
  var progressionsFired = statsObj.kill_chain_progression || 0;
  var allEntries = Object.entries(tracker);

  var activeCount = 0; var staleCount = 0; var resolvedCount = 0;
  allEntries.forEach(function(entry) {
    var status = entry[1] && entry[1].status ? entry[1].status : 'active';
    if (status === 'active') activeCount++;
    else if (status === 'stale') staleCount++;
    else if (status === 'resolved') resolvedCount++;
  });

  var activeStages = {};
  allEntries.forEach(function(entry) {
    var ad = entry[1];
    if (ad && ad.status === 'active') {
      var stages = ad && ad.stages_active ? ad.stages_active : [];
      if (Array.isArray(stages)) {
        stages.forEach(function(s) { activeStages[s.toLowerCase().replace(/ /g, '_')] = true; });
      }
    }
  });

  var STATUS_ORDER = {active:0, stale:1, resolved:2};
  var sortedEntries = allEntries.slice().sort(function(a, b) {
    var sa = (a[1] && a[1].status) ? a[1].status : 'active';
    var sb = (b[1] && b[1].status) ? b[1].status : 'active';
    return (STATUS_ORDER[sa] || 0) - (STATUS_ORDER[sb] || 0);
  });

  return (
    <div style={{padding:'24px 28px 60px', color:'var(--ink)', fontFamily:'var(--font-mono)'}}>
      <style>{'@keyframes kc-glow{0%,100%{box-shadow:0 0 10px #00ff88,inset 0 0 6px rgba(0,255,136,0.12)}50%{box-shadow:0 0 22px #00ff88,inset 0 0 14px rgba(0,255,136,0.22)}}'}</style>

      <div style={{marginBottom:20}}>
        <div style={{fontSize:10, color:'var(--ink-3)', letterSpacing:'3px', textTransform:'uppercase', marginBottom:4}}>INTEL · MITRE ATT&CK</div>
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <h2 style={{margin:0, fontSize:20, fontWeight:700, color:'var(--ink)'}}>KILL CHAIN · MITRE ATT&CK PROGRESSION</h2>
          <span style={{fontSize:9, color:error ? 'var(--crit)' : 'var(--ok)', letterSpacing:2}}>
            {error ? '⚠ OFFLINE' : '● LIVE · ' + (lastSync || '...')}
          </span>
        </div>
      </div>

      <div style={{display:'flex', gap:12, marginBottom:20, flexWrap:'wrap'}}>
        {[
          {l:'Progressions Fired', v:progressionsFired, c:'var(--crit)'},
          {l:'Active',             v:activeCount,        c:'var(--ok)'},
          {l:'Stale',              v:staleCount,          c:'var(--warn)'},
          {l:'Resolved',           v:resolvedCount,       c:'var(--ink-3)'},
        ].map(function(x) {
          return (
            <div key={x.l} style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:'14px 20px', minWidth:160}}>
              <div style={{fontSize:26, fontWeight:700, color:x.c, lineHeight:1}}>{x.v}</div>
              <div style={{fontSize:10, color:'var(--ink-3)', marginTop:5, letterSpacing:'1px', textTransform:'uppercase'}}>{x.l}</div>
            </div>
          );
        })}
      </div>

      <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:'18px 20px', marginBottom:20}}>
        <div style={{fontSize:10, color:'var(--ink-3)', letterSpacing:'2px', marginBottom:14, textTransform:'uppercase'}}>ATTACK PROGRESSION PIPELINE · ACTIVE INCIDENTS ONLY</div>
        <div style={{display:'flex', gap:4, flexWrap:'wrap', alignItems:'center'}}>
          {STAGES.map(function(stage, idx) {
            var active = !!activeStages[stage.id];
            return (
              <React.Fragment key={stage.id}>
                <div style={{
                  flex:'1 1 72px', minWidth:72,
                  background: active ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.02)',
                  border: '1px solid ' + (active ? '#00ff88' : '#333'),
                  borderRadius:8, padding:'10px 6px', textAlign:'center',
                  animation: active ? 'kc-glow 2s infinite' : 'none',
                  opacity: active ? 1 : 0.38,
                }}>
                  <div style={{fontSize:9, color:'var(--ink-4)', marginBottom:4}}>{idx + 1}</div>
                  <div style={{fontSize:9, fontWeight:700, color:active ? '#00ff88' : '#555', lineHeight:1.3}}>{stage.label}</div>
                  {active ? <div style={{width:5, height:5, borderRadius:'50%', background:'#00ff88', margin:'6px auto 0', boxShadow:'0 0 6px #00ff88'}}/> : null}
                </div>
                {idx < STAGES.length - 1 ? <span style={{fontSize:10, color:'#444', flexShrink:0}}>›</span> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {sortedEntries.length === 0 ? (
        <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:'48px 20px', textAlign:'center'}}>
          <div style={{fontSize:11, color:'var(--ink-3)', lineHeight:1.8}}>
            No kill-chain activity detected. Waiting for multi-stage attack patterns
          </div>
        </div>
      ) : (
        <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:'16px 20px'}}>
          <div style={{fontSize:10, color:'var(--ink-3)', letterSpacing:'2px', marginBottom:12, textTransform:'uppercase'}}>
            INCIDENT KILL-CHAINS · {sortedEntries.length} TOTAL
          </div>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr>
                {['ID', 'Type', 'Actors', 'Active Stages', 'Count', 'Status', 'Risk', 'Action'].map(function(h) {
                  return (
                    <th key={h} style={{padding:'8px 12px', textAlign:'left', fontSize:9, letterSpacing:'2px', textTransform:'uppercase', color:'var(--ink-3)', borderBottom:'1px solid #1e2a3a'}}>
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(function(entry) {
                var cid = entry[0];
                var ad = entry[1];
                var status = (ad && ad.status) ? ad.status : 'active';
                var corrType = (ad && ad.correlation_type) ? ad.correlation_type : cid;
                var actors = (ad && ad.actors && Array.isArray(ad.actors)) ? ad.actors : [];
                var stages = (ad && ad.stages_active && Array.isArray(ad.stages_active)) ? ad.stages_active : [];
                var total = (ad && ad.total_stages_ever) ? ad.total_stages_ever : stages.length;
                var isResolved = status === 'resolved';
                var isStale    = status === 'stale';
                var statusColor = isResolved ? 'var(--ink-3)' : isStale ? 'var(--warn)' : 'var(--ok)';
                var risk = total >= 3 ? 'CRITICAL' : total >= 2 ? 'HIGH' : 'MONITOR';
                var riskColor = risk === 'CRITICAL' ? 'var(--crit)' : risk === 'HIGH' ? 'var(--hi)' : 'var(--ink-3)';
                return (
                  <tr key={cid} style={{borderBottom:'1px solid rgba(255,255,255,0.04)', opacity: isResolved ? 0.5 : 1}}>
                    <td style={{padding:'10px 12px', fontSize:11, color:'var(--cyan)', fontFamily:'monospace'}}>{cid.slice(0, 12)}</td>
                    <td style={{padding:'10px 12px', fontSize:10, color:'var(--ink-2)'}}>{corrType}</td>
                    <td style={{padding:'10px 12px', fontSize:10, color:'var(--ink-2)'}}>{actors.join(', ') || '—'}</td>
                    <td style={{padding:'10px 12px', fontSize:10, color:'var(--ink-2)'}}>{stages.join(', ') || '—'}</td>
                    <td style={{padding:'10px 12px', fontSize:14, fontWeight:700, color:'var(--ink)', textAlign:'center'}}>{total}</td>
                    <td style={{padding:'10px 12px'}}>
                      <span style={{
                        display:'inline-block', padding:'2px 8px', borderRadius:4,
                        fontSize:9, fontWeight:700, color:statusColor,
                        boxShadow: status === 'active' ? '0 0 6px var(--ok)' : 'none',
                      }}>{status.toUpperCase()}</span>
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      <span style={{display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:9, fontWeight:700, color:riskColor, border:'1px solid rgba(128,128,128,0.3)', background:'rgba(128,128,128,0.06)'}}>{risk}</span>
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      {isResolved ? (
                        <span style={{fontSize:9, color:'var(--ink-3)'}}>RESOLVED</span>
                      ) : (
                        <button onClick={function() { handleResolve(cid); }} style={{fontSize:9, padding:'2px 8px', background:'rgba(100,100,100,0.2)', border:'1px solid rgba(100,100,100,0.3)', color:'#aaa', borderRadius:3, cursor:'pointer'}}>Resolve</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { KillChainPage });
