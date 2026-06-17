import { useState, useEffect } from 'react'

export default function App() {
  const [satellites, setSatellites] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [backendAlive, setBackendAlive] = useState(null) // null = checking, true = alive, false = dead

  useEffect(() => {
    // Check if backend is alive on mount
    const checkBackend = async () => {
      try {
        const res = await fetch('http://localhost:8000/status')
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

  const fetchSatellites = async () => {
    setLoading(true)
    setError(null)
    setSatellites([])
    try {
      const response = await fetch('http://localhost:8000/satellite/list')
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`)
      }
      const data = await response.json()
      if (data && Array.isArray(data.satellites)) {
        setSatellites(data.satellites)
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

  return (
    <div className="container">
      <div className="header">
        <h1>VLEO Scheduling</h1>
        <p>SatOS Constellation-to-Ground Control</p>
        <div>
          {backendAlive === null && (
            <span className="status-badge checking" style={{ color: 'var(--text-secondary)' }}>Checking connection...</span>
          )}
          {backendAlive === true && (
            <span className="status-badge connected">Backend Online</span>
          )}
          {backendAlive === false && (
            <span className="status-badge disconnected">Backend Offline</span>
          )}
        </div>
      </div>

      <div className="control-panel">
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
            'Get Satellite List'
          )}
        </button>

        <div className="results-area">
          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && !error && satellites.length > 0 && (
            <ul className="satellite-list">
              {satellites.map((name, index) => (
                <li key={`${name}-${index}`} className="satellite-item" style={{ animationDelay: `${index * 50}ms` }}>
                  <span className="satellite-name">{name}</span>
                  <span className="satellite-tag">Active</span>
                </li>
              ))}
            </ul>
          )}

          {!loading && !error && satellites.length === 0 && backendAlive === true && (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.9rem' }}>
              No satellites loaded yet. Click the button to request from SatOS.
            </p>
          )}

          {backendAlive === false && (
            <p style={{ color: 'var(--error-text)', textAlign: 'center', fontSize: '0.9rem', marginTop: '1rem' }}>
              Please start your FastAPI server (<code>python main.py</code> in <code>backend/</code>) to test integration.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}