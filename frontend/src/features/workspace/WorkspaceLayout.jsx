import { memo } from 'react'

import { PANEL_LABELS } from '../../config/constants.js'

// The workspace: a collapsible sidebar of run settings beside a grid of four
// panel slots.
//
// Which panel occupies which slot is state, not structure -- a panel can be
// dragged into any slot -- so this renders `panelNodesById[slot]` rather than
// naming the panels directly.
//
// Every divider obeys the same rule: dragging it moves the divider and
// resizes the panel BEFORE it (above for horizontal, left for vertical).
const WorkspaceLayout = memo(function WorkspaceLayout({
  backendAlive,
  bottomTopHeightPx,
  expandedSections,
  groundStationAssets,
  handleLaunchScheduler,
  handlePanelResizeKeyDown,
  handlePanelResizeStart,
  handlePlanningRowResizeKeyDown,
  handlePlanningRowResizeStart,
  handleTerminateScheduler,
  handleTopPanelsResizeKeyDown,
  handleTopPanelsResizeStart,
  launchRequirementsMet,
  launchingScheduler,
  overviewPanelWidth,
  panelNodesById,
  panelSlotAssignment,
  renderAssetWarning,
  renderBufferConfigContent,
  renderLinkFiltersContent,
  renderPlanningWindowContent,
  renderSectionChevron,
  renderTradeOffConfigContent,
  satelliteAssets,
  selectedGroundStations,
  selectedSatellites,
  setSidebarCollapsed,
  sidebarCollapsed,
  splitPanelsRef,
  toggleGroundStation,
  toggleSatellite,
  toggleSection,
  topPanelsHeightPx,
  unavailableAssets,
}) {
  return (
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
              <div className="sidebar-collapsed-content">
                <span className="sidebar-collapsed-label">Configuration</span>
                {launchingScheduler && (
                  <button
                    type="button"
                    className="sidebar-collapsed-terminate"
                    onClick={handleTerminateScheduler}
                    aria-label="Terminate the communication scheduler launch"
                    title="Terminate"
                  >
                    <svg
                      className="sidebar-collapsed-terminate-icon"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M3 3 9 9 M9 3 3 9" />
                    </svg>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="workspace-sidebar-content">
                  <div className="sidebar-block">
                    <button
                      type="button"
                      className="section-toggle"
                      onClick={() => toggleSection('timeWindow')}
                    >
                      <span>Time Window</span>
                      <span className="section-toggle-icon" aria-hidden="true">
                        {renderSectionChevron(expandedSections.timeWindow)}
                      </span>
                    </button>
                    {expandedSections.timeWindow && renderPlanningWindowContent()}
                  </div>

                  <div className="sidebar-block">
                    <button
                      type="button"
                      className="section-toggle"
                      onClick={() => toggleSection('satellites')}
                    >
                      <span>Satellites</span>
                      <span className="section-toggle-icon" aria-hidden="true">
                        {renderSectionChevron(expandedSections.satellites)}
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
                        {renderSectionChevron(expandedSections.groundStations)}
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
                        {renderSectionChevron(expandedSections.unavailableAssets)}
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
                      onClick={() => toggleSection('linkFilters')}
                    >
                      <span>Link Filters</span>
                      <span className="section-toggle-icon" aria-hidden="true">
                        {renderSectionChevron(expandedSections.linkFilters)}
                      </span>
                    </button>
                    {expandedSections.linkFilters && renderLinkFiltersContent()}
                  </div>

                  <div className="sidebar-block">
                    <button
                      type="button"
                      className="section-toggle"
                      onClick={() => toggleSection('bufferConfig')}
                    >
                      <span>Buffer Configuration</span>
                      <span className="section-toggle-icon" aria-hidden="true">
                        {renderSectionChevron(expandedSections.bufferConfig)}
                      </span>
                    </button>
                    {expandedSections.bufferConfig && renderBufferConfigContent()}
                  </div>

                  <div className="sidebar-block">
                    <button
                      type="button"
                      className="section-toggle"
                      onClick={() => toggleSection('tradeOffConfig')}
                    >
                      <span>Trade-Off Configuration</span>
                      <span className="section-toggle-icon" aria-hidden="true">
                        {renderSectionChevron(expandedSections.tradeOffConfig)}
                      </span>
                    </button>
                    {expandedSections.tradeOffConfig && renderTradeOffConfigContent()}
                  </div>
                </div>

                <div className="sidebar-action-wrapper">
                  {launchingScheduler ? (
                    <button
                      type="button"
                      className="btn-fetch btn-terminate"
                      onClick={handleTerminateScheduler}
                    >
                      Terminate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-fetch"
                      disabled={!launchRequirementsMet || backendAlive !== true}
                      onClick={handleLaunchScheduler}
                    >
                      Launch Communication Scheduler
                    </button>
                  )}
                  {!launchingScheduler && (!launchRequirementsMet || backendAlive !== true) && (
                    <span className="sidebar-action-tooltip">
                      {backendAlive === false
                        ? 'Backend offline \u2014 start the SCOPE backend to launch the scheduler.'
                        : 'Enter a valid time window and select at least 1 satellite and 1 ground station first.'}
                    </span>
                  )}
                </div>
              </>
            )}
          </aside>

          <main className="workspace-main">
            <div
              ref={splitPanelsRef}
              className="workspace-panels-split"
              style={{
                // Without a second panel in the top row there is nothing to
                // split, so the remaining panel takes the full width and the
                // vertical resizer disappears with it.
                gridTemplateColumns: panelSlotAssignment.topRight
                  ? `minmax(0, ${overviewPanelWidth}%) 0.9rem minmax(0, calc(${100 - overviewPanelWidth}% - 0.9rem))`
                  : 'minmax(0, 1fr)',
                '--top-panels-height': `${topPanelsHeightPx}px`,
              }}
            >
            {panelNodesById[panelSlotAssignment.topLeft]}

            {panelSlotAssignment.topRight && (
              <>
                <div
                  className={`panel-resizer ${!expandedSections[panelSlotAssignment.topLeft] && !expandedSections[panelSlotAssignment.topRight] ? 'panel-resizer--collapsed' : ''}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize the top-row panels"
                  tabIndex={0}
                  onPointerDown={handlePanelResizeStart}
                  onKeyDown={handlePanelResizeKeyDown}
                >
                  <span className="panel-resizer-line" aria-hidden="true"></span>
                  <span className="panel-resizer-grip" aria-hidden="true"></span>
                </div>

                {panelNodesById[panelSlotAssignment.topRight]}
              </>
            )}
            </div>

            <div
              className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.topLeft] && !(panelSlotAssignment.topRight && expandedSections[panelSlotAssignment.topRight]) ? 'panel-resizer--collapsed' : ''}`}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the height of the top row"
              tabIndex={0}
              onPointerDown={handleTopPanelsResizeStart}
              onKeyDown={handleTopPanelsResizeKeyDown}
            >
              <span className="panel-resizer-line panel-resizer-line--horizontal" aria-hidden="true"></span>
              <span className="panel-resizer-grip panel-resizer-grip--horizontal" aria-hidden="true"></span>
            </div>

            <div
              className="planning-views-row"
              style={{
                // A collapsed panel falls back to `auto` -- holding a fixed
                // height open for a collapsed panel would just leave a gap.
                gridTemplateRows: [
                  expandedSections[panelSlotAssignment.bottomTop] ? `${bottomTopHeightPx}px` : 'auto',
                  '0.9rem',
                  'auto',
                ].join(' '),
              }}
            >
            {panelNodesById[panelSlotAssignment.bottomTop]}

            <div
              className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.bottomTop] && !expandedSections[panelSlotAssignment.bottomMiddle] ? 'panel-resizer--collapsed' : ''}`}
              role="separator"
              aria-orientation="horizontal"
              aria-label={`Resize the ${PANEL_LABELS[panelSlotAssignment.bottomTop]} panel`}
              tabIndex={0}
              onPointerDown={handlePlanningRowResizeStart}
              onKeyDown={handlePlanningRowResizeKeyDown}
            >
              <span className="panel-resizer-line panel-resizer-line--horizontal" aria-hidden="true"></span>
              <span className="panel-resizer-grip panel-resizer-grip--horizontal" aria-hidden="true"></span>
            </div>

            {panelNodesById[panelSlotAssignment.bottomMiddle]}
            </div>
          </main>
        </div>
  )
})

export default WorkspaceLayout
