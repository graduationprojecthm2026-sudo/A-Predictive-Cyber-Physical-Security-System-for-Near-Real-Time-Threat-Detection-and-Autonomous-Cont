// SOAR Response Panel: "War Room Command"

function PlaybookCard({pb, onRun}){
  var sHover = React.useState(false);
  var hover = sHover[0];
  var setHover = sHover[1];
  return (
    <div onMouseEnter={function(){setHover(true);}} onMouseLeave={function(){setHover(false);}}
      style={{position:'relative',padding:14,border:'1px solid var(--line)',borderRadius:12,
        background:'oklch(0.22 0.028 252 / .75)',cursor:'pointer',transition:'all .2s',
        borderColor: hover ? 'var(--cyan)' : 'var(--line)',
        boxShadow: hover ? '0 0 22px color-mix(in oklab, var(--cyan) 25%, transparent)' : 'none',
      }}>
      <div className="between">
        <div className="mono tiny c-cyan">{pb.id}</div>
        <span className="tag">{pb.runtime}</span>
      </div>
      <div style={{fontWeight:600,marginTop:6}}>{pb.name}</div>
      <div className="tiny c-ink3" style={{marginTop:4}}>{pb.tactic}</div>
      <div className="between" style={{marginTop:10}}>
        <div style={{display:'flex',gap:3}}>
          {Array.from({length:pb.steps}).map(function(_,i){
            return <span key={i} style={{width:14,height:4,borderRadius:99,background:'var(--surface-2)'}}/>;
          })}
        </div>
        <button className="btn" onClick={onRun}>RUN ▸</button>
      </div>

      {(hover && pb.triggers && pb.triggers.length > 0) && (
        <div style={{position:'absolute',left:'100%',top:0,marginLeft:8,zIndex:5,
          padding:12,minWidth:240,border:'1px solid var(--cyan)',borderRadius:10,
          background:'oklch(0.16 0.025 252 / .98)',
          boxShadow:'0 0 32px color-mix(in oklab, var(--cyan) 35%, transparent)'}}>
          <div className="tiny upper c-cyan" style={{marginBottom:8}}>Triggers</div>
          {pb.triggers.map(function(tr, i){
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
                <span className="mono" style={{fontSize:10,color:'var(--cyan)',width:22}}>T{i+1}</span>
                <span style={{flex:1,height:1,background:'var(--line-2)'}}/>
                <span className="tiny" style={{color:'var(--ink-2)'}}>{tr}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExecutionLane({ex}){
  var hqData = useHQ();
  var playbooks = hqData.playbooks;
  var t = hqData.t;
  var pb = null;
  for (var pi = 0; pi < playbooks.length; pi++) {
    if (playbooks[pi].id === ex.pb) { pb = playbooks[pi]; break; }
  }
  var pbSteps = pb && pb.steps ? (Array.isArray(pb.steps) ? pb.steps : []) : [];
  var total = ex.steps.length;
  var elapsed = Math.max(0, t - ex.started);
  var doneCount = 0; for (var di = 0; di < ex.steps.length; di++) { if (ex.steps[di]) doneCount++; }
  var progress = ex.status === 'success' ? 1 : ex.status === 'pending' ? 0 : total > 0 ? doneCount / total : 0;
  var color = ({success:'var(--ok)',running:'var(--cyan)',pending:'var(--warn)',failed:'var(--crit)'})[ex.status];
  var failIdx = -1;
  for (var si = 0; si < ex.steps.length; si++) {
    if (!ex.steps[si]) { failIdx = si; break; }
  }
  return (
    <div style={{position:'relative',padding:10,border:'1px solid var(--line)',borderRadius:10,background:'oklch(0.2 0.025 252 / .6)'}}>
      <div className="between" style={{marginBottom:6}}>
        <div style={{display:'flex',flexDirection:'column',gap:1}}>
          <span style={{fontWeight:600,fontSize:13}}>{pb && pb.name}</span>
          <span className="mono" style={{fontSize:9,color:'var(--ink-4)'}}>{ex.id}</span>
        </div>
        <span className="tag" style={{color:color,
          borderColor:'color-mix(in oklab, ' + color + ' 45%, var(--line))',
          animation: ex.status === 'running' ? 'pulse 1.4s infinite' : 'none'}}>{ex.status}</span>
      </div>
      <div style={{position:'relative',height:24,borderRadius:6,background:'var(--surface-2)',overflow:'hidden',marginBottom:4}}>
        <div style={{position:'absolute',left:0,top:0,bottom:0,
          width:(progress*100)+'%',
          background:'linear-gradient(90deg, ' + color + ', color-mix(in oklab, ' + color + ' 50%, transparent))',
          boxShadow:'0 0 12px ' + color,
          transition:'width .6s ease'}}/>
        <div style={{position:'absolute',inset:0,display:'flex'}}>
          {ex.steps.map(function(s, i){
            var isFail = !s && ex.status === 'failed' && i === failIdx;
            var indicator = s ? '✓' : (isFail ? '✗' : '·');
            var indicatorColor = s ? 'var(--ok)' : (isFail ? 'var(--crit)' : 'var(--ink-3)');
            return (
              <div key={i} style={{flex:1,borderRight:i < ex.steps.length - 1 ? '1px solid var(--bg)' : 'none',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                <span style={{fontSize:11,fontFamily:'JetBrains Mono',color:indicatorColor,
                  animation: ex.status === 'running' && !s && i === failIdx ? 'blink 1s infinite' : 'none'}}>
                  {indicator}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{display:'flex'}}>
        {ex.steps.map(function(s, i){
          var stepObj = pbSteps[i] || null;
          var rawAction = stepObj && stepObj.action ? stepObj.action : '';
          var label = rawAction ? rawAction.replace(/_/g, ' ') : ('step ' + (i + 1));
          var truncated = label.length > 12 ? label.slice(0, 12) + '…' : label;
          return (
            <div key={i} style={{flex:1,display:'flex',justifyContent:'center',paddingTop:2}}>
              <span style={{fontSize:8,fontFamily:'JetBrains Mono',color:'var(--ink-3)',
                textAlign:'center',lineHeight:1.2,maxWidth:'100%',overflow:'hidden',
                whiteSpace:'nowrap',display:'block'}}>
                {truncated}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResponseRadar({executions, playbooks}){
  var domains = [
    { name:'IoT Network',     keys:['iot','gateway','beacon'] },
    { name:'Data Network',    keys:['ransomware','intrusion','coordinated','lateral','dns','exfil','anomalous'] },
    { name:'Physical Access', keys:['physical','insider','credential','badge','pac','lockdown'] },
  ];
  var total = executions.length;
  var cov = domains.map(function(d) {
    var count = 0;
    executions.forEach(function(ex) {
      var pb = null;
      for (var pi = 0; pi < playbooks.length; pi++) {
        if (playbooks[pi].id === ex.pb) { pb = playbooks[pi]; break; }
      }
      var triggers = (pb && pb.triggers) || [];
      var pbName = (pb && pb.name) ? pb.name.toLowerCase() : '';
      var matches = triggers.some(function(tr) {
        var tl = tr.toLowerCase();
        return d.keys.some(function(k){ return tl.indexOf(k) >= 0; });
      }) || d.keys.some(function(k){ return pbName.indexOf(k) >= 0; });
      if (matches) count++;
    });
    return { name: d.name, v: total > 0 ? count / total : 0 };
  });

  var cx = 140, cy = 140, R = 96;
  var n = cov.length;
  var pt = function(i, r){
    var a = -Math.PI/2 + (i/n)*Math.PI*2;
    return [cx + Math.cos(a)*r, cy + Math.sin(a)*r];
  };

  return (
    <svg viewBox="0 0 280 280" style={{width:'100%',height:280}}>
      <defs>
        <radialGradient id="rad-soar">
          <stop offset="0%" stopColor="var(--violet)" stopOpacity=".6"/>
          <stop offset="100%" stopColor="var(--violet)" stopOpacity=".05"/>
        </radialGradient>
      </defs>
      {[.25,.5,.75,1].map(function(r){
        return (
          <polygon key={r} points={cov.map(function(_,i){ return pt(i,R*r).join(','); }).join(' ')}
            fill="none" stroke="var(--line-2)" strokeWidth=".8" opacity=".5"/>
        );
      })}
      {total === 0 ? (
        <text x={cx} y={cy+4} textAnchor="middle" fill="var(--ink-3)" fontSize="11"
          fontFamily="JetBrains Mono">No executions yet</text>
      ) : (
        <polygon points={cov.map(function(d,i){ return pt(i,R*d.v).join(','); }).join(' ')}
          fill="url(#rad-soar)" stroke="var(--violet)" strokeWidth="2"
          style={{filter:'drop-shadow(0 0 8px var(--violet))'}}/>
      )}
      {cov.map(function(d, i){
        var tp = pt(i, R+24);
        var pp = pt(i, R*d.v);
        return (
          <g key={i}>
            {total > 0 && <circle cx={pp[0]} cy={pp[1]} r="4" fill="var(--violet)"
              style={{filter:'drop-shadow(0 0 4px var(--violet))'}}/>}
            <text x={tp[0]} y={tp[1]} textAnchor="middle" fill="var(--ink-2)" fontSize="9"
              fontFamily="JetBrains Mono">{d.name}</text>
            <text x={tp[0]} y={tp[1]+12} textAnchor="middle" fill="var(--violet)" fontSize="9"
              fontFamily="JetBrains Mono">{Math.round(d.v*100)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function SoarActionFeed() {
  var sData = React.useState({actions:[], total:0, executed:0, logged:0, pending:0});
  var soarData = sData[0];
  var setSoarData = sData[1];
  var sNotifs = React.useState({notifications:[], total:0});
  var notifData = sNotifs[0];
  var setNotifData = sNotifs[1];

  React.useEffect(function() {
    function fetchData() {
      fetch('/api/8020/soar_actions')
        .then(function(r){ return r.json(); })
        .then(function(d){ setSoarData(d); })
        .catch(function(){});
      fetch('/api/8020/notifications')
        .then(function(r){ return r.json(); })
        .then(function(d){ setNotifData(d); })
        .catch(function(){});
    }
    fetchData();
    var interval = setInterval(fetchData, 5000);
    return function(){ clearInterval(interval); };
  }, []);

  function relTime(ts) {
    if (!ts) return '';
    var diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
  }

  function statusColor(status) {
    if (status === 'executed' || status === 'dispatched') return 'var(--ok)';
    if (status === 'notification_sent') return 'var(--cyan)';
    if (status === 'pending_approval') return 'var(--warn)';
    return 'var(--ink-3)';
  }

  function StatusBadge(props) {
    var status = props.status;
    var color = statusColor(status);
    return React.createElement('span', {style:{
      fontSize:10, padding:'2px 7px', borderRadius:99,
      background:'color-mix(in oklab,' + color + ' 15%,transparent)',
      color:color,
      border:'1px solid color-mix(in oklab,' + color + ' 40%,transparent)',
      fontFamily:'JetBrains Mono', textTransform:'uppercase', letterSpacing:1,
      whiteSpace:'nowrap',
    }}, status);
  }

  var actions = (soarData && soarData.actions) || [];
  var notifications = (notifData && notifData.notifications) || [];
  var executed = (soarData && soarData.executed) || 0;
  var logged   = (soarData && soarData.logged)   || 0;
  var pending  = (soarData && soarData.pending)  || 0;

  var displayActions = actions.slice(0, 15);
  var totalActions   = actions.length;

  var uniqueNotifs = [];
  var notifCounts  = {};
  for (var ni = 0; ni < notifications.length; ni++) {
    var msg = notifications[ni] && notifications[ni].message;
    if (msg && !notifCounts[msg]) {
      notifCounts[msg] = { count: 1 };
      uniqueNotifs.push(notifications[ni]);
    } else if (msg && notifCounts[msg]) {
      notifCounts[msg].count++;
    }
  }
  var displayNotifs = uniqueNotifs.slice(0, 6);
  var hiddenNotifs  = uniqueNotifs.length - displayNotifs.length;

  return React.createElement(Section, {
    title: 'SOAR Action Feed',
    kicker: executed + ' executed · ' + logged + ' logged · ' + pending + ' pending approval',
  },
    React.createElement('div', {style:{maxHeight:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:6}},
      displayActions.length === 0
        ? React.createElement('div', {className:'tiny c-ink3', style:{padding:'12px 0', textAlign:'center'}}, 'No SOAR actions recorded yet')
        : displayActions.map(function(a, i) {
            var aAction  = (a && a.action)      || '';
            var aStatus  = (a && a.status)      || '';
            var aHandler = (a && a.handler)     || '';
            var aDesc    = (a && a.description) || '';
            var aTs      = (a && a.timestamp)   || '';
            return React.createElement('div', {
              key: i,
              style:{display:'flex', alignItems:'center', gap:10, padding:'8px 10px',
                borderRadius:8, background:'oklch(0.2 0.025 252 / .5)',
                border:'1px solid var(--line)', flexWrap:'wrap'},
            },
              React.createElement('span', {className:'mono', style:{fontSize:12, fontWeight:600, color:'var(--cyan)', minWidth:180}}, aAction),
              React.createElement(StatusBadge, {status: aStatus}),
              React.createElement('span', {className:'tiny c-ink3', style:{minWidth:110}}, aHandler),
              React.createElement('span', {className:'tiny c-ink3', style:{flex:1}}, aDesc),
              React.createElement('span', {className:'mono tiny c-ink3', style:{whiteSpace:'nowrap'}}, relTime(aTs))
            );
          })
    ),
    totalActions > 15 && React.createElement('div', {className:'tiny c-ink3', style:{textAlign:'right', marginTop:4, paddingRight:2}},
      'Showing 15 of ' + totalActions + ' total actions'
    ),
    React.createElement('div', {style:{marginTop:16, paddingTop:14, borderTop:'1px solid var(--line)'}},
      React.createElement('div', {className:'tiny upper c-ink3', style:{marginBottom:10}}, 'Notifications'),
      React.createElement('div', {style:{display:'flex', flexDirection:'column', gap:6}},
        displayNotifs.length === 0
          ? React.createElement('div', {className:'tiny c-ink3'}, 'No notifications yet')
          : displayNotifs.map(function(n, i) {
              var nMsg    = (n && n.message)   || '';
              var nPb     = (n && n.playbook)  || '';
              var nTs     = (n && n.timestamp) || '';
              var nCount  = (notifCounts[nMsg] && notifCounts[nMsg].count) || 1;
              return React.createElement('div', {
                key: i,
                style:{display:'flex', gap:12, padding:'8px 12px',
                  borderLeft:'3px solid var(--cyan)', borderRadius:6,
                  background:'oklch(0.2 0.025 252 / .4)'},
              },
                React.createElement('span', {style:{color:'var(--cyan)', fontSize:14}}, 'ℹ'),
                React.createElement('div', {style:{flex:1}},
                  React.createElement('div', {style:{fontSize:12}},
                    nMsg,
                    nCount > 1 && React.createElement('span', {style:{fontSize:10, color:'var(--ink-3)', marginLeft:6}}, '(x' + nCount + ')')
                  ),
                  React.createElement('div', {className:'tiny c-ink3'},
                    (nPb ? 'Playbook: ' + nPb + '  ' : '') + relTime(nTs)
                  )
                )
              );
            })
      ),
      hiddenNotifs > 0 && React.createElement('div', {className:'tiny c-ink3', style:{marginTop:6, fontStyle:'italic'}},
        'and ' + hiddenNotifs + ' more notification' + (hiddenNotifs === 1 ? '' : 's')
      )
    )
  );
}

function SOARPage(){
  var hqData = useHQ();
  var playbooks = hqData.playbooks;
  var executions = hqData.executions;
  var commands_issued = hqData.commands_issued;

  var completedCount = executions.filter(function(e){ return e.status === 'success' || e.status === 'running'; }).length;
  var pendingCount   = executions.filter(function(e){ return e.status === 'pending'; }).length;

  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}
         data-screen-label="SOAR · War Room Command">
      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:18}}>
        <Section title="Playbook Library" kicker={'Orchestrator · 8007/playbooks · ' + playbooks.length + ' available'}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
            {playbooks.map(function(pb){
              return (
                <PlaybookCard key={pb.id} pb={pb} onRun={function(){
                  console.log('Manual trigger: ' + pb.name + ' (' + pb.id + ')');
                  fetch('/api/8007/execute', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ playbook_id: pb.id })
                  }).catch(function(){});
                }}/>
              );
            })}
          </div>
        </Section>

        <div style={{display:'grid',gap:14,alignContent:'start'}}>
          <Section title="Orchestrator Status" kicker="Real response metrics">
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
              <div className="between">
                <span className="tiny c-ink3">Commands issued</span>
                <span className="num c-violet">{commands_issued || 0}</span>
              </div>
              <div className="between">
                <span className="tiny c-ink3">Playbooks executed</span>
                <span className="num c-cyan">{executions.length}</span>
              </div>
              <div className="between">
                <span className="tiny c-ink3">Pending approvals</span>
                <span className="num" style={{color: pendingCount > 0 ? 'var(--warn)' : 'var(--ok)'}}>{pendingCount}</span>
              </div>
            </div>
          </Section>

          <Section title="Response Radar" kicker="Coverage by domain · execution-derived">
            <ResponseRadar executions={executions} playbooks={playbooks}/>
          </Section>
        </div>
      </div>

      <Section title="Execution Swimlanes" kicker="Parallel playbook runs">
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {executions.map(function(ex, i){ return <ExecutionLane key={ex.id} ex={ex} idx={i}/>; })}
        </div>
      </Section>

      <SoarActionFeed />

      <div className="tiny upper c-ink3" style={{marginTop:4,marginBottom:-6}}>SOAR execution metrics (live from orchestrator)</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14}}>
        {[
          {l:'Executions completed', v: completedCount,       c:'var(--ok)'   },
          {l:'Pending approval',     v: pendingCount,         c:'var(--warn)' },
          {l:'Commands issued',      v: commands_issued || 0, c:'var(--crit)' },
          {l:'Active playbooks',     v: playbooks.length,     c:'var(--cyan)' },
        ].map(function(s){
          return (
            <div key={s.l} className="card card-pad">
              <div className="tiny upper" style={{fontSize:10}}>{s.l}</div>
              <div className="num" style={{fontSize:26,color:s.c,fontWeight:600,marginTop:6}}>{s.v}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window,{ SOARPage });
