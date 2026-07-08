import { useState, useEffect } from 'react'

export default function App() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [backendAlive, setBackendAlive] = useState(null)
  const [satosAlive, setSatosAlive] = useState(null)
  const [view, setView] = useState('landing')
  const [selectedSatellites, setSelectedSatellites] = useState([])
  const [selectedGroundStations, setSelectedGroundStations] = useState([])
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
    groundStations: true,
    unavailableAssets: false,
    filters: false,
  })

  useEffect(() => {
    const checkConnections = async () => {
      try {
        const backendResponse = await fetch('http://localhost:8000/status')
        if (backendResponse.ok) {
          setBackendAlive(true)

          try {
            const satosResponse = await fetch('http://localhost:8000/satos/asset/list')
            setSatosAlive(satosResponse.ok)
          } catch (err) {
            setSatosAlive(false)
          }
        } else {
          setBackendAlive(false)
          setSatosAlive(null)
        }
      } catch (err) {
        setBackendAlive(false)
        setSatosAlive(null)
      }
    }
    checkConnections()
  }, [])

  const toggleSatellite = (name) => {
    setSelectedSatellites((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  const toggleGroundStation = (name) => {
    setSelectedGroundStations((current) =>
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

  const buildMockOverpasses = (selectedSatelliteNames, selectedGroundStationNames) =>
    selectedSatelliteNames.map((satellite, index) => ({
      overpassId: `OP-${String(index + 1).padStart(3, '0')}`,
      satId: satellite,
      gsId: selectedGroundStationNames[index % selectedGroundStationNames.length] ?? `GS-TBD-${(index % 3) + 1}`,
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

  const fetchAssets = async () => {
    setLoading(true)
    setError(null)
    setAssets([])
    setSelectedSatellites([])
    setSelectedGroundStations([])
    try {
      const response = await fetch('http://localhost:8000/satos/initialize')
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`)
      }
      const data = await response.json()
      if (data && Array.isArray(data.assets)) {
        setSatosAlive(true)
        setAssets(data.assets)
        setView('workspace')
      } else {
        throw new Error("Invalid response format from server")
      }
    } catch (err) {
      console.error(err)
      setSatosAlive(false)
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

    const simulatedRows = buildMockOverpasses(selectedSatellites, selectedGroundStations)

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

  const backendStatusClass =
    backendAlive === null ? 'checking' : backendAlive ? 'online' : 'offline'

  const backendStatusLabel =
    backendAlive === null ? 'Backend Check' : backendAlive ? 'Backend Online' : 'Backend Offline'

  const satosStatusClass =
    satosAlive === null ? 'idle' : satosAlive ? 'online' : 'offline'

  const satosStatusLabel =
    satosAlive === null
      ? backendAlive === false
        ? 'SatOS Unchecked'
        : 'SatOS Check'
      : satosAlive
        ? 'SatOS Connected'
        : 'SatOS Access Failed'

  const appHeader = (showStatus = true) => (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-title">SCOPE</div>
        <div className="app-header-subtitle">Satellite Communication Optimizer and Planning Engine</div>
      </div>
      {showStatus && (
        <div className="app-header-status">
          <div className="app-status-stack">
            <div className={`app-status app-status--${backendStatusClass}`}>
              <span className="app-status-dot" aria-hidden="true"></span>
              <span className="app-status-label">{backendStatusLabel}</span>
            </div>
            <div className={`app-status app-status--${satosStatusClass}`}>
              <span className="app-status-dot" aria-hidden="true"></span>
              <span className="app-status-label">{satosStatusLabel}</span>
            </div>
          </div>
        </div>
      )}
    </header>
  )

  const satelliteAssets = assets.filter((asset) => asset.classification === 'satellite')
  const groundStationAssets = assets.filter((asset) => asset.classification === 'ground_station')
  const unavailableAssets = assets.filter((asset) => asset.classification === 'ineligible')

  const renderAssetWarning = (message) => (
    <span className="asset-warning" aria-hidden="true">
      <svg
        className="asset-warning-icon"
        viewBox="0 0 24 24"
        focusable="false"
      >
        <path
          d="M12 3 1.8 20.5c-.4.7.1 1.5.9 1.5h18.6c.8 0 1.3-.8.9-1.5L12 3Z"
          fill="currentColor"
        />
        <path
          d="M12 8.2c.5 0 .9.4.9.9v5.7a.9.9 0 1 1-1.8 0V9.1c0-.5.4-.9.9-.9Zm0 10a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z"
          fill="#fff"
        />
      </svg>
      <span className="asset-warning-tooltip">{message}</span>
    </span>
  )

  if (view === 'landing') {
    return (
      <div className="app-shell">
        {appHeader(true)}
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
                  onClick={fetchAssets}
                  disabled={loading || backendAlive !== true || satosAlive !== true}
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

                {backendAlive === true && satosAlive === false && (
                  <p className="results-warning">
                    Backend is online, but SatOS access failed. Check credentials or current SatOS availability.
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
                  <span className="section-toggle-icon" aria-hidden="true">
                    {expandedSections.satellites ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.satellites && (
                  <div className="checkbox-list">
                    {satelliteAssets.map((asset) => (
                      <label
                        key={asset.name}
                        className={`checkbox-row ${asset.eligible ? '' : 'checkbox-row--disabled'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSatellites.includes(asset.name)}
                          onChange={() => toggleSatellite(asset.name)}
                          disabled={!asset.eligible}
                        />
                        <span className="asset-name">{asset.name}</span>
                        {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
                      </label>
                    ))}
                    {satelliteAssets.length === 0 && <p>No satellite assets available.</p>}
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
                  <span className="section-toggle-icon" aria-hidden="true">
                    {expandedSections.groundStations ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.groundStations && (
                  <div className="checkbox-list">
                    {groundStationAssets.map((asset) => (
                      <label
                        key={asset.name}
                        className={`checkbox-row ${asset.eligible ? '' : 'checkbox-row--disabled'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroundStations.includes(asset.name)}
                          onChange={() => toggleGroundStation(asset.name)}
                          disabled={!asset.eligible}
                        />
                        <span className="asset-name">{asset.name}</span>
                        {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
                      </label>
                    ))}
                    {groundStationAssets.length === 0 && <p>No ground-station assets available.</p>}
                  </div>
                )}
              </div>

              <div className="sidebar-block">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection('unavailableAssets')}
                >
                  <span>Unavailable Assets</span>
                  <span className="section-toggle-icon" aria-hidden="true">
                    {expandedSections.unavailableAssets ? '−' : '+'}
                  </span>
                </button>
                {expandedSections.unavailableAssets && (
                  <div className="checkbox-list">
                    {unavailableAssets.map((asset) => (
                      <div
                        key={asset.name}
                        className="checkbox-row checkbox-row--disabled checkbox-row--static"
                      >
                        <span className="asset-name">{asset.name}</span>
                        {asset.error && renderAssetWarning(asset.error)}
                      </div>
                    ))}
                    {unavailableAssets.length === 0 && <p>No unclassified assets.</p>}
                  </div>
                )}
              </div>

              <div className="sidebar-block">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection('filters')}
                >
                  <span>Filters</span>
                  <span className="section-toggle-icon" aria-hidden="true">
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
                className={`overview-inline-status ${
                  extractionStatus === 'Completed'
                    ? 'overview-inline-status--online'
                    : extractionStatus === 'Running'
                      ? 'overview-inline-status--checking'
                      : 'overview-inline-status--offline'
                }`}
              >
                <span className="overview-status-label">Extraction Status</span>
                <div className="overview-status-value">
                  <span className="app-status-dot" aria-hidden="true"></span>
                  <span className="overview-status-text">{extractionStatus}</span>
                </div>
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
      {appHeader(false)}

      <div className="app-content">
        {pageContent}
      </div>
    </div>
  )
}
