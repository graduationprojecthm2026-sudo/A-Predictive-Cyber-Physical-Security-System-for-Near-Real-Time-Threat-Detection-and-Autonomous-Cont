// Cross-Domain Correlation Engine: "Neural Synapse Web"

var DOMAIN_TO_NODE = {
  'iot': 'iot',
  'data_network': 'data', 'data': 'data', 'network': 'data', 'endpoint': 'data',
  'physical_access': 'pac', 'pac': 'pac',
  'identity': 'hq', 'hq': 'hq',
};
var DOMAIN_LABELS = {
  'iot': 'IoT Network', 'pac': 'Physical Access',
  'data': 'Data Network', 'hq': 'HQ Intelligence',
};

function ForceGraph({edges}){
  var hqData = useHQ();
  var t = hqData.t;
  var W = 720, H = 420;
  var domains = [
    { id:'iot',  label:'IoT Network',     color:'var(--ok)',     x: W*0.15, y: H*0.50 },
    { id:'pac',  label:'Physical Access', color:'var(--warn)',   x: W*0.50, y: H*0.85 },
    { id:'data', label:'Data Network',    color:'var(--cyan)',   x: W*0.85, y: H*0.50 },
    { id:'hq',   label:'HQ Intelligence', color:'var(--violet)', x: W*0.50, y: H*0.15 },
  ];
  var map = {};
  domains.forEach(function(d){ map[d.id] = d; });
  var edgeArr = edges || [];

  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} style={{width:'100%',height:H,display:'block'}}>
      <defs>
        <radialGradient id="ripple-g">
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity=".5"/>
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0"/>
        </radialGradient>
      </defs>

      {edgeArr.map(function(c, i){
        var na = map[c.a], nb = map[c.b];
        if (!na || !nb) return null;
        var w = 1 + c.weight * 4;
        var phase = ((t + i) % 6) / 2;
        var shootX = na.x + (nb.x - na.x) * phase;
        var shootY = na.y + (nb.y - na.y) * phase;
        return (
          <g key={i}>
            <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke="var(--cyan)" strokeOpacity={0.18 + c.weight * 0.4}
              strokeWidth={w}
              style={{filter:'drop-shadow(0 0 ' + (4 + c.weight * 8) + 'px var(--cyan))'}}/>
            {((t + i) % 6 < 2) && (
              <circle cx={shootX} cy={shootY} r="6" fill="#fff" opacity=".85"
                style={{filter:'drop-shadow(0 0 10px var(--cyan))'}}/>
            )}
          </g>
        );
      })}

      {(function(){
        var sorted = edgeArr.slice().sort(function(ea, eb){ return eb.weight - ea.weight; });
        var top = sorted[0];
        if (!top) return null;
        var na = map[top.a], nb = map[top.b];
        if (!na || !nb) return null;
        var cx = (na.x + nb.x) / 2, cy = (na.y + nb.y) / 2;
        return (
          <g>
            {[0,1,2].map(function(ri){
              return (
                <circle key={ri} cx={cx} cy={cy} r="20" fill="none" stroke="var(--cyan)" strokeWidth="1.5">
                  <animate attributeName="r" from="20" to="120" dur="3s" begin={ri + 's'} repeatCount="indefinite"/>
                  <animate attributeName="opacity" from=".9" to="0" dur="3s" begin={ri + 's'} repeatCount="indefinite"/>
                </circle>
              );
            })}
          </g>
        );
      })()}

      {domains.map(function(d, di){
        var incidents = Math.floor(2 + ((Math.sin(t / 5 + di) + 1) / 2) * 7);
        return (
          <g key={d.id}>
            {Array.from({length: incidents}).map(function(_, i){
              var ang = (t / 3 + i * (Math.PI * 2 / incidents));
              var r = 42;
              var cx = d.x + Math.cos(ang) * r, cy = d.y + Math.sin(ang) * r;
              return <circle key={i} cx={cx} cy={cy} r="2.5" fill={d.color} opacity=".85"
                style={{filter:'drop-shadow(0 0 4px ' + d.color + ')'}}/>;
            })}
            <circle cx={d.x} cy={d.y} r="30" fill="var(--bg-2)" stroke={d.color} strokeWidth="2"
              style={{filter:'drop-shadow(0 0 12px ' + d.color + ')'}}/>
            <text x={d.x} y={d.y - 3} textAnchor="middle" fontSize="11" fill={d.color}
              fontFamily="JetBrains Mono" fontWeight="600">{d.label.split(' ')[0]}</text>
            <text x={d.x} y={d.y + 9} textAnchor="middle" fontSize="9" fill={d.color}
              fontFamily="JetBrains Mono">{d.label.split(' ').slice(1).join(' ')}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CorrelationsPage(){
  var hqData = useHQ();
  var correlations = hqData.correlations;
  var correlations_active = hqData.correlations_active;

  var domainEdges = React.useMemo(function(){
    var edgeCounts = {};
    var now = Date.now();
    var thirtyMin = 30 * 60 * 1000;
    (correlations || []).filter(function(c) {
      var ts = c.created_at ? new Date(c.created_at).getTime() : 0;
      return (now - ts) < thirtyMin;
    }).forEach(function(c) {
      var nodeA = DOMAIN_TO_NODE[c.a] || null;
      var nodeB = DOMAIN_TO_NODE[c.b] || null;
      if (!nodeA || !nodeB || nodeA === nodeB) return;
      var key = [nodeA, nodeB].sort().join('-');
      if (!edgeCounts[key]) edgeCounts[key] = { count: 0, maxWeight: 0 };
      edgeCounts[key].count += 1;
      if ((c.weight || 0) > edgeCounts[key].maxWeight) edgeCounts[key].maxWeight = c.weight || 0;
    });
    var total = (correlations && correlations.length > 0) ? correlations.length : 1;
    return Object.keys(edgeCounts).map(function(key) {
      var parts = key.split('-');
      return {
        a: parts[0], b: parts[1],
        weight: edgeCounts[key].count / total,
        count: edgeCounts[key].count,
        maxWeight: edgeCounts[key].maxWeight,
      };
    }).sort(function(ea, eb){ return eb.count - ea.count; });
  }, [correlations]);

  var events = React.useMemo(function(){
    var arr = (correlations || []).filter(function(c) {
      var ts = c.created_at ? new Date(c.created_at).getTime() : 0;
      return (Date.now() - ts) < 30 * 60 * 1000;
    });
    if (arr.length === 0) return [];
    return arr.slice(-14).reverse().map(function(c) {
      var sev = (c.severity || (c.weight > 0.75 ? 'critical' : c.weight > 0.55 ? 'high' : 'medium')).toLowerCase();
      return {
        ts:    c.created_at ? new Date(c.created_at).getTime() : 0,
        label: c.label || 'Cross-domain correlation',
        conf:  c.weight || 0.5,
        sev:   sev,
      };
    });
  }, [correlations]);

  var sevColor = { critical:'var(--crit)', high:'var(--hi)', medium:'var(--warn)' };

  var historyRows = React.useMemo(function(){
    var now = Date.now();
    var thirtyMin = 30 * 60 * 1000;
    return (correlations || []).slice().sort(function(ra, rb){
      var ta = ra.created_at ? new Date(ra.created_at).getTime() : 0;
      var tb = rb.created_at ? new Date(rb.created_at).getTime() : 0;
      return tb - ta;
    }).map(function(c){
      var ts = c.created_at ? new Date(c.created_at).getTime() : 0;
      var timeStr = ts ? new Date(ts).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',hour12:true}) : '--:--';
      var rawType = c.correlation_type || 'Unknown';
      var typeStr = rawType.replace(/_/g, ' ').replace(/\b\w/g, function(ch){ return ch.toUpperCase(); });
      var domainsArr = c.domains_involved;
      var domainsStr = (domainsArr && domainsArr.length > 0)
        ? domainsArr.map(function(dm){ return dm.replace(/_/g, ' ').replace(/\b\w/g, function(ch){ return ch.toUpperCase(); }); }).join(' + ')
        : (c.details && c.details.detail ? c.details.detail.slice(0, 40) : '--');
      var detailStr = (c.details && c.details.detail) ? c.details.detail : '--';
      var isActive = ts > 0 && (now - ts) < thirtyMin;
      return { timeStr: timeStr, typeStr: typeStr, domainsStr: domainsStr, detailStr: detailStr, isActive: isActive };
    });
  }, [correlations]);

  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}
         data-screen-label="Correlations · Neural Synapse Web">
      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:18}}>
        <Section title="Force-Directed Correlation Web" kicker="4 domain nodes · weighted synapse edges"
          right={<span className="tag c-cyan">{correlations_active} active</span>}>
          <ForceGraph edges={domainEdges}/>
        </Section>

        <div style={{display:'grid',gap:14,alignContent:'start'}}>
          <Section title="Strongest Edges" kicker="By correlation count">
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {domainEdges.length === 0 ? (
                <div className="tiny c-ink3">No correlations detected yet.</div>
              ) : domainEdges.map(function(e, i){
                var labelA = DOMAIN_LABELS[e.a] || e.a.toUpperCase();
                var labelB = DOMAIN_LABELS[e.b] || e.b.toUpperCase();
                return (
                  <div key={i}>
                    <div className="between">
                      <span className="mono tiny" style={{color:'var(--ink-2)'}}>{labelA} → {labelB}</span>
                      <span className="num c-cyan">{e.count}</span>
                    </div>
                    <div className="tiny c-ink3" style={{margin:'2px 0 6px'}}>
                      {e.count} correlations
                    </div>
                    <div style={{height:3,background:'var(--surface-2)',borderRadius:99}}>
                      <div style={{width:(e.weight * 100) + '%',height:'100%',background:'var(--cyan)',
                        borderRadius:99,boxShadow:'0 0 6px var(--cyan)'}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>

      <Section title="Correlation Event Ribbon" kicker="Right-to-left timeline · last 4 minutes">
        <div style={{position:'relative',overflow:'hidden',height:120}}>
          <div style={{position:'absolute',inset:0,
            background:'linear-gradient(90deg, var(--bg) 0%, transparent 8%, transparent 92%, var(--bg) 100%)',
            pointerEvents:'none',zIndex:2}}/>
          {events.length === 0 ? (
            <div className="tiny c-ink3" style={{display:'flex',alignItems:'center',
              justifyContent:'center',height:'100%',textAlign:'center'}}>
              No correlations detected. Waiting for multi-domain incidents.
            </div>
          ) : (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',gap:14,padding:'0 24px',
              animation:'slide-left 30s linear infinite'}}>
              <style>{'@keyframes slide-left{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
              {events.concat(events).map(function(e, i){
                var sc = sevColor[e.sev] || 'var(--warn)';
                var tsStr = e.ts ? new Date(e.ts).toLocaleTimeString().slice(0,5) : '--:--';
                return (
                  <div key={i} style={{
                    minWidth:220,padding:12,borderRadius:10,border:'1px solid var(--line)',
                    background:'oklch(0.20 0.025 252 / .8)',
                    borderLeft:'3px solid ' + sc,
                    boxShadow:'0 0 18px color-mix(in oklab, ' + sc + ' 18%, transparent)',
                  }}>
                    <div className="between" style={{marginBottom:6}}>
                      <span className="tag" style={{color:sc,borderColor:'color-mix(in oklab, ' + sc + ' 40%, var(--line))'}}>{e.sev}</span>
                      <span className="mono tiny c-ink3">{tsStr}</span>
                    </div>
                    <div className="tiny" style={{color:'var(--ink)'}}>{e.label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      {(function(){
        var totalCount = historyRows.length;
        var activeCount = historyRows.filter(function(r){ return r.isActive; }).length;
        var archivedCount = totalCount - activeCount;
        return (
          <Section title="Session History" kicker="All correlations since system start"
            right={totalCount > 0 ? (
              <span className="mono tiny c-ink3">
                {totalCount} total&nbsp;
                <span style={{color:'var(--ok)'}}>({activeCount} active</span>,&nbsp;
                <span style={{color:'var(--ink-3)'}}>{archivedCount} archived)</span>
              </span>
            ) : null}>
            {totalCount === 0 ? (
              <div className="tiny c-ink3" style={{padding:'18px 0',textAlign:'center'}}>
                No correlations recorded this session
              </div>
            ) : (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontFamily:'JetBrains Mono, monospace',fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--line)'}}>
                      {['Time','Type','Domains','Detail','Status'].map(function(h){
                        return (
                          <th key={h} style={{padding:'6px 10px',textAlign:'left',color:'var(--ink-3)',
                            fontWeight:600,letterSpacing:'.06em',fontSize:11,whiteSpace:'nowrap'}}>
                            {h}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map(function(r, i){
                      return (
                        <tr key={i} style={{
                          borderBottom:'1px solid color-mix(in oklab, var(--line) 50%, transparent)',
                          opacity: r.isActive ? 1 : 0.5,
                        }}>
                          <td style={{padding:'7px 10px',whiteSpace:'nowrap',color:'var(--ink-2)'}}>{r.timeStr}</td>
                          <td style={{padding:'7px 10px',whiteSpace:'nowrap',color:'var(--ink)'}}>{r.typeStr}</td>
                          <td style={{padding:'7px 10px',color:'var(--cyan)',maxWidth:220,overflow:'hidden',
                            textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.domainsStr}</td>
                          <td style={{padding:'7px 10px',color:'var(--ink-2)',maxWidth:260,overflow:'hidden',
                            textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.detailStr}</td>
                          <td style={{padding:'7px 10px',whiteSpace:'nowrap'}}>
                            {r.isActive ? (
                              <span style={{
                                display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,
                                fontWeight:700,letterSpacing:'.08em',
                                background:'color-mix(in oklab, var(--ok) 15%, transparent)',
                                color:'var(--ok)',border:'1px solid color-mix(in oklab, var(--ok) 40%, transparent)',
                              }}>ACTIVE</span>
                            ) : (
                              <span style={{
                                display:'inline-block',padding:'2px 8px',borderRadius:4,fontSize:10,
                                fontWeight:700,letterSpacing:'.08em',
                                background:'color-mix(in oklab, var(--ink-3) 12%, transparent)',
                                color:'var(--ink-3)',border:'1px solid color-mix(in oklab, var(--ink-3) 30%, transparent)',
                              }}>ARCHIVED</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        );
      })()}
    </div>
  );
}

Object.assign(window,{ CorrelationsPage });
