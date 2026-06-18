// Root app: routing + provider

function PlaceholderPage({title,desc}){
  return (
    <div className="page-enter" style={{padding:'22px 26px 60px',display:'grid',gap:18}}>
      <Section title={title} kicker="Reserved · linked to live agents">
        <div style={{padding:'40px 24px',textAlign:'center',color:'var(--ink-3)'}}>
          <div className="mono" style={{fontSize:14,color:'var(--ink-2)',marginBottom:6}}>{desc}</div>
          <div className="tiny">Wires up automatically when its agent endpoint is reachable.</div>
        </div>
      </Section>
    </div>
  );
}

function App(){
  const [page,setPage] = React.useState('overview');
  const [collapsed,setCollapsed] = React.useState(false);

  React.useEffect(()=>{
    const h = (location.hash||'').replace('#','');
    if (h) setPage(h);
    const handler = ()=>{ const h=(location.hash||'').replace('#',''); if (h) setPage(h); };
    window.addEventListener('hashchange', handler);
    return ()=>window.removeEventListener('hashchange', handler);
  },[]);
  React.useEffect(()=>{ location.hash = page; }, [page]);

  const pages = {
    overview:     <OverviewPage/>,
    ai:           <AIIntelPage/>,
    timeline:     <TimelinePage/>,
    map:          <CampusMapPage/>,
    correlations: <CorrelationsPage/>,
    soar:         <SOARPage/>,
    twin:         <DigitalTwinPage/>,
    incidents:    <IncidentsPage/>,
    threats:      <ThreatFeedPage/>,
    prediction:   <PredictionPage />,
    killchain:    <KillChainPage/>,
    report:       <ReportPage/>,
    forensic:     <ForensicPage/>,
    topology:     typeof TopologyPage !== 'undefined' ? React.createElement(TopologyPage) : <PlaceholderPage title="Network Topology" desc="L2/L3 graph"/>,
    compliance:   typeof CompliancePage !== 'undefined' ? React.createElement(CompliancePage) : <PlaceholderPage title="Compliance" desc="ISO 27001 / NIST CSF"/>,
    roi:          typeof ROIPage !== 'undefined' ? React.createElement(ROIPage) : <PlaceholderPage title="ROI" desc="Cost savings analytics"/>,
    tenants:      typeof TenantsPage !== 'undefined' ? React.createElement(TenantsPage) : <PlaceholderPage title="Tenants" desc="Multi-tenant orchestration"/>,
    marketplace:  typeof MarketplacePage !== 'undefined' ? React.createElement(MarketplacePage) : <PlaceholderPage title="Marketplace" desc="Agents and modules"/>,
  };

  return (
    <HQProvider>
      <div className={"layout " + (collapsed ? 'sidebar-collapsed' : '')}>
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed}/>
        <main className="main">
          <Topbar page={page}/>
          <div className="content" key={page}>
            {pages[page] || pages.overview}
          </div>
        </main>
      </div>
    </HQProvider>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App/>);
