function TenantsPage(){
  const { threat_level, agents_healthy, agents_total, counts } = useHQ();
  const tcol = { CRITICAL:'var(--crit)', HIGH:'var(--hi)', MEDIUM:'var(--warn)', LOW:'var(--ok)' }[threat_level] || 'var(--ok)';
  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}>
      <div style={{background:'color-mix(in oklab, var(--cyan) 6%, transparent)',border:'1px solid color-mix(in oklab, var(--cyan) 30%, var(--line))',borderRadius:10,padding:14,fontSize:13,color:'var(--ink-2)'}}>
        <strong style={{color:'var(--cyan)'}}>Designed scaling capability.</strong> MASS is architected to manage multiple campuses from one deployment, each with isolated data and agents. <strong style={{color:'var(--ink)'}}>Main Campus is the deployed proof-of-concept;</strong> other tenants below are the planned roadmap (design only, not deployed).
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
        <div style={{padding:16,borderRadius:12,border:'1px solid '+tcol,background:'color-mix(in oklab, '+tcol+' 8%, transparent)'}}>
          <div className="between">
            <div style={{fontWeight:700,fontSize:15}}>Main Campus</div>
            <span className="tag" style={{color:'var(--ok)',borderColor:'color-mix(in oklab, var(--ok) 45%, var(--line))'}}>● LIVE · DEPLOYED</span>
          </div>
          <div className="tiny c-ink3" style={{marginTop:8}}>Galala University · 3 networks (IoT · PAC · Data)</div>
          <div className="tiny c-ink3" style={{marginTop:3}}>Buildings A · B · C + HQ · ~1080 users</div>
          <div className="between" style={{marginTop:12}}>
            <span className="mono tiny c-ink3">{agents_healthy}/{agents_total} agents</span>
            <span className="tag" style={{color:tcol,borderColor:'color-mix(in oklab, '+tcol+' 45%, var(--line))'}}>{threat_level}</span>
          </div>
        </div>
        <div style={{padding:16,borderRadius:12,border:'1px dashed var(--line-2)',background:'var(--surface)',opacity:.72}}>
          <div className="between">
            <div style={{fontWeight:700,fontSize:15}}>Overseas Branch</div>
            <span className="tag" style={{color:'var(--ink-3)'}}>DESIGN · NOT DEPLOYED</span>
          </div>
          <div className="tiny c-ink3" style={{marginTop:8}}>Limited staff · VPN tunnel to HQ</div>
          <div className="tiny c-ink3" style={{marginTop:3}}>Planned roadmap (per network design doc)</div>
          <div className="between" style={{marginTop:12}}>
            <span className="mono tiny c-ink3">0 agents</span>
            <span className="tag" style={{color:'var(--ink-3)'}}>PLANNED</span>
          </div>
        </div>
        <div style={{padding:16,borderRadius:12,border:'1px dashed var(--line-2)',background:'var(--surface)',opacity:.55,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',textAlign:'center'}}>
          <div style={{fontWeight:700,fontSize:15,color:'var(--ink-2)'}}>+ Add Campus</div>
          <div className="tiny c-ink3" style={{marginTop:6}}>Deploy MASS to another site</div>
          <div className="tiny c-ink3" style={{marginTop:3}}>Future capability</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16}}>
          <div className="mono" style={{fontSize:11,color:'var(--ink-3)',letterSpacing:1,marginBottom:4}}>CROSS-TENANT INCIDENTS</div>
          <div className="tiny c-ink3" style={{marginBottom:12}}>Main Campus = live · others = design estimate</div>
          {(function(){
            var rows=[
              {name:'Main Campus', val:(counts&&counts.total)||0, col:'var(--cyan)', real:true},
              {name:'Overseas',    val:0, col:'var(--ink-3)', real:false},
              {name:'+ Future',    val:0, col:'var(--ink-4)', real:false}
            ];
            var W=420,H=210,P=36;
            var maxV=Math.max(1,Math.max.apply(null,rows.map(function(r){return r.val;})));
            var bw=64, gap=(W-2*P-rows.length*bw)/(rows.length-1);
            return (
              <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:210}}>
                {rows.map(function(r,i){
                  var bh=(r.val/maxV)*(H-2*P);
                  var x=P+i*(bw+gap);
                  return (
                    <g key={r.name}>
                      <rect x={x} y={H-P-bh} width={bw} height={Math.max(bh,2)} rx="5" fill={r.col} opacity={r.real?1:0.4}></rect>
                      <text x={x+bw/2} y={H-P-bh-7} textAnchor="middle" fill="var(--ink-2)" fontSize="12" fontWeight="700">{r.val}</text>
                      <text x={x+bw/2} y={H-P+16} textAnchor="middle" fill="var(--ink-3)" fontSize="10">{r.name}</text>
                      {!r.real && <text x={x+bw/2} y={H-P+28} textAnchor="middle" fill="var(--ink-4)" fontSize="8">design</text>}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16}}>
          <div className="mono" style={{fontSize:11,color:'var(--ink-3)',letterSpacing:1,marginBottom:12}}>TENANT HEALTH OVERVIEW</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{padding:12,borderRadius:8,background:'var(--surface-2)',border:'1px solid var(--line)'}}>
              <div className="between">
                <strong>Main Campus</strong>
                <span className="tag" style={{color:tcol,borderColor:'color-mix(in oklab, '+tcol+' 45%, var(--line))'}}>{threat_level}</span>
              </div>
              <div className="tiny c-ink3" style={{marginTop:6}}>{agents_healthy}/{agents_total} agents reporting · live</div>
            </div>
            <div style={{padding:12,borderRadius:8,background:'var(--surface-2)',border:'1px dashed var(--line-2)',opacity:.7}}>
              <div className="between">
                <strong>Overseas Branch</strong>
                <span className="tag" style={{color:'var(--ink-3)'}}>DESIGN</span>
              </div>
              <div className="tiny c-ink3" style={{marginTop:6}}>Planned · VPN tunnel to HQ · not deployed</div>
            </div>
            <div style={{padding:12,borderRadius:8,background:'var(--surface-2)',border:'1px dashed var(--line-2)',opacity:.55}}>
              <div className="between">
                <strong>Additional Campuses</strong>
                <span className="tag" style={{color:'var(--ink-3)'}}>FUTURE</span>
              </div>
              <div className="tiny c-ink3" style={{marginTop:6}}>Roadmap · one-deployment-per-site model</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
Object.assign(window,{TenantsPage});
