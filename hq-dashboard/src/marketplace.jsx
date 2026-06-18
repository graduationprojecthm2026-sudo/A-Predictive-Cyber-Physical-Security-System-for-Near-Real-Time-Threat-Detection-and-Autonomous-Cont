function MarketplacePage(){
  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}>
      <div style={{background:'linear-gradient(135deg, color-mix(in oklab, var(--cyan) 10%, transparent), color-mix(in oklab, var(--violet) 10%, transparent))',border:'1px solid color-mix(in oklab, var(--cyan) 35%, var(--line))',borderRadius:12,padding:18}}>
        <div style={{color:'var(--cyan)',fontWeight:700,fontSize:15,marginBottom:6}}>Business model · future vision</div>
        <div style={{fontSize:13,color:'var(--ink-2)',lineHeight:1.6}}>MASS is designed as a <strong style={{color:'var(--ink)'}}>platform, not just a product</strong>. Each agent is independently deployable and could be offered via REST API. Pricing below is <strong style={{color:'var(--ink)'}}>illustrative</strong>: a commercial roadmap, not an operational service.</div>
      </div>
      {(function(){
        var APIS=[
          {icon:'📡', name:'IoT Monitoring API',   price:'$299/mo', desc:'Real-time IoT sensor anomaly detection. Integrates with any MQTT broker.', tags:['REST','MQTT','Kafka'], ep:'/sensors · /alerts · /thresholds'},
          {icon:'🚪', name:'Physical Access API',   price:'$199/mo', desc:'RFID/badge anomaly detection, impossible travel, brute-force detection.', tags:['REST','RFID','LDAP'], ep:'/access-events · /anomalies · /cards'},
          {icon:'🌐', name:'Network Detection API', price:'$499/mo', desc:'NDR + EDR combined. Port scan, exfiltration, ransomware, YARA matching.', tags:['REST','Zeek','Suricata'], ep:'/flows · /alerts · /yara-matches'},
          {icon:'🧠', name:'Correlation Engine API',price:'$799/mo', desc:'Cross-domain APT correlation. Plugs into any existing SIEM for enrichment.', tags:['REST','SIEM','Splunk'], ep:'/correlations · /campaigns · /apt-score'},
          {icon:'⚡', name:'SOAR Automation API',    price:'$999/mo', desc:'Automated playbook execution. Trigger from any alert source.', tags:['REST','Webhook','YAML'], ep:'/playbooks · /execute · /approve'},
          {icon:'🛡️', name:'MASS Full Platform',    price:'$1,999/mo', desc:'All agents + SOC dashboard + compliance reports + multi-tenant.', tags:['All APIs','Dashboard','AI'], ep:'Complete deployment', feat:true}
        ];
        return (
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
            {APIS.map(function(a){
              return (
                <div key={a.name} style={{padding:16,borderRadius:12,border:'1px solid '+(a.feat?'color-mix(in oklab, var(--cyan) 50%, var(--line))':'var(--line)'),background:a.feat?'color-mix(in oklab, var(--cyan) 7%, transparent)':'var(--surface)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <span style={{fontSize:24}}>{a.icon}</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{a.name}</div>
                      <div style={{fontSize:11,color:'var(--ok)'}}>{a.price}</div>
                    </div>
                  </div>
                  <div className="tiny c-ink3" style={{marginBottom:10,lineHeight:1.5}}>{a.desc}</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
                    {a.tags.map(function(tg){ return <span key={tg} className="tag" style={{fontSize:9}}>{tg}</span>; })}
                  </div>
                  <div className="mono" style={{fontSize:10,color:'var(--ink-4)'}}>{a.ep}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16}}>
        <div className="mono" style={{fontSize:11,color:'var(--ink-3)',letterSpacing:1,marginBottom:4}}>REVENUE PROJECTION</div>
        <div className="tiny c-ink3" style={{marginBottom:12}}>Illustrative · hypothetical adoption model, not actual revenue</div>
        {(function(){
          var yrs=[{y:'Y1',v:120},{y:'Y2',v:340},{y:'Y3',v:720},{y:'Y4',v:1250},{y:'Y5',v:2100}];
          var W=640,H=200,P=36;
          var maxV=2100;
          var bw=70, gap=(W-2*P-yrs.length*bw)/(yrs.length-1);
          return (
            <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:200}}>
              {yrs.map(function(r,i){
                var bh=(r.v/maxV)*(H-2*P);
                var x=P+i*(bw+gap);
                return (
                  <g key={r.y}>
                    <rect x={x} y={H-P-bh} width={bw} height={bh} rx="5" fill="var(--cyan)" opacity={0.5+i*0.1}></rect>
                    <text x={x+bw/2} y={H-P-bh-7} textAnchor="middle" fill="var(--ink-2)" fontSize="11" fontWeight="700">${r.v}k</text>
                    <text x={x+bw/2} y={H-P+16} textAnchor="middle" fill="var(--ink-3)" fontSize="11">{r.y}</text>
                  </g>
                );
              })}
            </svg>
          );
        })()}
      </div>
    </div>
  );
}
Object.assign(window,{MarketplacePage});
