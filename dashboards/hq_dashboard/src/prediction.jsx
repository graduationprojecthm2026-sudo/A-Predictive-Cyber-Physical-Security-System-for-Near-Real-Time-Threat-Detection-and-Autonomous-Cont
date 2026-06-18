function PredictionPage() {
  const [metrics, setMetrics] = React.useState(null);
  const [lastUpdate, setLastUpdate] = React.useState(null);
  const [error, setError] = React.useState(null);
  var retrainState = React.useState(false);
  var retraining = retrainState[0]; var setRetraining = retrainState[1];

  function handleRetrain() {
    setRetraining(true);
    fetch('/api/8008/retrain', {method:'POST'}).catch(function(){});
    setTimeout(function(){setRetraining(false);}, 15000);
  }

  React.useEffect(() => {
    function fetchMetrics() {
      fetch('/api/8008/metrics')
        .then(r => r.json())
        .then(data => {
          setMetrics(data);
          setLastUpdate(new Date().toLocaleTimeString());
          setError(null);
        })
        .catch(() => setError('Learning agent unreachable'));
    }
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const agentColors = {
    behavioral_agent: '#00ff88',
    ndr_agent: '#00cfff',
    edr_agent: '#ff9900',
  };

  const agentLabels = {
    behavioral_agent: 'Behavioral Agent',
    ndr_agent: 'NDR Agent',
    edr_agent: 'EDR Agent',
  };

  function val(v) {
    if (v === 'not_yet_computed' || v === null || v === undefined) return '—';
    if (typeof v === 'number') return (v * 100).toFixed(1) + '%';
    return v;
  }

  function num(v) {
    if (v === 'not_yet_computed' || v === null || v === undefined) return '—';
    return v;
  }

  return (
    <div style={{padding:'32px', color:'#e0e0e0', fontFamily:'monospace'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'28px'}}>
        <div>
          <div style={{fontSize:'11px', color:'#555', letterSpacing:'2px', textTransform:'uppercase'}}>INTEL · ML TRAINING METRICS</div>
          <div style={{fontSize:'22px', fontWeight:'700', color:'#fff', marginTop:'4px'}}>Learning Agent Metrics</div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <button
            onClick={handleRetrain}
            disabled={retraining}
            style={{padding:'7px 14px', background:'#0d1117', border:'1px solid #00cfff', color:retraining?'#555':'#00cfff', borderRadius:6, cursor:retraining?'not-allowed':'pointer', fontSize:11, fontFamily:'monospace', letterSpacing:'1px'}}
          >{retraining ? 'Retraining...' : 'Retrain Model'}</button>
          <div style={{fontSize:'11px', color: error ? '#ff4444' : '#00ff88'}}>
            {error ? '⚠ ' + error : '● LIVE · ' + (lastUpdate || '...')}
          </div>
        </div>
      </div>
      {metrics && (
        <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:14, marginBottom:20, fontSize:12, lineHeight:1.7, color:'#888'}}>
          <strong style={{color:'#00cfff'}}>ML-powered adaptive learning.</strong> Models (RandomForest vs GradientBoosting) are trained on labeled incident data, evaluated via 5-fold cross-validation with 80/20 holdout split. Metrics reflect <strong style={{color:'#ccc'}}>test-set performance</strong> on unseen data. False positive labels are modeled from industry SOC benchmarks for escalated alerts. The Learning Agent retrains automatically every 500 confirmed incidents.
        </div>
      )}

      {metrics && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px', marginBottom:'28px'}}>
          {[
            {label:'Total Incidents', value: num(metrics.overall && metrics.overall.total_incidents)},
            {label:'Confirmed', value: num(metrics.overall && metrics.overall.confirmed)},
            {label:'Dismissed', value: num(metrics.overall && metrics.overall.dismissed)},
            {label:'Retraining Runs', value: num(metrics.overall && metrics.overall.retraining_runs)},
          ].map(item => (
            <div key={item.label} style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:'10px', padding:'20px', textAlign:'center'}}>
              <div style={{fontSize:'28px', fontWeight:'700', color:'#00cfff'}}>{item.value}</div>
              <div style={{fontSize:'11px', color:'#555', marginTop:'6px', textTransform:'uppercase', letterSpacing:'1px'}}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {metrics && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px', marginBottom:'28px'}}>
          {Object.entries(metrics.agent_metrics || {}).map(([key, m]) => (
            <div key={key} style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:'10px', padding:'24px'}}>
              <div style={{fontSize:'13px', fontWeight:'700', color: agentColors[key] || '#fff', marginBottom:'18px', textTransform:'uppercase', letterSpacing:'1px'}}>
                {agentLabels[key] || key}
              </div>
              {[
                {label:'F1 Score', value: val(m.f1)},
                {label:'Precision', value: val(m.precision)},
                {label:'Recall', value: val(m.recall)},
                {label:'True Positives', value: num(m.true_positives)},
                {label:'False Positives', value: num(m.false_positives)},
                {label:'Training Samples', value: num(m.training_samples)},
                {label:'Retrain Count', value: num(m.retrain_count)},
                {label:'Last Trained', value: m.last_trained === 'not_yet_computed' ? '—' : m.last_trained},
              ].map(row => (
                <div key={row.label} style={{display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #1a1a2e'}}>
                  <span style={{fontSize:'12px', color:'#555'}}>{row.label}</span>
                  <span style={{fontSize:'12px', color:'#e0e0e0', fontWeight:'600'}}>{row.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {metrics && (
        <div style={{marginBottom:'28px'}}>
          <div style={{fontSize:'11px', color:'#555', letterSpacing:'2px', textTransform:'uppercase', marginBottom:'14px'}}>ACTIVE THRESHOLD RECOMMENDATIONS</div>
          {metrics.threshold_recommendations && Object.keys(metrics.threshold_recommendations).length > 0 ? (
            <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px'}}>
              {Object.entries(metrics.threshold_recommendations).map(function(entry){
                var agentKey = entry[0];
                var agentRecs = entry[1];
                var agentColor = {behavioral_agent:'#00ff88',ndr_agent:'#00cfff',edr_agent:'#ff9900'}[agentKey] || '#fff';
                var agentLabel = {behavioral_agent:'Behavioral Agent',ndr_agent:'NDR Agent',edr_agent:'EDR Agent'}[agentKey] || agentKey;
                return (
                  <div key={agentKey} style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:'20px'}}>
                    <div style={{fontSize:'11px', fontWeight:'700', color:agentColor, marginBottom:'12px', letterSpacing:'1px', textTransform:'uppercase'}}>{agentLabel}</div>
                    {Object.entries(agentRecs).map(function(rec){
                      var recKey = rec[0];
                      var recVal = rec[1];
                      return (
                        <div key={recKey} style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #1a1a2e'}}>
                          <span style={{fontSize:'11px', color:'#555'}}>{recKey}</span>
                          <span style={{fontSize:'11px', color:'#e0e0e0', fontWeight:'600'}}>{typeof recVal === 'number' ? recVal.toFixed(3) : String(recVal)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:10, padding:16, fontSize:'12px', color:'#555'}}>
              No threshold adjustments recommended. Current thresholds are optimal
            </div>
          )}
        </div>
      )}

      {metrics && metrics.agent_metrics && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px', marginBottom:'28px'}}>
          {Object.entries(metrics.agent_metrics).map(function(entry){
            var key = entry[0]; var m = entry[1];
            var label = {behavioral_agent:'Behavioral',ndr_agent:'NDR',edr_agent:'EDR'}[key] || key;
            var color = {behavioral_agent:'#00ff88',ndr_agent:'#00cfff',edr_agent:'#ff9900'}[key] || '#fff';
            if (!m.best_model && !m.f1_cv_mean) return null;
            var feats = m.top_features || [];
            var maxImp = Math.max.apply(null, feats.map(function(f){return f.importance || 0;}).concat([0.01]));
            return (
              <div key={key} style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:'10px', padding:'16px'}}>
                <div style={{fontSize:'11px', fontWeight:'700', color:color, marginBottom:'12px', letterSpacing:'1px'}}>
                  {label}: MODEL DETAILS
                </div>
                <div style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #1a1a2e'}}>
                  <span style={{fontSize:'11px', color:'#555'}}>Best Model</span>
                  <span style={{fontSize:'11px', color:'#e0e0e0', fontWeight:'600'}}>{m.best_model || '—'}</span>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #1a1a2e'}}>
                  <span style={{fontSize:'11px', color:'#555'}}>CV F1 Score</span>
                  <span style={{fontSize:'11px', color:'#e0e0e0', fontWeight:'600'}}>{m.f1_cv_mean && typeof m.f1_cv_mean === 'number' ? (m.f1_cv_mean*100).toFixed(1)+'% +/-'+(m.f1_cv_std*100).toFixed(1)+'%' : '—'}</span>
                </div>
                <div style={{marginTop:'10px'}}>
                  <div style={{fontSize:'10px', color:'#555', marginBottom:'6px', letterSpacing:'1px'}}>TOP FEATURES</div>
                  {feats.map(function(f){
                    var w = maxImp > 0 ? Math.round(f.importance / maxImp * 100) : 0;
                    return (
                      <div key={f.name} style={{display:'flex', alignItems:'center', gap:'6px', padding:'3px 0'}}>
                        <span style={{fontSize:'10px', color:'#555', width:'100px', flexShrink:0}}>{f.name}</span>
                        <div style={{flex:1, height:'6px', borderRadius:'3px', background:'#1a1a2e'}}>
                          <div style={{width:w+'%', height:'100%', borderRadius:'3px', background:color}}></div>
                        </div>
                        <span style={{fontSize:'9px', color:'#888', width:'35px', textAlign:'right'}}>{(f.importance*100).toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {metrics && metrics.honesty_note && (
        <div style={{background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:'10px', padding:'16px', fontSize:'11px', color:'#555', lineHeight:'1.6'}}>
          ℹ {metrics.honesty_note}
        </div>
      )}

      {!metrics && !error && (
        <div style={{textAlign:'center', color:'#555', marginTop:'80px', fontSize:'13px'}}>
          Connecting to Learning Agent at :8008...
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PredictionPage });
