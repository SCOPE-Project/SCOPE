import { memo } from 'react'

const AppHeader = memo(function AppHeader({
  showStatus,
  backendStatusClass,
  backendStatusLabel,
  satosStatusClass,
  satosStatusLabel,
  userName,
}) {
  return (
      <header className="app-header">
        <div className="app-header-brand">
          <div className="app-header-title">SCOPE</div>
          <div className="app-header-subtitle">Satellite Communication Optimizer and Planning Engine</div>
        </div>
        <div className="app-header-controls">
          {userName.trim() !== '' && (
            <div className="app-header-user" title={`Logged Mission Operator: ${userName.trim()}`}>
              <span className="app-header-user-badge">
                <span className="app-header-user-icon" aria-hidden="true">👤</span>
                <span className="app-header-user-label">Operator:</span>
                <strong className="app-header-user-name">{userName.trim()}</strong>
              </span>
            </div>
          )}
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
        </div>
      </header>
  )
})

export default AppHeader
