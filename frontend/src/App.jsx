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
  const [selectedTradeOffOption, setSelectedTradeOffOption] = useState(null)
  const [activeMapAssetId, setActiveMapAssetId] = useState(null)
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

  const buildMockOverpasses = (selectedSatelliteNames, selectedGroundStationNames) => {
    const candidateGroundStations =
      selectedGroundStationNames.length > 0
        ? selectedGroundStationNames.slice(0, Math.min(2, selectedGroundStationNames.length))
        : ['GS-TBD-1']

    let overpassIndex = 1

    return selectedSatelliteNames.flatMap((satellite, satelliteIndex) =>
      candidateGroundStations.map((groundStation, groundStationIndex) => ({
        overpassId: `OP-${String(overpassIndex++).padStart(3, '0')}`,
        satId: satellite,
        gsId: groundStation,
        duration: `${8 + satelliteIndex * 2 + groundStationIndex} min`,
      }))
    )
  }

  const buildMockTradeOffState = (rows) => {
    const rowsBySatellite = rows.reduce((groups, row) => {
      if (!groups[row.satId]) {
        groups[row.satId] = []
      }
      groups[row.satId].push(row)
      return groups
    }, {})

    let conflictIndex = 1
    const rowTradeOffMap = new Map()

    const groups = Object.entries(rowsBySatellite)
      .filter(([, groupRows]) => groupRows.length > 1)
      .map(([satelliteId, groupRows]) => {
        const groupLabel = `TO-${String(conflictIndex).padStart(2, '0')}`
        const options = groupRows.map((row, optionIndex) => {
          const score = `${92 - (conflictIndex - 1) * 8 - optionIndex * 9}/100`
          rowTradeOffMap.set(row.overpassId, groupLabel)
          return {
            optionId: `${satelliteId}-${row.overpassId}`,
            overpassId: row.overpassId,
            satId: row.satId,
            gsId: row.gsId,
            duration: row.duration,
            tradeOffId: groupLabel,
            score,
            recommended: optionIndex === 0,
          }
        })

        const group = {
          id: `tradeoff-${conflictIndex}`,
          title: groupLabel,
          resourceLabel: satelliteId,
          reason: `Multiple downlink options for the same satellite overlap in the current planning window.`,
          options,
        }

        conflictIndex += 1
        return group
      })

    const enrichedRows = rows.map((row) => ({
      ...row,
      tradeOffId: rowTradeOffMap.get(row.overpassId) ?? '—',
      tradeOffScore:
        groups
          .flatMap((group) => group.options)
          .find((option) => option.overpassId === row.overpassId)?.score ?? '—',
    }))

    return { enrichedRows, groups }
  }

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
    if (selectedSatellites.length === 0 || selectedGroundStations.length === 0) return

    setLaunchingScheduler(true)
    setExtractionStatus('Running')
    setSchedulerLaunched(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setSelectedTradeOffOption(null)

    const simulatedRows = buildMockOverpasses(selectedSatellites, selectedGroundStations)

    await new Promise((resolve) => setTimeout(resolve, 900))

    setOverviewRows(simulatedRows)
    setSchedulerLaunched(true)
    setSidebarCollapsed(true)
    setExtractionStatus('Completed')
    setLaunchingScheduler(false)
  }

  const handleCalculateTradeOffs = async () => {
    if (!schedulerLaunched || overviewRows.length === 0) return

    setCalculatingTradeOffs(true)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const { enrichedRows, groups } = buildMockTradeOffState(overviewRows)

    setOverviewRows(enrichedRows)
    setTradeOffCards(groups)
    setSelectedTradeOffOption(groups[0]?.options.find((option) => option.recommended)?.optionId ?? null)
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
  const launchRequirementsMet =
    selectedSatellites.length >= 1 && selectedGroundStations.length >= 1

  const getAssetCoordinates = (asset) => {
    if (
      typeof asset?.details?.latitude === 'number' &&
      typeof asset?.details?.longitude === 'number'
    ) {
      return {
        latitude: asset.details.latitude,
        longitude: asset.details.longitude,
      }
    }

    return null
  }

  const projectToMap = (latitude, longitude) => ({
    left: ((longitude + 180) / 360) * 100,
    top: ((90 - latitude) / 180) * 100,
  })

  const formatCoordinate = (value, positiveLabel, negativeLabel) => {
    const direction = value >= 0 ? positiveLabel : negativeLabel
    return `${Math.abs(value).toFixed(2)}° ${direction}`
  }

  const selectedGroundStationAssets = groundStationAssets.filter((asset) =>
    selectedGroundStations.includes(asset.name)
  )

  const selectedSatelliteAssets = satelliteAssets.filter((asset) =>
    selectedSatellites.includes(asset.name)
  )

  const selectedMapAssets = [
    ...selectedGroundStationAssets
      .map((asset) => {
        const coordinates = getAssetCoordinates(asset)
        if (!coordinates) {
          return null
        }

        return {
          id: `ground-station-${asset.name}`,
          name: asset.name,
          type: 'Ground Station',
          markerType: 'ground-station',
          ...coordinates,
        }
      })
      .filter(Boolean),
    ...selectedSatelliteAssets
      .map((asset) => {
        const coordinates = getAssetCoordinates(asset)
        if (!coordinates) {
          return null
        }

        return {
          id: `satellite-${asset.name}`,
          name: asset.name,
          type: 'Satellite',
          markerType: 'satellite',
          ...coordinates,
        }
      })
      .filter(Boolean),
  ]

  const unmappedSelectedAssets = [
    ...selectedGroundStationAssets
      .filter((asset) => !getAssetCoordinates(asset))
      .map((asset) => ({
        id: `unmapped-ground-station-${asset.name}`,
        name: asset.name,
        type: 'Ground Station',
      })),
    ...selectedSatelliteAssets
      .filter((asset) => !getAssetCoordinates(asset))
      .map((asset) => ({
        id: `unmapped-satellite-${asset.name}`,
        name: asset.name,
        type: 'Satellite',
      })),
  ]

  const activeMapAsset =
    selectedMapAssets.find((asset) => asset.id === activeMapAssetId) ?? selectedMapAssets[0] ?? null

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
              <svg
                className="sidebar-collapse-icon"
                viewBox="0 0 12 12"
                aria-hidden="true"
                focusable="false"
              >
                {sidebarCollapsed ? (
                  <path d="M4 2.25 7.75 6 4 9.75" />
                ) : (
                  <path d="M8 2.25 4.25 6 8 9.75" />
                )}
              </svg>
            </button>
          </div>

          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-label">Configuration</div>
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

              <div className="sidebar-action-wrapper">
                <button
                  className="btn-fetch"
                  disabled={!launchRequirementsMet || launchingScheduler}
                  onClick={handleLaunchScheduler}
                >
                  {launchingScheduler ? 'Launching...' : 'Launch Communication Scheduler'}
                </button>
                {!launchRequirementsMet && !launchingScheduler && (
                  <span className="sidebar-action-tooltip">
                    Select at least 1 satellite and 1 ground station first.
                  </span>
                )}
              </div>
              <p className="sidebar-action-note">
                For the current dummy trade-off view, select at least two ground stations.
              </p>
            </>
          )}
        </aside>

        <main className="workspace-main">
          <section className="panel panel--fullwidth map-panel">
            <div className="panel-heading panel-heading--map">
              <div>
                <h2>Map View</h2>
                <p className="map-panel-copy">
                  Selected assets with map coordinates appear here as markers.
                </p>
              </div>
              <div className="map-summary">
                <span className="map-summary-pill">
                  {selectedMapAssets.length} mapped
                </span>
                <span className="map-summary-pill map-summary-pill--muted">
                  {unmappedSelectedAssets.length} awaiting coordinates
                </span>
              </div>
            </div>

            <div className="map-layout">
              <div className="map-canvas-shell">
                <div className="map-canvas" aria-label="Selected asset map view">
                  {selectedMapAssets.length === 0 && (
                    <div className="map-empty-state">
                      Select a ground station to place it on the map.
                    </div>
                  )}

                  {selectedMapAssets.map((asset) => {
                    const markerPosition = projectToMap(asset.latitude, asset.longitude)

                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`map-marker map-marker--${asset.markerType} ${
                          activeMapAsset?.id === asset.id ? 'map-marker--active' : ''
                        }`}
                        style={{
                          left: `${markerPosition.left}%`,
                          top: `${markerPosition.top}%`,
                        }}
                        onClick={() => setActiveMapAssetId(asset.id)}
                        aria-label={`${asset.name} on map`}
                      >
                        <span className="map-marker-label">{asset.name}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="map-note">
                  Ground stations are plotted directly from latitude/longitude. Selected satellites stay in the
                  list until the frontend receives map-ready coordinates for them.
                </p>
              </div>

              <aside className="map-sidebar">
                <div className="map-sidebar-section">
                  <h3>Visible Assets</h3>
                  {selectedMapAssets.length > 0 ? (
                    <div className="map-asset-list">
                      {selectedMapAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          className={`map-asset-button ${
                            activeMapAsset?.id === asset.id ? 'map-asset-button--active' : ''
                          }`}
                          onClick={() => setActiveMapAssetId(asset.id)}
                        >
                          <span className={`map-asset-dot map-asset-dot--${asset.markerType}`}></span>
                          <span className="map-asset-name">{asset.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p>No selected assets with usable map coordinates yet.</p>
                  )}
                </div>

                <div className="map-sidebar-section">
                  <h3>Awaiting Map Position</h3>
                  {unmappedSelectedAssets.length > 0 ? (
                    <ul className="map-unmapped-list">
                      {unmappedSelectedAssets.map((asset) => (
                        <li key={asset.id}>
                          <span className="map-unmapped-name">{asset.name}</span>
                          <span className="map-unmapped-type">{asset.type}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>All selected assets with available location data are already shown on the map.</p>
                  )}
                </div>

                {activeMapAsset && (
                  <div className="map-detail-card">
                    <h3>{activeMapAsset.name}</h3>
                    <p>{activeMapAsset.type}</p>
                    <dl className="map-detail-grid">
                      <dt>Latitude</dt>
                      <dd>{formatCoordinate(activeMapAsset.latitude, 'N', 'S')}</dd>
                      <dt>Longitude</dt>
                      <dd>{formatCoordinate(activeMapAsset.longitude, 'E', 'W')}</dd>
                    </dl>
                  </div>
                )}
              </aside>
            </div>
          </section>

          <section className="panel overview-panel">
            <div className="panel-heading">
              <div>
                <h2>Overview</h2>
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
                <span className="overview-status-label">Overpass Extraction Status</span>
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
                  {tradeOffsCalculated && <span>Trade Off ID</span>}
                  {tradeOffsCalculated && <span>Score</span>}
                </div>
                {overviewRows.length === 0 ? (
                  <>
                    <div className={`overview-list-row overview-list-row--placeholder overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                      <span>OP-001</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      {tradeOffsCalculated && <span>—</span>}
                      {tradeOffsCalculated && <span>—</span>}
                    </div>
                    <div className={`overview-list-row overview-list-row--placeholder overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                      <span>OP-002</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      <span>Pending</span>
                      {tradeOffsCalculated && <span>—</span>}
                      {tradeOffsCalculated && <span>—</span>}
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
                        {tradeOffsCalculated && <span>{row.tradeOffId}</span>}
                        {tradeOffsCalculated && <span>{row.tradeOffScore}</span>}
                      </div>
                    ))}
                  </>
                )}
              </div>
              {overviewRows.length > 0 && (
                <p className="overview-note">
                  Overpass duration and trade-off values shown here are currently placeholder values and do not
                  represent final calculation results.
                </p>
              )}
            </div>

            <div className="panel-action-wrapper">
              <button
                className="panel-action"
                disabled={!schedulerLaunched || calculatingTradeOffs}
                onClick={handleCalculateTradeOffs}
              >
                {calculatingTradeOffs ? 'Calculating Trade-Offs...' : 'Calculate Trade-Offs'}
              </button>
              {!schedulerLaunched && !calculatingTradeOffs && (
                <span className="panel-action-tooltip">
                  Launch Communication Scheduler first and wait for extraction to complete.
                </span>
              )}
            </div>
          </section>

          <section className="panel tradeoff-panel">
            <h2>Trade-Off</h2>
            {tradeOffsCalculated && (
              <p className="tradeoff-summary">
                {tradeOffCards.length} trade-off group{tradeOffCards.length === 1 ? '' : 's'} identified.
              </p>
            )}
            {!tradeOffsCalculated && (
              <p>Trade-off decision cards will appear here after the trade-off calculation.</p>
            )}
            {tradeOffsCalculated && tradeOffCards.length === 0 && (
              <p>No trade-off groups were identified for the current selection.</p>
            )}
            {tradeOffsCalculated && tradeOffCards.length > 0 && (
              <div className="tradeoff-card-list">
                {tradeOffCards.map((card) => (
                  <article
                    key={card.id}
                    className="tradeoff-card"
                  >
                    <div className="tradeoff-card-header">
                      <div className="tradeoff-card-titleblock">
                        <h3>{card.title}</h3>
                        <p className="tradeoff-card-resource">{card.resourceLabel}</p>
                      </div>
                      <div className="tradeoff-meta">
                        <span className="tradeoff-score">{card.options.length} options</span>
                      </div>
                    </div>
                    <p className="tradeoff-reason">
                      <span className="tradeoff-reason-label">Reason:</span> {card.reason}
                    </p>

                    <div className="tradeoff-option-list">
                      {card.options.map((option) => (
                        <div
                          key={option.optionId}
                          className={`tradeoff-option ${selectedTradeOffOption === option.optionId ? 'tradeoff-option--selected' : ''}`}
                        >
                          <div className="tradeoff-option-header">
                            <span className="tradeoff-option-id">{option.overpassId}</span>
                            <div className="tradeoff-meta tradeoff-meta--option">
                              {option.recommended && <span className="tradeoff-recommended">Recommended</span>}
                              <span className="tradeoff-score">{option.score}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="tradeoff-select-button"
                            onClick={() => setSelectedTradeOffOption(option.optionId)}
                          >
                            {selectedTradeOffOption === option.optionId ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel panel--fullwidth">
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
