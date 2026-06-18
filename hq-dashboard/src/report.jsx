// MASS SOC: Enterprise Periodic Threat Report
// Fetches: /api/8020/status, /api/8006/health, /api/8007/playbooks,
//          /api/8007/executions, /api/8008/metrics, /api/8009/stats, /api/8021/bundles

function rptGenId() {
  var now = new Date();
  var Y  = now.getFullYear();
  var M  = String(now.getMonth() + 1).padStart(2, '0');
  var D  = String(now.getDate()).padStart(2, '0');
  var H  = String(now.getHours()).padStart(2, '0');
  var Mi = String(now.getMinutes()).padStart(2, '0');
  return 'RPT-' + Y + '-' + M + '-' + D + '-' + H + Mi;
}

function rptFmtDate(ts) {
  if (!ts) return '—';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function rptFmt(t) {
  if (!t) return '—';
  return t.split('_').map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function SectionHead(props) {
  return (
    <div style={{fontSize:14, fontWeight:700, color:'#0f172a', margin:'30px 0 10px', paddingBottom:7, borderBottom:'2px solid #94a3b8', letterSpacing:'.01em'}}>
      {props.num}&emsp;{props.title}
    </div>
  );
}

function DataUnavail() {
  return (
    <div style={{padding:'10px 14px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:4, fontSize:11, color:'#78350f', margin:'6px 0'}}>
      Data unavailable. Endpoint unreachable during this reporting period
    </div>
  );
}

function ReportPage() {
  var sStatus    = React.useState(null);  var status    = sStatus[0];    var setStatus    = sStatus[1];
  var sAnalytics = React.useState(null);  var analytics = sAnalytics[0]; var setAnalytics = sAnalytics[1];
  var sPlaybooks = React.useState(null);  var playbooks = sPlaybooks[0]; var setPlaybooks = sPlaybooks[1];
  var sExecs     = React.useState(null);  var executions= sExecs[0];     var setExecs     = sExecs[1];
  var sMetrics   = React.useState(null);  var metrics   = sMetrics[0];   var setMetrics   = sMetrics[1];
  var sTi        = React.useState(null);  var tiStats   = sTi[0];        var setTi        = sTi[1];
  var sBundles   = React.useState(null);  var bundlesRaw= sBundles[0];   var setBundles   = sBundles[1];
  var sLoading   = React.useState(true);  var loading   = sLoading[0];   var setLoading   = sLoading[1];
  var sRptId     = React.useState('');    var rptId     = sRptId[0];     var setRptId     = sRptId[1];
  var sGenAt     = React.useState('');    var generatedAt= sGenAt[0];    var setGenAt     = sGenAt[1];

  function load() {
    Promise.all([
      fetch('/api/8020/status')    .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8006/health')    .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8007/playbooks') .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8007/executions').then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8008/metrics')   .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8009/stats')     .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
      fetch('/api/8021/bundles')   .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
    ]).then(function(res) {
      setStatus(res[0]);
      setAnalytics(res[1]);
      var pb = res[2];
      setPlaybooks(pb ? (pb.playbooks || (Array.isArray(pb) ? pb : [])) : null);
      var ex = res[3];
      setExecs(ex ? (ex.executions || (Array.isArray(ex) ? ex : [])) : null);
      setMetrics(res[4]);
      setTi(res[5]);
      var bun = res[6];
      setBundles(bun ? (bun.bundles || (Array.isArray(bun) ? bun : [])) : null);
      setLoading(false);
      setGenAt(new Date().toLocaleString());
    });
  }

  React.useEffect(function() {
    setRptId(rptGenId());
    setGenAt(new Date().toLocaleString());
    load();
    var timer = setInterval(function() { load(); }, 30000);
    return function() { clearInterval(timer); };
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────────
  var threatLevel  = (status && status.threat_level)                    || 'UNKNOWN';
  var totalInc     = (status && status.incidents && status.incidents.total)    || 0;
  var critical     = (status && status.incidents && status.incidents.critical) || 0;
  var high         = (status && status.incidents && status.incidents.high)     || 0;
  var medium       = (status && status.incidents && status.incidents.medium)   || 0;
  var low          = (status && status.incidents && status.incidents.low)      || 0;
  var agentsH      = (status && status.agents_healthy)    || 0;
  var agentsT      = (status && status.agents_total)      || 0;
  var healthPct    = (status && status.health_percentage) || 0;
  var agentHealth  = (status && status.agent_health)      || {};
  var corrActive   = (status && status.correlations_active) || 0;
  var cmdIssued    = (status && status.commands_issued)     || 0;
  var byDomain     = (status && status.incidents && status.incidents.by_domain) || {};

  var kcTracker    = (analytics && analytics.kill_chain_tracker) || {};
  var aStats       = (analytics && analytics.stats)               || {};
  var kcProgress   = aStats.kill_chain_progression || 0;

  var agentMetrics  = (metrics && metrics.agent_metrics)            || {};
  var thresholdRecs = (metrics && metrics.threshold_recommendations) || {};

  var totalIocs    = (tiStats && tiStats.total_iocs)    || 0;
  var totalMatches = (tiStats && tiStats.total_matches) || 0;
  var tiByType     = (tiStats && tiStats.by_type)       || {};
  var tiBySource   = (tiStats && tiStats.by_source)     || {};

  var bundles = bundlesRaw || [];

  // ── Color maps ──────────────────────────────────────────────────────────────
  var riskColorMap = {CRITICAL:'#dc2626',HIGH:'#ea580c',MEDIUM:'#ca8a04',LOW:'#16a34a',UNKNOWN:'#6b7280'};
  var riskBgMap    = {CRITICAL:'#fef2f2',HIGH:'#fff7ed',MEDIUM:'#fefce8',LOW:'#f0fdf4', UNKNOWN:'#f9fafb'};
  var sevColorMap  = {CRITICAL:'#dc2626',HIGH:'#ea580c',MEDIUM:'#ca8a04',LOW:'#16a34a'};
  var agColorMap   = {behavioral_agent:'#16a34a',ndr_agent:'#0ea5e9',edr_agent:'#f59e0b'};
  var agLabelMap   = {behavioral_agent:'Behavioral',ndr_agent:'NDR',edr_agent:'EDR'};

  var riskColor = riskColorMap[threatLevel] || '#6b7280';
  var riskBg    = riskBgMap[threatLevel]    || '#f9fafb';

  // ── Executive summary ───────────────────────────────────────────────────────
  function buildSummary() {
    var parts = [];
    if (threatLevel === 'CRITICAL') {
      parts.push('The campus network is currently operating at CRITICAL threat level, indicating active or imminent high-severity security incidents requiring immediate response.');
    } else if (threatLevel === 'HIGH') {
      parts.push('The campus network is operating at HIGH threat level with multiple elevated-severity incidents detected across monitored domains.');
    } else {
      parts.push('The campus network is operating at ' + threatLevel + ' threat level with no confirmed critical multi-stage attacks in this reporting period.');
    }
    parts.push(totalInc + ' active incident(s) were recorded (' + critical + ' critical, ' + high + ' high, ' + medium + ' medium, ' + low + ' low) across IoT, Physical Access, and Network domains.');
    parts.push(agentsH + ' of ' + agentsT + ' monitoring agents are operational (' + healthPct + '%), providing continuous coverage across all campus security domains.');
    if (kcProgress > 0) {
      parts.push('ALERT: The MITRE ATT&CK correlation engine has detected ' + kcProgress + ' multi-stage kill-chain progression event(s). Immediate APT investigation is strongly recommended.');
    }
    return parts.join(' ');
  }

  // ── Auto-recommendations ────────────────────────────────────────────────────
  function buildRecs() {
    var recs = [];
    var offlineAgents = Object.entries(agentHealth).filter(function(e) {
      return !(e[1] && e[1].healthy);
    }).map(function(e) { return e[0]; });
    if (offlineAgents.length > 0) {
      recs.push('Investigate ' + offlineAgents.length + ' offline agent(s): ' + offlineAgents.slice(0,3).join(', ') + (offlineAgents.length>3?'…':'') + '. Verify network connectivity and process health on host VMs.');
    }
    if (threatLevel === 'CRITICAL') {
      recs.push('Initiate full incident response procedures. Current threat level is CRITICAL. Notify Campus CISO and escalate to Tier 2 SOC immediately.');
    }
    if (kcProgress > 0) {
      recs.push('Review ' + kcProgress + ' kill-chain correlation(s) for potential Advanced Persistent Threat (APT) activity. Cross-reference with threat intelligence IOC database and isolate affected hosts.');
    }
    if (corrActive > 0) {
      recs.push('Investigate ' + corrActive + ' active cross-domain correlation(s). Coordinated attacks across physical and cyber domains may indicate an insider threat or a sophisticated external attacker.');
    }
    Object.entries(agentMetrics).forEach(function(e) {
      var key = e[0]; var m = e[1];
      var fp = (m && m.false_positives) ? m.false_positives : 0;
      var tp = (m && m.true_positives)  ? m.true_positives  : 0;
      if (fp > 0 && tp > 0 && fp > tp) {
        recs.push('Review detection thresholds for ' + key.replace(/_/g,' ') + ': false positive rate (' + fp + ' FP vs ' + tp + ' TP) suggests overly aggressive rules that may cause alert fatigue.');
      }
    });
    if (bundlesRaw !== null && bundles.length === 0) {
      recs.push('Verify forensic collection agent is operational. No evidence bundles have been collected. Forensic capability may be impaired for chain-of-custody requirements.');
    }
    if (recs.length === 0) {
      recs.push('No critical recommendations at this time. System is operating within normal parameters. Continue routine monitoring and scheduled agent health checks.');
    }
    return recs;
  }

  // ── Print / PDF ─────────────────────────────────────────────────────────────
  function printReport() {
    var recs    = buildRecs();
    var summary = buildSummary();
    var win = window.open('', '_blank');
    var h = [];
    h.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
    h.push('<title>' + rptId + ': MASS SOC Threat Report</title>');
    h.push('<style>');
    h.push('body{font-family:Georgia,serif;font-size:11pt;color:#111;background:#fff;padding:28px 44px;max-width:800px;margin:0 auto;line-height:1.5;}');
    h.push('h1{font-size:20pt;margin:0 0 4px;text-align:center;}');
    h.push('h2{font-size:12pt;margin:22px 0 8px;border-bottom:1.5px solid #999;padding-bottom:4px;letter-spacing:.5px;}');
    h.push('table{width:100%;border-collapse:collapse;margin:8px 0;}');
    h.push('th{background:#f0f0f0;padding:5px 8px;text-align:left;font-size:9pt;border:1px solid #bbb;text-transform:uppercase;letter-spacing:.4px;}');
    h.push('td{padding:5px 8px;border:1px solid #ddd;font-size:10pt;} tr:nth-child(even) td{background:#f9f9f9;}');
    h.push('.tlp{background:#16a34a;color:#fff;text-align:center;padding:5px;font-size:9pt;font-weight:bold;letter-spacing:2px;margin-bottom:14px;}');
    h.push('.badge{display:inline-block;padding:2px 12px;border-radius:3px;font-weight:bold;color:'+riskColor+';border:1.5px solid '+riskColor+';background:'+riskBg+';}');
    h.push('.meta{font-size:9pt;color:#555;} p{line-height:1.7;} .mono{font-family:monospace;font-size:9pt;}');
    h.push('.foot{margin-top:28px;border-top:1px solid #bbb;padding-top:8px;font-size:8pt;color:#777;text-align:center;}');
    h.push('@media print{@page{margin:18mm;size:A4;} body{padding:0;max-width:100%;}}');
    h.push('</style></head><body>');
    h.push('<div class="tlp">TLP:GREEN. For internal distribution only</div>');
    h.push('<h1>MASS Security Operations Center</h1>');
    h.push('<h1 style="font-size:14pt;font-weight:normal;text-align:center;margin-bottom:14px;">Periodic Threat Report</h1>');
    h.push('<table style="border:none;margin-bottom:14px;">');
    h.push('<tr><td style="border:none;" class="meta"><strong>Report ID:</strong> <span class="mono">' + rptId + '</span></td><td style="border:none;" class="meta"><strong>Generated:</strong> ' + generatedAt + '</td></tr>');
    h.push('<tr><td style="border:none;" class="meta"><strong>Prepared by:</strong> MASS SOC, Galala University Campus Security</td><td style="border:none;" class="meta"><strong>Distribution:</strong> Campus CISO, IT Security Team, Facilities Management</td></tr>');
    h.push('</table><hr>');
    h.push('<h2>1.0 Executive Summary</h2><p>' + summary + '</p>');
    h.push('<p>Risk Posture: <span class="badge">' + threatLevel + '</span></p>');
    h.push('<h2>2.0 Incident Statistics</h2>');
    h.push('<table><tr><th>Severity</th><th>Count</th><th>% of Total</th></tr>');
    [{s:'CRITICAL',c:critical},{s:'HIGH',c:high},{s:'MEDIUM',c:medium},{s:'LOW',c:low}].forEach(function(r){
      h.push('<tr><td>'+r.s+'</td><td>'+r.c+'</td><td>'+(totalInc?Math.round(r.c/totalInc*100):0)+'%</td></tr>');
    });
    h.push('<tr><td><strong>TOTAL</strong></td><td><strong>'+totalInc+'</strong></td><td>100%</td></tr></table>');
    h.push('<h2>3.0 MITRE ATT&amp;CK Coverage</h2>');
    h.push('<p>Kill-chain progressions fired: <strong>' + kcProgress + '</strong> &nbsp;|&nbsp; Actors tracked: <strong>' + Object.keys(kcTracker).length + '</strong></p>');
    if (Object.keys(kcTracker).length > 0) {
      h.push('<table><tr><th>Actor</th><th>Stages</th><th>Count</th><th>Risk</th></tr>');
      Object.entries(kcTracker).forEach(function(entry) {
        var actor = entry[0]; var ad = entry[1];
        var stages = ad && ad.stages ? ad.stages : [];
        var stageList = Array.isArray(stages) ? stages : Object.keys(stages);
        var total = (ad && ad.total_stages) ? ad.total_stages : stageList.length;
        h.push('<tr><td class="mono">'+actor+'</td><td>'+stageList.join(', ')+'</td><td>'+total+'</td><td>'+(total>=3?'<strong style="color:#dc2626">CRITICAL</strong>':'MONITOR')+'</td></tr>');
      });
      h.push('</table>');
    }
    h.push('<h2>4.0 Detection and ML Performance</h2>');
    if (Object.keys(agentMetrics).length === 0) {
      h.push('<p>Insufficient training data.</p>');
    } else {
      h.push('<table><tr><th>Model</th><th>Algorithm</th><th>F1 Score</th><th>Precision</th><th>Recall</th><th>Samples</th></tr>');
      Object.entries(agentMetrics).forEach(function(e) {
        var key  = e[0]; var m = e[1];
        var lbl  = agLabelMap[key] || key;
        var f1   = m && m.f1 && m.f1 !== 'not_yet_computed' ? (m.f1*100).toFixed(1)+'%' : 'N/A';
        var pre  = m && m.precision && m.precision !== 'not_yet_computed' ? (m.precision*100).toFixed(1)+'%' : 'N/A';
        var rec  = m && m.recall && m.recall !== 'not_yet_computed' ? (m.recall*100).toFixed(1)+'%' : 'N/A';
        var algo = (m && m.best_model) || 'N/A';
        var samps = (m && m.training_samples != null) ? m.training_samples : 'N/A';
        h.push('<tr><td>'+lbl+'</td><td>'+algo+'</td><td>'+f1+'</td><td>'+pre+'</td><td>'+rec+'</td><td>'+samps+'</td></tr>');
      });
      h.push('</table>');
      if (Object.keys(thresholdRecs).length > 0) {
        h.push('<p><strong>Active Threshold Recommendations</strong></p>');
        h.push('<table><tr><th>Agent</th><th>Parameter</th><th>Value</th></tr>');
        Object.entries(thresholdRecs).forEach(function(e) {
          var agKey = e[0]; var rmap = e[1];
          var lbl = agLabelMap[agKey] || agKey;
          Object.entries(rmap).forEach(function(re) {
            var val = typeof re[1] === 'number' ? re[1].toFixed(3) : String(re[1]);
            h.push('<tr><td>'+lbl+'</td><td>'+re[0]+'</td><td class="mono">'+val+'</td></tr>');
          });
        });
        h.push('</table>');
      }
    }
    h.push('<h2>5.0 Correlation Analysis</h2>');
    h.push('<p>Total cross-domain correlations active: <strong>' + corrActive + '</strong></p>');
    h.push('<table><tr><th>Correlation Type</th><th>Count</th></tr>');
    [{id:'coordinated_attack'},{id:'campus_wide_threat'},{id:'insider_threat'},{id:'iot_cyber_bridge'},{id:'physical_cyber_combo'},{id:'kill_chain_progression'}].forEach(function(ct) {
      var cnt = aStats[ct.id] || 0;
      h.push('<tr><td class="mono">'+ct.id+'</td><td>'+cnt+'</td></tr>');
    });
    h.push('</table>');
    h.push('<h2>6.0 Response Actions (SOAR)</h2>');
    if (!playbooks || playbooks.length === 0) {
      h.push('<p>No SOAR playbooks registered.</p>');
    } else {
      h.push('<table><tr><th>Playbook</th><th>Trigger</th><th>Steps</th><th>Min Severity</th></tr>');
      playbooks.forEach(function(pb) {
        var name   = (pb && (pb.name || pb.playbook_id)) || 'N/A';
        var trig   = (pb && pb.trigger) || 'N/A';
        var steps  = (pb && pb.steps && pb.steps.length) || (pb && pb.step_count) || (pb && pb.steps) || 'N/A';
        var minSev = (pb && pb.min_severity) || 'N/A';
        h.push('<tr><td>'+name+'</td><td class="mono">'+trig+'</td><td>'+steps+'</td><td>'+minSev+'</td></tr>');
      });
      h.push('</table>');
    }
    if (executions && executions.length > 0) {
      h.push('<p>Recent executions: <strong>' + executions.length + '</strong></p>');
    }
    h.push('<p>Total commands issued: <strong>' + cmdIssued + '</strong></p>');
    h.push('<h2>7.0 Threat Intelligence</h2>');
    if (!tiStats) {
      h.push('<p>TI Agent data unavailable.</p>');
    } else {
      h.push('<p>Total IOCs: <strong>' + totalIocs + '</strong> | Alerts enriched: <strong>' + totalMatches + '</strong></p>');
      if (Object.keys(tiByType).length > 0) {
        h.push('<table><tr><th>IOC Type</th><th>Count</th></tr>');
        Object.entries(tiByType).forEach(function(e) {
          h.push('<tr><td>'+e[0]+'</td><td>'+e[1]+'</td></tr>');
        });
        h.push('</table>');
      }
    }
    h.push('<h2>8.0 Forensic Evidence</h2>');
    h.push('<p>Integrity method: <strong>SHA-256</strong> | Bundles collected: <strong>' + bundles.length + '</strong></p>');
    if (bundles.length === 0) {
      h.push('<p>No forensic bundles collected.</p>');
    } else {
      h.push('<table><tr><th>Incident ID</th><th>Severity</th><th>SHA-256 (partial)</th><th>Created</th></tr>');
      bundles.slice(0, 8).forEach(function(b) {
        var sha  = b && b.sha256 ? b.sha256.slice(0, 16) + '...' : 'N/A';
        var bSev = (b && b.severity) || 'N/A';
        var bId  = (b && b.incident_id) || 'N/A';
        var bTs  = (b && b.created_at) ? rptFmtDate(b.created_at) : 'N/A';
        h.push('<tr><td class="mono">'+bId+'</td><td>'+bSev+'</td><td class="mono">'+sha+'</td><td>'+bTs+'</td></tr>');
      });
      h.push('</table>');
    }
    h.push('<h2>9.0 System Health</h2>');
    h.push('<p>Agents online: <strong>' + agentsH + '/' + agentsT + '</strong> (' + healthPct + '%)</p>');
    h.push('<table><tr><th>Agent</th><th>Status</th><th>Last Seen</th></tr>');
    Object.entries(agentHealth).forEach(function(e) {
      var agId = e[0]; var info = e[1];
      var healthy = info && info.healthy;
      var lastSec = (info && info.last_seen_ago_sec != null) ? info.last_seen_ago_sec : null;
      var lastStr = lastSec !== null ? Math.round(lastSec)+'s ago' : 'never';
      h.push('<tr><td class="mono">'+agId+'</td><td style="font-weight:bold;color:'+(healthy?'#16a34a':'#dc2626')+'">'+(healthy?'ONLINE':'OFFLINE')+'</td><td>'+lastStr+'</td></tr>');
    });
    h.push('</table>');
    h.push('<h2>10.0 Recommendations</h2><ol>');
    recs.forEach(function(r) { h.push('<li style="margin-bottom:7px;">'+r+'</li>'); });
    h.push('</ol>');
    h.push('<div class="foot">End of Report. Classification: TLP:GREEN<br>MASS Multi-Agent Security System, Galala University Campus Security Operations</div>');
    h.push('</body></html>');
    win.document.write(h.join(''));
    win.document.close();
    setTimeout(function() { win.print(); }, 500);
  }

  if (loading) {
    return (
      <div style={{padding:'80px 0', textAlign:'center', color:'var(--ink-3)', fontFamily:'var(--font-mono)', fontSize:13}}>
        Assembling SOC report. Fetching 7 endpoints.
      </div>
    );
  }

  // ── Style constants (no spread, explicit properties only) ──────────────────
  var tableS = {width:'100%', borderCollapse:'collapse', margin:'8px 0'};
  var thS    = {padding:'7px 12px', background:'#f1f5f9', color:'#374151', fontWeight:700, fontSize:10, textAlign:'left', border:'1px solid #e2e8f0', textTransform:'uppercase', letterSpacing:'.06em'};
  var tdS    = {padding:'7px 12px', border:'1px solid #e2e8f0', fontSize:11, verticalAlign:'middle', background:'#ffffff'};
  var tdAlt  = {padding:'7px 12px', border:'1px solid #e2e8f0', fontSize:11, verticalAlign:'middle', background:'#f8fafc'};
  var monoTd = {padding:'7px 12px', border:'1px solid #e2e8f0', fontSize:10, verticalAlign:'middle', fontFamily:'monospace', background:'#ffffff'};
  var monoAlt= {padding:'7px 12px', border:'1px solid #e2e8f0', fontSize:10, verticalAlign:'middle', fontFamily:'monospace', background:'#f8fafc'};
  var labelS = {fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'#64748b'};
  var lblBlk = {fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'#64748b', display:'block', marginBottom:3};

  var summary = buildSummary();
  var recs    = buildRecs();

  return (
    <div style={{padding:'28px 20px 60px', background:'var(--surface)'}}>
      {/* Document card: white on dark dashboard */}
      <div style={{maxWidth:920, margin:'0 auto', background:'#f8f9fa', boxShadow:'0 8px 48px rgba(0,0,0,0.5)', borderRadius:4, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color:'#1a1a2e', fontSize:12, lineHeight:1.6}}>

        {/* TLP Banner */}
        <div style={{background:'#16a34a', color:'#fff', textAlign:'center', padding:'7px 0', fontSize:11, fontWeight:700, letterSpacing:'.12em', borderRadius:'4px 4px 0 0'}}>
          TLP:GREEN. For internal distribution only
        </div>

        <div style={{padding:'40px 52px'}}>

          {/* ── Document Header ── */}
          <div style={{textAlign:'center', marginBottom:24}}>
            <div style={{fontSize:11, color:'#9ca3af', letterSpacing:'.12em', textTransform:'uppercase', marginBottom:6}}>
              MASS Security Operations Center
            </div>
            <div style={{fontSize:24, fontWeight:700, color:'#0f172a', marginBottom:2}}>Periodic Threat Report</div>
            <div style={{fontSize:11, color:'#9ca3af', marginBottom:18}}>Multi-Agent Cyber-Physical Security System, Galala University</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 24px', fontSize:11, color:'#475569', textAlign:'left', maxWidth:580, margin:'0 auto'}}>
              <div>
                <span style={labelS}>Report ID</span>&nbsp;
                <span style={{fontFamily:'monospace', fontSize:11}}>{rptId}</span>
              </div>
              <div>
                <span style={labelS}>Generated</span>&nbsp;{generatedAt}
              </div>
              <div style={{marginTop:4}}>
                <span style={labelS}>Prepared By</span>&nbsp;MASS SOC, Galala University
              </div>
              <div style={{marginTop:4}}>
                <span style={labelS}>Distribution</span>&nbsp;CISO, IT Security, Facilities
              </div>
            </div>
          </div>

          {/* Print button */}
          <div style={{textAlign:'right', marginBottom:20}}>
            <button onClick={printReport} style={{padding:'9px 22px', background:'#0f172a', color:'#fff', border:'none', borderRadius:4, fontSize:11, fontWeight:600, cursor:'pointer', letterSpacing:'.05em'}}>
              &#8984; Generate PDF Report
            </button>
          </div>

          <hr style={{border:'none', borderTop:'2px solid #0f172a', margin:'0'}}/>

          {/* ══ 1. Executive Summary ══ */}
          <SectionHead num="1.0" title="Executive Summary"/>
          {!status ? <DataUnavail/> : (
            <div>
              <p style={{margin:'0 0 14px', color:'#1e293b', lineHeight:1.8}}>{summary}</p>
              <div style={{display:'flex', alignItems:'center', gap:12, marginTop:6}}>
                <span style={labelS}>Risk Posture:</span>
                <span style={{display:'inline-block', padding:'3px 18px', borderRadius:4, fontSize:12, fontWeight:700, color:riskColor, background:riskBg, border:'1.5px solid '+riskColor}}>{threatLevel}</span>
              </div>
            </div>
          )}

          {/* ══ 2. Incident Statistics ══ */}
          <SectionHead num="2.0" title="Incident Statistics"/>
          {!status ? <DataUnavail/> : (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24}}>
              <div>
                <div style={lblBlk}>Severity Distribution</div>
                <table style={tableS}>
                  <thead><tr><th style={thS}>Severity</th><th style={thS}>Count</th><th style={thS}>% of Total</th></tr></thead>
                  <tbody>
                    {[{s:'CRITICAL',c:critical},{s:'HIGH',c:high},{s:'MEDIUM',c:medium},{s:'LOW',c:low}].map(function(r,idx) {
                      var sc   = sevColorMap[r.s] || '#374151';
                      var base = idx%2===0 ? tdS : tdAlt;
                      return (
                        <tr key={r.s}>
                          <td style={base}><span style={{fontWeight:700, color:sc}}>{r.s}</span></td>
                          <td style={base}>{r.c}</td>
                          <td style={base}>{totalInc ? Math.round(r.c/totalInc*100) : 0}%</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{padding:'7px 12px', border:'1px solid #e2e8f0', fontWeight:700, background:'#f1f5f9'}}><strong>TOTAL</strong></td>
                      <td style={{padding:'7px 12px', border:'1px solid #e2e8f0', fontWeight:700, background:'#f1f5f9'}}><strong>{totalInc}</strong></td>
                      <td style={{padding:'7px 12px', border:'1px solid #e2e8f0', background:'#f1f5f9'}}>100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <div style={lblBlk}>By Domain</div>
                <table style={tableS}>
                  <thead><tr><th style={thS}>Domain</th><th style={thS}>Count</th></tr></thead>
                  <tbody>
                    {Object.entries(byDomain).map(function(e,idx) {
                      return (
                        <tr key={e[0]}>
                          <td style={idx%2===0?tdS:tdAlt}>{rptFmt(e[0])}</td>
                          <td style={idx%2===0?tdS:tdAlt}>{e[1]}</td>
                        </tr>
                      );
                    })}
                    {Object.keys(byDomain).length===0&&<tr><td colSpan={2} style={tdS}>No domain breakdown available</td></tr>}
                  </tbody>
                </table>
                <div style={{marginTop:10, fontSize:11, color:'#475569'}}>
                  <span style={labelS}>Correlations Active:&ensp;</span>{corrActive}&emsp;
                  <span style={labelS}>Commands Issued:&ensp;</span>{cmdIssued}
                </div>
              </div>
            </div>
          )}

          {/* ══ 3. MITRE ATT&CK ══ */}
          <SectionHead num="3.0" title="MITRE ATT&CK Coverage"/>
          {!analytics ? <DataUnavail/> : (
            <div>
              <div style={{display:'flex', gap:40, marginBottom:14, flexWrap:'wrap'}}>
                <div>
                  <span style={lblBlk}>Kill-Chain Progressions Fired</span>
                  <span style={{fontSize:28, fontWeight:700, color:kcProgress>0?'#dc2626':'#16a34a'}}>{kcProgress}</span>
                </div>
                <div>
                  <span style={lblBlk}>Actors Tracked</span>
                  <span style={{fontSize:28, fontWeight:700, color:'#0f172a'}}>{Object.keys(kcTracker).length}</span>
                </div>
              </div>
              {Object.keys(kcTracker).length===0 ? (
                <div style={{fontSize:11, color:'#6b7280', fontStyle:'italic'}}>No multi-stage attack actors tracked in this reporting period.</div>
              ) : (
                <table style={tableS}>
                  <thead><tr>
                    <th style={thS}>Actor (IP/ID)</th>
                    <th style={thS}>Observed Stages</th>
                    <th style={thS}>Stage Count</th>
                    <th style={thS}>Risk</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(kcTracker).map(function(entry,idx) {
                      var actor = entry[0]; var ad = entry[1];
                      var stages = ad && ad.stages ? ad.stages : [];
                      var stageList = Array.isArray(stages) ? stages : Object.keys(stages);
                      var total = (ad && ad.total_stages) ? ad.total_stages : stageList.length;
                      var isCrit = total >= 3;
                      return (
                        <tr key={actor}>
                          <td style={idx%2===0?monoTd:monoAlt}>{actor}</td>
                          <td style={idx%2===0?tdS:tdAlt}>{stageList.join(', ')||'—'}</td>
                          <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',textAlign:'center',fontWeight:700,fontSize:14,background:idx%2===0?'#fff':'#f8fafc'}}>{total}</td>
                          <td style={idx%2===0?tdS:tdAlt}>{isCrit?<span style={{color:'#dc2626',fontWeight:700}}>CRITICAL</span>:<span style={{color:'#6b7280'}}>MONITOR</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ══ 4. Detection & ML Performance ══ */}
          <SectionHead num="4.0" title="Detection & ML Performance"/>
          {!metrics ? <DataUnavail/> : (
            <div>
              <div style={{fontSize:11, color:'#475569', marginBottom:10, fontStyle:'italic', lineHeight:1.7}}>
                Adaptive ML Pipeline. Uses 5-fold cross-validation with 80/20 holdout evaluation. Algorithm selection: RandomForest vs. GradientBoosting per domain.
              </div>
              <table style={tableS}>
                <thead><tr>
                  {['Model','Algorithm','F1 Score','Precision','Recall','Training Samples','Retrain Count'].map(function(h){return<th key={h} style={thS}>{h}</th>;})}
                </tr></thead>
                <tbody>
                  {Object.entries(agentMetrics).map(function(e,idx) {
                    var key = e[0]; var m = e[1];
                    var label = agLabelMap[key] || key;
                    var color = agColorMap[key] || '#374151';
                    var f1   = m && m.f1 && m.f1 !== 'not_yet_computed' ? (m.f1*100).toFixed(1)+'%' : '—';
                    var pre  = m && m.precision && m.precision !== 'not_yet_computed' ? (m.precision*100).toFixed(1)+'%' : '—';
                    var rec  = m && m.recall && m.recall !== 'not_yet_computed' ? (m.recall*100).toFixed(1)+'%' : '—';
                    var algo = (m && m.best_model) || '—';
                    var samps= (m && m.training_samples != null) ? m.training_samples : '—';
                    var rets = (m && m.retrain_count != null) ? m.retrain_count : '—';
                    var bg   = idx%2===0?'#fff':'#f8fafc';
                    return (
                      <tr key={key}>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:color,background:bg}}>{label}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{algo}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,background:bg}}>{f1}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{pre}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{rec}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{samps}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{rets}</td>
                      </tr>
                    );
                  })}
                  {Object.keys(agentMetrics).length===0&&<tr><td colSpan={7} style={tdS}>No ML metrics available. Training pending sufficient labeled data</td></tr>}
                </tbody>
              </table>
              {Object.keys(thresholdRecs).length>0&&(
                <div style={{marginTop:14}}>
                  <div style={lblBlk}>Active Threshold Recommendations</div>
                  <table style={tableS}>
                    <thead><tr><th style={thS}>Agent</th><th style={thS}>Parameter</th><th style={thS}>Recommended Value</th></tr></thead>
                    <tbody>
                      {Object.entries(thresholdRecs).map(function(e) {
                        var agKey = e[0]; var rmap = e[1];
                        var col = agColorMap[agKey]||'#374151';
                        var lbl = agLabelMap[agKey]||agKey;
                        return Object.entries(rmap).map(function(re,ri) {
                          var val = typeof re[1]==='number' ? re[1].toFixed(3) : String(re[1]);
                          var bg  = ri%2===0?'#fff':'#f8fafc';
                          return (
                            <tr key={agKey+re[0]}>
                              <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:col,background:bg}}>{lbl}</td>
                              <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{re[0]}</td>
                              <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:11,background:bg}}>{val}</td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══ 5. Correlation Analysis ══ */}
          <SectionHead num="5.0" title="Correlation Analysis"/>
          {!analytics ? <DataUnavail/> : (
            <div>
              <div style={{marginBottom:12}}>
                <span style={labelS}>Total Cross-Domain Correlations: </span>
                <span style={{fontSize:18, fontWeight:700, color:corrActive>0?'#dc2626':'#16a34a', marginLeft:6}}>{corrActive}</span>
              </div>
              <table style={tableS}>
                <thead><tr>
                  <th style={thS}>Correlation Type</th>
                  <th style={thS}>Count</th>
                  <th style={thS}>Severity</th>
                  <th style={thS}>Description</th>
                </tr></thead>
                <tbody>
                  {[
                    {id:'coordinated_attack',    sev:'CRITICAL',desc:'Multi-vector simultaneous attack across physical and cyber domains'},
                    {id:'campus_wide_threat',    sev:'HIGH',    desc:'Threat spanning physical and cyber systems campus-wide'},
                    {id:'insider_threat',        sev:'HIGH',    desc:'Internal actor exhibiting abnormal access patterns'},
                    {id:'iot_cyber_bridge',      sev:'HIGH',    desc:'IoT device used as pivot point into network infrastructure'},
                    {id:'physical_cyber_combo',  sev:'MEDIUM',  desc:'Physical access event correlated with simultaneous cyber activity'},
                    {id:'kill_chain_progression',sev:'CRITICAL',desc:'MITRE ATT&CK multi-stage attack sequence progressing toward impact'},
                  ].map(function(ct,idx) {
                    var cnt = aStats[ct.id] || 0;
                    var sc  = sevColorMap[ct.sev] || '#374151';
                    var bg  = idx%2===0?'#fff':'#f8fafc';
                    return (
                      <tr key={ct.id}>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:10,background:bg}}>{ct.id}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:cnt>0?700:400,color:cnt>0?'#dc2626':'#94a3b8',background:bg}}>{cnt}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:sc,background:bg}}>{ct.sev}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',color:'#475569',background:bg}}>{ct.desc}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ══ 6. Response Actions (SOAR) ══ */}
          <SectionHead num="6.0" title="Response Actions (SOAR)"/>
          <div>
            {!playbooks ? <DataUnavail/> : playbooks.length===0 ? (
              <div style={{fontSize:11, color:'#6b7280', fontStyle:'italic', marginBottom:10}}>No SOAR playbooks registered on this endpoint.</div>
            ) : (
              <div style={{marginBottom:16}}>
                <div style={lblBlk}>Available Playbooks ({playbooks.length})</div>
                <table style={tableS}>
                  <thead><tr>
                    <th style={thS}>Playbook</th>
                    <th style={thS}>Trigger</th>
                    <th style={thS}>Steps</th>
                    <th style={thS}>Min Severity</th>
                  </tr></thead>
                  <tbody>
                    {playbooks.map(function(pb,idx) {
                      var name   = (pb && (pb.name||pb.playbook_id)) || '—';
                      var trig   = (pb && pb.trigger) || '—';
                      var steps  = (pb && pb.steps && pb.steps.length) || (pb && pb.step_count) || (pb && pb.steps) || '—';
                      var minSev = (pb && pb.min_severity) || '—';
                      var sc = sevColorMap[minSev] || '#374151';
                      var bg = idx%2===0?'#fff':'#f8fafc';
                      return (
                        <tr key={idx}>
                          <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:600,background:bg}}>{name}</td>
                          <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:10,background:bg}}>{trig}</td>
                          <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',textAlign:'center',background:bg}}>{steps}</td>
                          <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:sc,background:bg}}>{minSev}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {executions && executions.length>0 && (
              <div>
                <div style={lblBlk}>Recent Executions (last 5)</div>
                <table style={tableS}>
                  <thead><tr>
                    <th style={thS}>Playbook</th><th style={thS}>Incident ID</th><th style={thS}>Status</th><th style={thS}>Timestamp</th>
                  </tr></thead>
                  <tbody>
                    {executions.slice(0,5).map(function(ex,idx) {
                      var exName = (ex&&(ex.playbook_name||ex.playbook_id))||'—';
                      var exInc  = (ex&&ex.incident_id)||'—';
                      var exStat = (ex&&ex.status)||'—';
                      var exTs   = (ex&&(ex.executed_at||ex.created_at)) ? rptFmtDate(ex.executed_at||ex.created_at) : '—';
                      return (
                        <tr key={idx}>
                          <td style={idx%2===0?tdS:tdAlt}>{exName}</td>
                          <td style={idx%2===0?monoTd:monoAlt}>{exInc}</td>
                          <td style={idx%2===0?tdS:tdAlt}>{exStat}</td>
                          <td style={idx%2===0?tdS:tdAlt}>{exTs}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{marginTop:8, fontSize:11, color:'#475569'}}>
              <span style={labelS}>Total Commands Issued: </span>{cmdIssued}
            </div>
          </div>

          {/* ══ 7. Threat Intelligence ══ */}
          <SectionHead num="7.0" title="Threat Intelligence"/>
          {!tiStats ? <DataUnavail/> : (
            <div>
              <div style={{display:'flex', gap:40, marginBottom:14, flexWrap:'wrap'}}>
                <div><span style={lblBlk}>Total IOCs</span><span style={{fontSize:26, fontWeight:700, color:'#0f172a'}}>{totalIocs}</span></div>
                <div><span style={lblBlk}>Alerts Enriched</span><span style={{fontSize:26, fontWeight:700, color:'#0f172a'}}>{totalMatches}</span></div>
                <div><span style={lblBlk}>Enrichment Rate</span><span style={{fontSize:26, fontWeight:700, color:'#0f172a'}}>{totalIocs&&totalMatches?Math.round(totalMatches/totalIocs*100)+'%':'—'}</span></div>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24}}>
                <div>
                  <div style={lblBlk}>IOCs by Type</div>
                  <table style={tableS}>
                    <thead><tr><th style={thS}>Type</th><th style={thS}>Count</th></tr></thead>
                    <tbody>
                      {Object.entries(tiByType).map(function(e,idx){return(<tr key={e[0]}><td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,textTransform:'uppercase',fontSize:10,background:idx%2===0?'#fff':'#f8fafc'}}>{e[0]}</td><td style={idx%2===0?tdS:tdAlt}>{e[1]}</td></tr>);})}
                      {Object.keys(tiByType).length===0&&<tr><td colSpan={2} style={tdS}>No data</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div style={lblBlk}>IOCs by Source</div>
                  <table style={tableS}>
                    <thead><tr><th style={thS}>Source</th><th style={thS}>Count</th></tr></thead>
                    <tbody>
                      {Object.entries(tiBySource).map(function(e,idx){return(<tr key={e[0]}><td style={idx%2===0?tdS:tdAlt}>{e[0]}</td><td style={idx%2===0?tdS:tdAlt}>{e[1]}</td></tr>);})}
                      {Object.keys(tiBySource).length===0&&<tr><td colSpan={2} style={tdS}>No data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══ 8. Forensic Evidence ══ */}
          <SectionHead num="8.0" title="Forensic Evidence"/>
          <div>
            <div style={{display:'flex', gap:40, marginBottom:12, flexWrap:'wrap'}}>
              <div><span style={lblBlk}>Bundles Collected</span><span style={{fontSize:26, fontWeight:700, color:'#0f172a'}}>{bundles.length}</span></div>
              <div><span style={lblBlk}>Evidence Integrity</span><span style={{fontSize:15, fontWeight:700, color:'#16a34a', marginTop:2, display:'block'}}>SHA-256</span></div>
            </div>
            {!bundlesRaw ? <DataUnavail/> : bundles.length===0 ? (
              <div style={{fontSize:11, color:'#6b7280', fontStyle:'italic'}}>No forensic bundles collected. Waiting for HIGH/CRITICAL incidents to trigger automatic collection.</div>
            ) : (
              <table style={tableS}>
                <thead><tr>
                  <th style={thS}>Incident ID</th>
                  <th style={thS}>Severity</th>
                  <th style={thS}>Alert Type</th>
                  <th style={thS}>SHA-256 (partial)</th>
                  <th style={thS}>Created</th>
                </tr></thead>
                <tbody>
                  {bundles.slice(0,8).map(function(b,idx) {
                    var bSev = (b&&b.severity)||'—';
                    var sc   = sevColorMap[bSev]||'#374151';
                    var sha  = b&&b.sha256 ? b.sha256.slice(0,16)+'…' : '—';
                    var bg   = idx%2===0?'#fff':'#f8fafc';
                    return (
                      <tr key={idx}>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:10,background:bg}}>{(b&&b.incident_id)||'—'}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:sc,background:bg}}>{bSev}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{rptFmt((b&&b.alert_type)||'')}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:10,background:bg}}>{sha}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{(b&&b.created_at)?rptFmtDate(b.created_at):'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ══ 9. System Health ══ */}
          <SectionHead num="9.0" title="System Health"/>
          {!status ? <DataUnavail/> : (
            <div>
              <div style={{display:'flex', gap:40, marginBottom:12, flexWrap:'wrap'}}>
                <div><span style={lblBlk}>Agents Online</span><span style={{fontSize:26, fontWeight:700, color:agentsH===agentsT?'#16a34a':'#ea580c'}}>{agentsH}/{agentsT}</span></div>
                <div><span style={lblBlk}>Health</span><span style={{fontSize:26, fontWeight:700, color:healthPct>=80?'#16a34a':healthPct>=50?'#ca8a04':'#dc2626'}}>{healthPct}%</span></div>
              </div>
              <table style={tableS}>
                <thead><tr><th style={thS}>Agent</th><th style={thS}>Status</th><th style={thS}>Last Seen</th></tr></thead>
                <tbody>
                  {Object.entries(agentHealth).map(function(e,idx) {
                    var agId  = e[0]; var info = e[1];
                    var healthy = info && info.healthy;
                    var lastSec = (info && info.last_seen_ago_sec != null) ? info.last_seen_ago_sec : null;
                    var lastStr = lastSec !== null ? Math.round(lastSec)+'s ago' : 'never';
                    var bg = idx%2===0?'#fff':'#f8fafc';
                    return (
                      <tr key={agId}>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontFamily:'monospace',fontSize:10,background:bg}}>{agId}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',fontWeight:700,color:healthy?'#16a34a':'#dc2626',background:bg}}>{healthy?'● ONLINE':'○ OFFLINE'}</td>
                        <td style={{padding:'7px 12px',border:'1px solid #e2e8f0',background:bg}}>{lastStr}</td>
                      </tr>
                    );
                  })}
                  {Object.keys(agentHealth).length===0&&<tr><td colSpan={3} style={tdS}>No agent health data available</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ══ 10. Recommendations ══ */}
          <SectionHead num="10.0" title="Recommendations"/>
          <ol style={{paddingLeft:22, margin:'8px 0 0', lineHeight:1.85}}>
            {recs.map(function(r,i) {
              return <li key={i} style={{marginBottom:10, color:'#1e293b', fontSize:12}}>{r}</li>;
            })}
          </ol>

          {/* Footer */}
          <hr style={{border:'none', borderTop:'1px solid #cbd5e1', margin:'32px 0 16px'}}/>
          <div style={{textAlign:'center', fontSize:10, color:'#94a3b8', lineHeight:2}}>
            <div style={{fontWeight:700, color:'#475569', fontSize:11}}>End of Report. Classification: TLP:GREEN</div>
            <div>MASS Multi-Agent Security System, Galala University Campus Security Operations</div>
            <div>Report ID: {rptId} &nbsp;&middot;&nbsp; Page 1 of 1 &nbsp;&middot;&nbsp; Auto-refreshes every 30 seconds</div>
          </div>

        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReportPage });
