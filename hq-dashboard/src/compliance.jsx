// Compliance: NIST CSF 2.0 / FERPA / ISO 27001
function CompliancePage() {
  const { agents, agents_healthy, counts, threat_level, correlations_active } = useHQ();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // ── Radar Chart: NIST CSF 6 Functions ─────────────────────────────────
  function RadarChart({ functions }) {
    const cx = 160, cy = 160, r = 120;
    const sides = functions.length;
    function point(i, pct) {
      const angle = (Math.PI * 2 * i / sides) - Math.PI / 2;
      const dist  = r * pct / 100;
      return [cx + dist * Math.cos(angle), cy + dist * Math.sin(angle)];
    }
    function labelPoint(i) {
      const angle = (Math.PI * 2 * i / sides) - Math.PI / 2;
      const dist  = r + 22;
      return [cx + dist * Math.cos(angle), cy + dist * Math.sin(angle)];
    }
    const gridLevels = [25, 50, 75, 100];
    const scorePath = functions.map((f, i) => {
      const [x, y] = point(i, f.score);
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ') + ' Z';
    return (
      <svg viewBox="0 0 320 320" style={{width:'100%',maxWidth:320}}>
        {/* Grid circles */}
        {gridLevels.map(lvl => {
          const pts = functions.map((_,i) => point(i, lvl));
          const d = pts.map((p,i) => (i===0?'M':'L') + p[0] + ',' + p[1]).join(' ') + ' Z';
          return <path key={lvl} d={d} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>;
        })}
        {/* Spokes */}
        {functions.map((_,i) => {
          const [x,y] = point(i, 100);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>;
        })}
        {/* Score area */}
        <path d={scorePath} fill="rgba(139,92,246,0.15)" stroke="var(--violet)" strokeWidth="2"/>
        {/* Score dots */}
        {functions.map((f,i) => {
          const [x,y] = point(i, f.score);
          return <circle key={i} cx={x} cy={y} r="4" fill={f.color} stroke="var(--surface)" strokeWidth="2"/>;
        })}
        {/* Labels */}
        {functions.map((f,i) => {
          const [x,y] = labelPoint(i);
          return (
            <g key={i}>
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill={f.color} fontSize="11" fontWeight="700">{f.id}</text>
              <text x={x} y={y+13} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.4)" fontSize="9">{f.score}%</text>
            </g>
          );
        })}
        {/* Center label */}
        <text x={cx} y={cy-8} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="10">NIST CSF</text>
        <text x={cx} y={cy+8} textAnchor="middle" fill="var(--violet)" fontSize="14" fontWeight="800">{Math.round(functions.reduce((s,f)=>s+f.score,0)/functions.length)}%</text>
      </svg>
    );
  }

  // ── Gauge: Overall Compliance Score ────────────────────────────────────
  function ComplianceGauge({ score }) {
    const r = 80, cx = 120, cy = 110;
    const startAngle = Math.PI * 0.75;
    const endAngle   = Math.PI * 2.25;
    const scoreAngle = startAngle + (endAngle - startAngle) * score / 100;
    function arc(fromA, toA, radius) {
      const x1 = cx + radius * Math.cos(fromA);
      const y1 = cy + radius * Math.sin(fromA);
      const x2 = cx + radius * Math.cos(toA);
      const y2 = cy + radius * Math.sin(toA);
      const large = toA - fromA > Math.PI ? 1 : 0;
      return 'M '+x1+' '+y1+' A '+radius+' '+radius+' 0 '+large+' 1 '+x2+' '+y2;
    }
    const color = score >= 90 ? 'var(--ok)' : score >= 70 ? 'var(--warn)' : 'var(--crit)';
    const label = score >= 90 ? 'COMPLIANT' : score >= 70 ? 'PARTIAL' : 'AT RISK';
    return (
      <svg viewBox="0 0 240 160" style={{width:'100%',maxWidth:240}}>
        {/* Background arc */}
        <path d={arc(startAngle, endAngle, r)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" strokeLinecap="round"/>
        {/* Score arc */}
        <path d={arc(startAngle, scoreAngle, r)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"/>
        {/* Score text */}
        <text x={cx} y={cy+4} textAnchor="middle" fill={color} fontSize="28" fontWeight="800">{score}%</text>
        <text x={cx} y={cy+22} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">{label}</text>
        {/* Tick marks */}
        {[0,25,50,75,100].map(v => {
          const angle = startAngle + (endAngle - startAngle) * v / 100;
          const x1 = cx + (r-20) * Math.cos(angle);
          const y1 = cy + (r-20) * Math.sin(angle);
          const x2 = cx + (r-10) * Math.cos(angle);
          const y2 = cy + (r-10) * Math.sin(angle);
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>;
        })}
      </svg>
    );
  }

  const NIST_FUNCTIONS = [
    {
      id: 'GV', name: 'GOVERN', color: 'var(--violet)',
      score: 92,
      controls: [
        { id: 'GV.OC', name: 'Organizational Context',     status: 'compliant',    note: 'Campus security policy documented and approved' },
        { id: 'GV.RM', name: 'Risk Management Strategy',   status: 'compliant',    note: 'MASS risk register maintained, reviewed monthly' },
        { id: 'GV.RR', name: 'Roles & Responsibilities',   status: 'compliant',    note: 'HQ Manager, Building Managers, SOC roles defined' },
        { id: 'GV.PO', name: 'Policy',                     status: 'compliant',    note: 'Acceptable use, incident response policies active' },
      ]
    },
    {
      id: 'ID', name: 'IDENTIFY', color: 'var(--cyan)',
      score: 88,
      controls: [
        { id: 'ID.AM', name: 'Asset Management',           status: 'compliant',    note: '1080+ campus devices tracked across 3 VLANs' },
        { id: 'ID.RA', name: 'Risk Assessment',            status: 'compliant',    note: 'Automated risk scoring via Analytical Agent' },
        { id: 'ID.IM', name: 'Improvement',                status: 'partial',      note: 'Learning Agent retraining. 20 runs completed' },
      ]
    },
    {
      id: 'PR', name: 'PROTECT', color: 'var(--ok)',
      score: 95,
      controls: [
        { id: 'PR.AA', name: 'Identity Management & Auth', status: 'compliant',    note: 'LDAP + RFID + Face Recognition + Fingerprint' },
        { id: 'PR.AT', name: 'Awareness & Training',       status: 'compliant',    note: 'Security team trained on MASS SOC dashboard' },
        { id: 'PR.DS', name: 'Data Security',              status: 'compliant',    note: 'AES-128 + TLS 1.3 across all agent channels' },
        { id: 'PR.PS', name: 'Platform Security',          status: 'compliant',    note: 'VLAN segmentation, IoT isolation, DMZ enforced' },
        { id: 'PR.IR', name: 'Technology Infrastructure',  status: 'compliant',    note: 'Docker containers, isolated networks, mTLS' },
      ]
    },
    {
      id: 'DE', name: 'DETECT', color: 'var(--warn)',
      score: 97,
      controls: [
        { id: 'DE.CM', name: 'Continuous Monitoring',      status: 'compliant',    note: agents_healthy + '/13 agents monitoring live' },
        { id: 'DE.AE', name: 'Adverse Event Analysis',     status: 'compliant',    note: counts.total + ' incidents detected & classified live' },
      ]
    },
    {
      id: 'RS', name: 'RESPOND', color: 'var(--hi)',
      score: 90,
      controls: [
        { id: 'RS.MA', name: 'Incident Management',        status: 'compliant',    note: 'Orchestrator Agent executing SOAR playbooks' },
        { id: 'RS.AN', name: 'Incident Analysis',          status: 'compliant',    note: 'Analytical Agent. Kill chain mapping active' },
        { id: 'RS.CO', name: 'Incident Response Reporting',status: 'compliant',    note: 'Forensic Agent. Evidence bundles with SHA-256 chain of custody' },
        { id: 'RS.MI', name: 'Incident Mitigation',        status: 'partial',      note: 'SOAR containment. PAC agents pending deployment' },
      ]
    },
    {
      id: 'RC', name: 'RECOVER', color: 'var(--crit)',
      score: 78,
      controls: [
        { id: 'RC.RP', name: 'Incident Recovery Plan',     status: 'partial',      note: 'Recovery playbooks defined, full test pending' },
        { id: 'RC.CO', name: 'Incident Recovery Comms',    status: 'partial',      note: 'Twilio SMS alerts configured, not fully tested' },
      ]
    },
  ];
  NIST_FUNCTIONS.forEach(function(f){
    var m={compliant:100,partial:50,gap:0};
    var t=0; f.controls.forEach(function(c){t+=(m[c.status]||0);});
    f.score=Math.round(t/f.controls.length);
  });

  const FERPA_CONTROLS = [
    { name: 'Student data access logging',        status: 'compliant', note: 'All SIS queries logged via Compliance Agent' },
    { name: 'Investigation data minimization',    status: 'compliant', note: 'Agents query only necessary student records' },
    { name: 'Data retention enforcement',         status: 'compliant', note: 'Auto-purge schedules per data classification' },
    { name: 'Audit trail for data access',        status: 'compliant', note: 'PostgreSQL audit log. Immutable timestamps' },
    { name: 'Incident report anonymization',      status: 'partial',   note: 'IOC sharing anonymized. Internal reports pending' },
  ];

  const overallScore = Math.round(
    NIST_FUNCTIONS.reduce((s, f) => s + f.score, 0) / NIST_FUNCTIONS.length
  );

  function statusColor(s) {
    return s === 'compliant' ? 'var(--ok)' : s === 'partial' ? 'var(--warn)' : 'var(--crit)';
  }

  function statusLabel(s) {
    return s === 'compliant' ? '✓ COMPLIANT' : s === 'partial' ? '⚠ PARTIAL' : '✗ GAP';
  }

  function ScoreBar({ score, color }) {
    return (
      <div style={{display:'flex', alignItems:'center', gap: 8}}>
        <div style={{flex:1, height: 6, borderRadius: 3, background:'rgba(255,255,255,0.08)'}}>
          <div style={{width: score+'%', height:'100%', borderRadius: 3, background: color}}/>
        </div>
        <span style={{fontSize: 12, fontWeight: 700, color: color, minWidth: 36}}>{score}%</span>
      </div>
    );
  }

  return (
    <div style={{padding: 24, height:'100%', overflowY:'auto'}}>

      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 24}}>
        <div>
          <div style={{fontSize: 22, fontWeight: 700, color:'var(--ink)', letterSpacing:'-0.5px'}}>
            Compliance & Governance
          </div>
          <div style={{fontSize: 12, color:'var(--ink-3)', marginTop: 2}}>
            NIST CSF 2.0 · FERPA · ISO 27001 · Report Date: {dateStr}
          </div>
        </div>
        <div style={{display:'flex', gap: 12, alignItems:'center'}}>
          <div style={{textAlign:'center', padding:'12px 20px', borderRadius: 12, background:'var(--surface)', border:'1px solid var(--line)'}}>
            <div style={{fontSize: 28, fontWeight: 800, color: overallScore >= 90 ? 'var(--ok)' : 'var(--warn)'}}>{overallScore}%</div>
            <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>OVERALL SCORE</div>
          </div>
          <div style={{textAlign:'center', padding:'12px 20px', borderRadius: 12, background:'var(--surface)', border:'1px solid var(--line)'}}>
            <div style={{fontSize: 28, fontWeight: 800, color:'var(--ok)'}}>
              {NIST_FUNCTIONS.reduce((s,f) => s + f.controls.filter(c => c.status==='compliant').length, 0)}
            </div>
            <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>CONTROLS MET</div>
          </div>
          <div style={{textAlign:'center', padding:'12px 20px', borderRadius: 12, background:'var(--surface)', border:'1px solid var(--line)'}}>
            <div style={{fontSize: 28, fontWeight: 800, color:'var(--warn)'}}>
              {NIST_FUNCTIONS.reduce((s,f) => s + f.controls.filter(c => c.status==='partial').length, 0)}
            </div>
            <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>PARTIAL</div>
          </div>
        </div>
      </div>

      {/* Visualizations row */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24}}>
        <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:8}}>NIST CSF RADAR: FUNCTION COVERAGE</div>
          <div style={{display:'flex', justifyContent:'center'}}>
            <RadarChart functions={NIST_FUNCTIONS}/>
          </div>
        </div>
        <div style={{background:'var(--surface)', borderRadius:12, border:'1px solid var(--line)', padding:16, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom:8, alignSelf:'flex-start'}}>OVERALL COMPLIANCE SCORE</div>
          <ComplianceGauge score={overallScore}/>
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, width:'100%', marginTop:8}}>
            {[
              {label:'Controls Met',  value: NIST_FUNCTIONS.reduce((s,f)=>s+f.controls.filter(c=>c.status==='compliant').length,0), color:'var(--ok)'},
              {label:'Partial',       value: NIST_FUNCTIONS.reduce((s,f)=>s+f.controls.filter(c=>c.status==='partial').length,0),    color:'var(--warn)'},
              {label:'Gaps',          value: NIST_FUNCTIONS.reduce((s,f)=>s+f.controls.filter(c=>c.status==='gap').length,0),         color:'var(--crit)'},
            ].map((m,i) => (
              <div key={i} style={{textAlign:'center', padding:'8px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--line)'}}>
                <div style={{fontSize:20, fontWeight:800, color:m.color}}>{m.value}</div>
                <div style={{fontSize:10, color:'var(--ink-3)'}}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NIST CSF Functions */}
      <div style={{marginBottom: 24}}>
        <div style={{fontSize: 11, fontWeight: 700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom: 12}}>
          NIST CSF 2.0: SIX CORE FUNCTIONS
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: 12, marginBottom: 16}}>
          {NIST_FUNCTIONS.map(f => (
            <div key={f.id} style={{background:'var(--surface)', borderRadius: 12, border:'1px solid var(--line)', padding: 14}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                <div>
                  <span style={{fontSize: 16, fontWeight: 800, color: f.color}}>{f.id}</span>
                  <span style={{fontSize: 11, color:'var(--ink-3)', marginLeft: 6}}>{f.name}</span>
                </div>
              </div>
              <ScoreBar score={f.score} color={f.color}/>
              <div style={{marginTop: 10}}>
                {f.controls.map(c => (
                  <div key={c.id} style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'5px 0', borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize: 11, color:'var(--ink)', fontWeight: 600}}>{c.id}: {c.name}</div>
                      <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>{c.note}</div>
                    </div>
                    <span style={{fontSize: 9, fontWeight: 700, color: statusColor(c.status), marginLeft: 8, whiteSpace:'nowrap'}}>
                      {statusLabel(c.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FERPA */}
      <div style={{background:'var(--surface)', borderRadius: 12, border:'1px solid var(--line)', padding: 16, marginBottom: 24}}>
        <div style={{fontSize: 11, fontWeight: 700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom: 12}}>
          FERPA: STUDENT DATA PRIVACY COMPLIANCE
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap: 8}}>
          {FERPA_CONTROLS.map((c,i) => (
            <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'8px 12px', borderRadius: 8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--line)'}}>
              <div style={{flex:1}}>
                <div style={{fontSize: 12, color:'var(--ink)', fontWeight: 600}}>{c.name}</div>
                <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>{c.note}</div>
              </div>
              <span style={{fontSize: 9, fontWeight: 700, color: statusColor(c.status), marginLeft: 8, whiteSpace:'nowrap'}}>
                {statusLabel(c.status)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System evidence */}
      <div style={{background:'var(--surface)', borderRadius: 12, border:'1px solid var(--line)', padding: 16}}>
        <div style={{fontSize: 11, fontWeight: 700, color:'var(--ink-3)', letterSpacing:'1px', marginBottom: 12}}>
          COMPLIANCE EVIDENCE: LIVE SYSTEM METRICS
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap: 10}}>
          {[
            { label:'Agents Monitoring',  value: agents_healthy + '/13',  color:'var(--ok)',     note:'Continuous coverage' },
            { label:'Incidents Detected', value: counts.total,     color:'var(--cyan)',   note:'Auto-classified' },
            { label:'Evidence Bundles',   value: 'SHA-256', color:'var(--violet)', note:'Chain of custody' },
            { label:'Correlations Fired', value: correlations_active,                      color:'var(--hi)',     note:'Cross-domain links' },
            { label:'SOAR Playbooks',     value: 6,                       color:'var(--warn)',   note:'Auto-response ready' },
            { label:'Kafka Topics',       value: 17,                      color:'var(--cyan)',   note:'All domains covered' },
            { label:'VLANs Secured',      value: 14,                      color:'var(--ok)',     note:'Full segmentation' },
            { label:'ML Retraining Runs', value: 20,                      color:'var(--violet)', note:'Adaptive detection' },
          ].map((m,i) => (
            <div key={i} style={{padding:'10px 14px', borderRadius: 8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--line)', textAlign:'center'}}>
              <div style={{fontSize: 22, fontWeight: 800, color: m.color}}>{m.value}</div>
              <div style={{fontSize: 11, color:'var(--ink)', fontWeight: 600, marginTop: 4}}>{m.label}</div>
              <div style={{fontSize: 10, color:'var(--ink-3)', marginTop: 2}}>{m.note}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

Object.assign(window, { CompliancePage });
