import { memo } from 'react'
import { createPortal } from 'react-dom'

// The landing page: pick assets, set the planning window and the buffer and
// scoring configuration, then launch the scheduler.
//
// The launch button stays disabled until every requirement is met, and says
// which one is missing rather than just refusing.
const LandingPage = memo(function LandingPage({
  appHeader,
  clearExistingScopeActivities,
  error,
  fetchAssets,
  handleLoadScope,
  handleTerminateScheduler,
  launchingScheduler,
  loadScopeDisabled,
  loadScopeDisabledReason,
  missionAssetsLoaded,
  missionAssetsStatus,
  renderAssetsLandingContent,
  renderBufferConfigContent,
  renderExtractionProgressPanel,
  renderLinkFiltersContent,
  renderPlanningWindowContent,
  renderTradeOffConfigContent,
  setClearExistingScopeActivities,
  setUserName,
  showOverviewProgress,
  userName,
  warningTooltip,
}) {
  const filterTooltip = 'Waiting for SatOS mission data\u2026'

  return (
        <div className="app-shell">
          {appHeader(true)}
          <div className="app-content app-content--landing">
            <div className="landing-shell">
              <div className="landing-content">
                <div className={`landing-config-shell ${missionAssetsLoaded ? '' : 'landing-config-shell--disabled'}`}>
                  <div className="landing-config-header landing-config-header--primary">
                    <div
                      className={`landing-assets-status landing-assets-status--${missionAssetsStatus.tone}`}
                      role="status"
                      aria-live="polite"
                    >
                      {missionAssetsStatus.busy && (
                        <span className="loading-spinner loading-spinner--inline" aria-hidden="true"></span>
                      )}
                      <span className="landing-assets-status-text">{missionAssetsStatus.label}</span>
                      {missionAssetsStatus.retryLabel && (
                        <button
                          type="button"
                          className="landing-assets-status-action"
                          onClick={() => fetchAssets({ forceRefresh: true })}
                          disabled={launchingScheduler}
                          title={missionAssetsLoaded ? 'Force fresh re-initialization from SatOS' : 'Retry loading assets'}
                        >
                          {missionAssetsStatus.retryLabel}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="landing-config-divider"></div>

                  <div className="landing-config-body landing-config-body--landing">
                    <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                      <div className="landing-config-panel-header">
                        <span className="landing-config-step">Time Window</span>
                      </div>
                      {renderPlanningWindowContent(!missionAssetsLoaded)}
                      {!missionAssetsLoaded && (
                        <span className="landing-panel-tooltip">{filterTooltip}</span>
                      )}
                    </section>

                    <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                      <div className="landing-config-panel-header">
                        <span className="landing-config-step">Assets</span>
                      </div>
                      {renderAssetsLandingContent(!missionAssetsLoaded)}
                      {!missionAssetsLoaded && (
                        <span className="landing-panel-tooltip">{filterTooltip}</span>
                      )}
                    </section>

                    <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                      <div className="landing-config-panel-header">
                        <span className="landing-config-step">Link Filters</span>
                      </div>
                      {renderLinkFiltersContent(!missionAssetsLoaded)}
                      {!missionAssetsLoaded && (
                        <span className="landing-panel-tooltip">{filterTooltip}</span>
                      )}
                    </section>

                    <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                      <div className="landing-config-panel-header">
                        <span className="landing-config-step">Buffer Configuration</span>
                      </div>
                      {renderBufferConfigContent(!missionAssetsLoaded)}
                      {!missionAssetsLoaded && (
                        <span className="landing-panel-tooltip">{filterTooltip}</span>
                      )}
                    </section>

                    <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                      <div className="landing-config-panel-header">
                        <span className="landing-config-step">Trade-Off Configuration</span>
                      </div>
                      {renderTradeOffConfigContent(!missionAssetsLoaded)}
                      {!missionAssetsLoaded && (
                        <span className="landing-panel-tooltip">{filterTooltip}</span>
                      )}
                    </section>
                  </div>

                  {showOverviewProgress && (
                    <div className="landing-progress-shell">
                      {renderExtractionProgressPanel()}
                    </div>
                  )}

                  <div className="landing-config-footer">
                    <div className="landing-footer-controls">
                      <label className="landing-operator-inline-label">
                        <span className="landing-operator-icon" aria-hidden="true">👤</span>
                        <span className="landing-operator-text">Operator:</span>
                        <input
                          type="text"
                          className="landing-operator-inline-input"
                          placeholder="Enter your name (required)..."
                          value={userName}
                          onChange={(e) => setUserName(e.target.value)}
                          disabled={launchingScheduler}
                          aria-label="Mission operator name"
                        />
                      </label>
                      <label className="landing-clear-scope-option">
                        <input
                          type="checkbox"
                          checked={clearExistingScopeActivities}
                          onChange={(e) => setClearExistingScopeActivities(e.target.checked)}
                          disabled={launchingScheduler}
                        />
                        <span>Clear all existing SCOPE activities from the SatOS schedule</span>
                      </label>
                    </div>
                    <div className="landing-action-wrapper">
                      {launchingScheduler ? (
                        <button
                          className="btn-fetch btn-terminate landing-action-button"
                          onClick={handleTerminateScheduler}
                        >
                            Terminate
                        </button>
                      ) : (
                        <button
                          className="btn-fetch landing-action-button"
                          onClick={handleLoadScope}
                          disabled={loadScopeDisabled}
                        >
                          Load SCOPE
                        </button>
                      )}
                      {!launchingScheduler && loadScopeDisabled && (
                        <span className="landing-action-tooltip">
                          {loadScopeDisabledReason}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="error-message">
                    <strong>Error:</strong> {error}
                  </div>
                )}
              </div>
            </div>
          </div>
          {warningTooltip.visible && createPortal((
            <div
              className="timeline-hover-tooltip warning-hover-tooltip"
              style={{
                left: `${Math.max(12, Math.min(warningTooltip.x + 16, window.innerWidth - 320))}px`,
                top: `${Math.max(12, Math.min(warningTooltip.y + 18, window.innerHeight - 120))}px`,
              }}
            >
              {warningTooltip.message}
            </div>
          ), document.body)}
        </div>
  )
})

export default LandingPage
