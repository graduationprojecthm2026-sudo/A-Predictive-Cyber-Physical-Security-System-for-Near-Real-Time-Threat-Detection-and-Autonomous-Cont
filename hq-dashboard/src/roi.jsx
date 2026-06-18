function ROIPage(){
  const { counts } = useHQ();
  const [orgSize, setOrgSize]   = React.useState('medium');
  const [sector, setSector]     = React.useState(1.0);
  const [massCost, setMassCost] = React.useState(150000);

  const ORG = { small:2900000, medium:4200000, large:9400000, enterprise:14200000 };
  const baseCost = ORG[orgSize] || 4200000;
  const avgBreachCost = baseCost * sector;
  const crit = (counts && counts.critical) || 0;
  const high = (counts && counts.high) || 0;
  const incs = (counts && counts.total) || 0;
  const breachProb = Math.min(0.95, crit*0.15 + high*0.05);
  const expectedDamage = avgBreachCost * breachProb;
  const saved = Math.round(expectedDamage * 0.85);
  const roi = saved / Math.max(1, massCost);
  const fmt = function(n){ return '$' + Math.round(n).toLocaleString(); };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,padding:4}}>
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        <div style={{background:'linear-gradient(135deg,color-mix(in oklab,var(--cyan) 8%,transparent),color-mix(in oklab,var(--violet) 8%,transparent))',border:'1px solid var(--cyan)',borderRadius:12,padding:20}}>
          <div style={{fontSize:13,color:'var(--ink-3)',marginBottom:6}}>Estimated Damage Prevented</div>
          <div style={{fontSize:48,fontWeight:900,color:'var(--ok)',lineHeight:1.1}}>{fmt(saved)}</div>
          <div style={{fontSize:12,color:'var(--ink-3)',marginTop:6}}>Based on {incs} incidents detected &amp; contained</div>
        </div>
        <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16}}>
          <div className="mono" style={{fontSize:11,color:'var(--ink-3)',letterSpacing:1,marginBottom:14}}>CONFIGURE YOUR ORGANIZATION</div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <div style={{fontSize:12,color:'var(--ink-3)',marginBottom:6}}>Organization Size</div>
              <select value={orgSize} onChange={function(e){setOrgSize(e.target.value);}} style={{background:'var(--surface-2)',border:'1px solid var(--line)',color:'var(--ink)',padding:8,borderRadius:8,width:'100%',fontSize:13}}>
                <option value="small">Small (&lt; 500), avg breach: $2.9M</option>
                <option value="medium">Medium (500-5000), $4.2M</option>
                <option value="large">Large (5000+), $9.4M</option>
                <option value="enterprise">Enterprise (50000+), $14.2M</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:'var(--ink-3)',marginBottom:6}}>Industry Sector</div>
              <select value={sector} onChange={function(e){setSector(parseFloat(e.target.value));}} style={{background:'var(--surface-2)',border:'1px solid var(--line)',color:'var(--ink)',padding:8,borderRadius:8,width:'100%',fontSize:13}}>
                <option value="1.0">Education / Research</option>
                <option value="1.3">Healthcare</option>
                <option value="1.5">Financial Services</option>
                <option value="1.4">Government</option>
                <option value="1.2">Manufacturing / Industrial</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:'var(--ink-3)',marginBottom:6}}>MASS Annual License Cost ($)</div>
              <input type="number" value={massCost} onChange={function(e){setMassCost(parseFloat(e.target.value)||0);}} style={{background:'var(--surface-2)',border:'1px solid var(--line)',color:'var(--ink)',padding:'8px 12px',borderRadius:8,fontSize:14,width:'100%',textAlign:'right'}}/>
            </div>
          </div>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16}}>
          <div className="mono" style={{fontSize:11,color:'var(--ink-3)',letterSpacing:1,marginBottom:12}}>ROI BREAKDOWN · USD (thousands)</div>
          {(function(){
            var bars=[
              {label:'Breach Cost', val:avgBreachCost, col:'var(--crit)'},
              {label:'MASS Cost',   val:massCost,      col:'var(--cyan)'},
              {label:'Net Savings', val:saved,         col:'var(--ok)'}
            ];
            var W=420,H=240,P=40;
            var maxV=Math.max(1,avgBreachCost,massCost,saved);
            var bw=70, gap=(W-2*P-bars.length*bw)/(bars.length-1);
            return (
              <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:240}}>
                {bars.map(function(b,i){
                  var bh=(b.val/maxV)*(H-2*P);
                  var x=P+i*(bw+gap);
                  return (
                    <g key={b.label}>
                      <rect x={x} y={H-P-bh} width={bw} height={bh} rx="6" fill={b.col}></rect>
                      <text x={x+bw/2} y={H-P-bh-8} textAnchor="middle" fill="var(--ink-2)" fontSize="12" fontWeight="700">${Math.round(b.val/1000).toLocaleString()}k</text>
                      <text x={x+bw/2} y={H-P+18} textAnchor="middle" fill="var(--ink-3)" fontSize="11">{b.label}</text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16,textAlign:'center'}}>
            <div style={{fontSize:12,color:'var(--ink-3)'}}>ROI Ratio</div>
            <div style={{fontSize:32,fontWeight:800,color:'var(--ok)'}}>{roi.toFixed(1)}x</div>
            <div style={{fontSize:11,color:'var(--ink-3)'}}>return on investment</div>
          </div>
          <div style={{background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,padding:16,textAlign:'center'}}>
            <div style={{fontSize:12,color:'var(--ink-3)'}}>Mean Time to Detect</div>
            <div style={{fontSize:32,fontWeight:800,color:'var(--cyan)'}}>~8s</div>
            <div style={{fontSize:11,color:'var(--ink-3)'}}>design target · vs industry ~197 days</div>
          </div>
        </div>
        <div style={{fontSize:10,color:'var(--ink-4)',lineHeight:1.5,padding:'4px 2px'}}>
          Damage-prevented model: breach probability = min(95%, critical×15% + high×5%), applied to industry-average breach cost × sector factor, with MASS containing 85%. Incident counts are live; org size, sector, and cost are user assumptions.
        </div>
      </div>
    </div>
  );
}
Object.assign(window,{ROIPage});
