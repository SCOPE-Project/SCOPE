import { useState, useEffect } from 'react'

export default function App() {
  const [satellites, setSatellites] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [backendAlive, setBackendAlive] = useState(null) // null = checking, true = alive, false = dead
  const [view, setView] = useState('landing')
  const [selectedSatellites, setSelectedSatellites] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [launchingScheduler, setLaunchingScheduler] = useState(false)
  const [schedulerLaunched, setSchedulerLaunched] = useState(false)
  const [overviewRows, setOverviewRows] = useState([])
  const [extractionStatus, setExtractionStatus] = useState('Not started')
  const [calculatingTradeOffs, setCalculatingTradeOffs] = useState(false)
  const [tradeOffsCalculated, setTradeOffsCalculated] = useState(false)
  const [tradeOffCards, setTradeOffCards] = useState([])
  const [selectedTradeOffCard, setSelectedTradeOffCard] = useState(null)
  const [expandedSections, setExpandedSections] = useState({
    satellites: true,
    groundStations: false,
    filters: false,
  })

  useEffect(() => {
    // Check if backend is alive on mount
    const checkBackend = async () => {
      try {
        // const res = await fetch('http://localhost:8000/status')
        const res = await fetch('http://localhost:8000/satos/satellite/list')
        if (res.ok) {
          setBackendAlive(true)
        } else {
          setBackendAlive(false)
        }
      } catch (err) {
        setBackendAlive(false)
      }
    }
    checkBackend()
  }, [])

  const toggleSatellite = (name) => {
    setSelectedSatellites((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  const toggleSection = (section) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const buildMockOverpasses = (selected) =>
    selected.map((satellite, index) => ({
      overpassId: `OP-${String(index + 1).padStart(3, '0')}`,
      satId: satellite,
      gsId: `GS-TBD-${(index % 3) + 1}`,
      duration: `${8 + index * 2} min`,
    }))

  const buildMockTradeOffCards = (rows) =>
    rows
      .filter((row) => row.tradeOff !== '—')
      .slice(0, 3)
      .map((row, index) => ({
      title: `Conflict Group ${index + 1}`,
      selectedLink: `${row.satId} ↔ ${row.gsId}`,
      score: `${92 - index * 11}/100`,
      recommended: index === 0,
    }))

  const fetchSatellites = async () => {
    setLoading(true)
    setError(null)
    setSatellites([])
    try {
      // const response = await fetch('http://localhost:8000/satellite/list')
      const response = await fetch('http://localhost:8000/satos/satellite/list')
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`)
      }
      const data = await response.json()
      if (data && Array.isArray(data.satellites)) {
        setSatellites(data.satellites)
        setView('workspace')
      } else {
        throw new Error("Invalid response format from server")
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to fetch satellites. Verify your backend or SatOS credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleLaunchScheduler = async () => {
    if (selectedSatellites.length === 0) return

    setLaunchingScheduler(true)
    setExtractionStatus('Running')
    setSchedulerLaunched(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setSelectedTradeOffCard(null)

    const simulatedRows = buildMockOverpasses(selectedSatellites)

    await new Promise((resolve) => setTimeout(resolve, 900))

    setOverviewRows(simulatedRows)
    setSchedulerLaunched(true)
    setExtractionStatus('Completed')
    setLaunchingScheduler(false)
  }

  const handleCalculateTradeOffs = async () => {
    if (!schedulerLaunched || overviewRows.length === 0) return

    setCalculatingTradeOffs(true)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const enrichedRows = overviewRows.map((row, index) => ({
      ...row,
      tradeOff: index % 3 === 2 ? '—' : `${92 - index * 11}/100`,
    }))

    setOverviewRows(enrichedRows)
    setTradeOffCards(buildMockTradeOffCards(enrichedRows))
    setTradeOffsCalculated(true)
    setCalculatingTradeOffs(false)
  }

  const headerStatusClass =
    backendAlive === null ? 'checking' : backendAlive ? 'online' : 'offline'

  const headerStatusLabel =
    backendAlive === null ? 'Connection Check' : backendAlive ? 'SatOS Connected' : 'Backend Offline'

  const appHeader = (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-title">SCOPE</div>
        <div className="app-header-subtitle">Satellite Communication Optimizer and Planning Engine</div>
      </div>
      <div className="app-header-status">
        <div className={`app-status app-status--${headerStatusClass}`}>
          <span className="app-status-dot" aria-hidden="true"></span>
          <span className="app-status-label">{headerStatusLabel}</span>
        </div>
      </div>
    </header>
  )

  if (view === 'landing') {
    return (
      <div className="app-shell">
        {appHeader}
        <div className="app-content app-content--landing">
          <div className="landing-shell">
            <div className="landing-content">
              <div className="landing-info" role="status" aria-live="polite">
                <span className="landing-info-icon" aria-hidden="true">i</span>
                <p className="landing-info-text">
                  No assets loaded yet. Click the button to request from SatOS.
                </p>
              </div>

              <div className="landing-actions">
                <button
                  className="btn-fetch"
                  onClick={fetchSatellites}
                  disabled={loading || backendAlive === false}
                >
                  {loading ? (
                    <>
                      <span className="loading-spinner"></span>
                      Fetching...
                    </>
                  ) : (
                    'Load Mission Assets'
                  )}
                </button>

                {error && (
                  <div className="error-message">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {backendAlive === false && (
                  <p className="results-warning">
                    Please start your FastAPI server (<code>python run.py</code> in <code>backend/</code>) to test integration.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const pageContent = (
    <div className={`workspace-shell ${sidebarCollapsed ? 'workspace-shell--collapsed' : ''}`}>
        <aside className={`workspace-sidebar ${sidebarCollapsed ? 'workspace-sidebar--collapsed' : ''}`}>
          <div className="workspace-sidebar-header">
            {!sidebarCollapsed && <h2>Configuration</h2>}
            <button
              type="button"
              className="sidebar-collapse-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? 'Expand configuration sidebar' : 'Collapse configuration sidebar'}
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>

          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-label">Config</div>
          ) : (
            <>
              <div className="sidebar-block">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection('satellites')}
                >
                  <span>Satellites</span>
                  <span className="section-toggle-icon">
                    {expandedSections.satellites ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.satellites && (
                  <div className="checkbox-list">
                    {satellites.map((name, index) => (
                      <label key={`${name}-${index}`} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedSatellites.includes(name)}
                          onChange={() => toggleSatellite(name)}
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="sidebar-block">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection('groundStations')}
                >
                  <span>Ground Stations</span>
                  <span className="section-toggle-icon">
                    {expandedSections.groundStations ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.groundStations && (
                  <p>Will be enabled once SatOS assets can be distinguished.</p>
                )}
              </div>

              <div className="sidebar-block">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection('filters')}
                >
                  <span>Filters</span>
                  <span className="section-toggle-icon">
                    {expandedSections.filters ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.filters && (
                  <p>Filter controls will be added here.</p>
                )}
              </div>

              <button
                className="btn-fetch"
                disabled={selectedSatellites.length === 0 || launchingScheduler}
                onClick={handleLaunchScheduler}
              >
                {launchingScheduler ? 'Launching...' : 'Launch Communication Scheduler'}
              </button>
            </>
          )}
        </aside>

        <main className="workspace-main">
          <section className="panel overview-panel">
            <div className="panel-heading">
              <div>
                <h2>Overview</h2>
                <p className="panel-intro">
                  This area will summarize the extracted communication opportunities and
                  the current scheduler state.
                </p>
              </div>
              <div
                className={`app-status overview-inline-status ${
                  extractionStatus === 'Completed'
                    ? 'app-status--online'
                    : extractionStatus === 'Running'
                      ? 'app-status--checking'
                      : 'app-status--offline'
                }`}
              >
                <span className="overview-status-label">Extraction Status</span>
                <span className="app-status-dot" aria-hidden="true"></span>
                <span className="app-status-label">{extractionStatus}</span>
              </div>
            </div>

            <div className="overview-list">
              <div className="overview-table-scroll">
                <div className={`overview-list-header overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                  <span>Overpass ID</span>
                  <span>Sat ID</span>
                  <span>GS ID</span>
                  <span>Overpass Duration</span>
                  {tradeOffsCalculated && <span>Trade-Offs</span>}
                </div>
                {overviewRows.length === 0 ? (
                  <>
                    <div className="overview-list-row overview-list-row--placeholder overview-list-grid">
                      <span>OP-001</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      <span>Pending</span>
                    </div>
                    <div className="overview-list-row overview-list-row--placeholder overview-list-grid">
                      <span>OP-002</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      <span>Pending</span>
                    </div>
                  </>
                ) : (
                  <>
                    {overviewRows.map((row) => (
                      <div
                        key={row.overpassId}
                        className={`overview-list-row ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''} overview-list-grid`}
                      >
                        <span>{row.overpassId}</span>
                        <span>{row.satId}</span>
                        <span>{row.gsId}</span>
                        <span>{row.duration}</span>
                        {tradeOffsCalculated && <span>{row.tradeOff}</span>}
                      </div>
                    ))}
                  </>
                )}
              </div>
              {overviewRows.length === 0 ? (
                <p className="overview-note">
                  Overpass rows will be created after launch. A <strong>Trade-Offs</strong>
                  {' '}column will be added once the calculation has been executed.
                </p>
              ) : (
                <p className="overview-note">
                  Ground-station identifiers and overpass durations are currently simulated until the backend
                  exposes the full extraction payload.
                </p>
              )}
            </div>

            <button
              className="panel-action"
              disabled={!schedulerLaunched || calculatingTradeOffs}
              onClick={handleCalculateTradeOffs}
            >
              {calculatingTradeOffs ? 'Calculating Trade-Offs...' : 'Calculate Trade-Offs'}
            </button>
          </section>

          <section className="panel tradeoff-panel">
            <h2>Trade-Off</h2>
            {!tradeOffsCalculated && (
              <p>Conflict analysis and decision cards will appear here after the trade-off calculation.</p>
            )}
            {tradeOffsCalculated && (
              <div className="tradeoff-card-list">
                {tradeOffCards.map((card) => (
                  <article
                    key={card.title}
                    className={`tradeoff-card ${selectedTradeOffCard === card.title ? 'tradeoff-card--selected' : ''}`}
                  >
                    <div className="tradeoff-card-header">
                      <h3>{card.title}</h3>
                      <div className="tradeoff-meta">
                        {card.recommended && <span className="tradeoff-recommended">Recommended</span>}
                        <span className="tradeoff-score">{card.score}</span>
                      </div>
                    </div>
                    <p className="tradeoff-link">{card.selectedLink}</p>
                    <button
                      type="button"
                      className="tradeoff-select-button"
                      onClick={() => setSelectedTradeOffCard(card.title)}
                    >
                      {selectedTradeOffCard === card.title ? 'Selected' : 'Select'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Timeline</h2>
            <p>The current and proposed communication schedule will appear here.</p>
          </section>
        </main>
      </div>
  )

  return (
    <div className="app-shell">
      {appHeader}

      <div className="app-content">
        {pageContent}
      </div>
    </div>
  )
}
