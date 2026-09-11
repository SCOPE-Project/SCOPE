import { memo } from 'react'
import OverpassCountdownCell from '../../components/OverpassCountdownCell.jsx'
import { formatBufferLevelGb, formatDataDownlinkGb, getBackendDataDownlinkMb, getOverviewDisplayLinkId, getOverviewRowStatus, getPassCapacityMb } from '../../domain/format.js'
import { getOverviewControlTooltip, getScheduleToggleState, getScheduleToggleTitle } from '../../domain/assets.js'

const OverviewPanel = memo(function OverviewPanel({
  bufferConfigValid,
  bufferLevelBeforeByLinkId,
  calculatingTradeOffs,
  expandedSections,
  filterRunId,
  filteredLinks,
  formatOverviewEndDateTime,
  formatOverviewStartDateTime,
  getOptionForLinkId,
  getOverviewAvailabilityLabel,
  getPanelDragClassName,
  getPanelDropZoneProps,
  getPanelHeadingDragProps,
  getScheduleBlockMessage,
  handleCalculateTradeOffs,
  handleLinkOverride,
  handleOverviewTradeOffClick,
  hideWarningTooltip,
  isOverviewRowUnavailable,
  markedTimelineLinkId,
  moveWarningTooltip,
  orbitEngineRunId,
  overridingLinkId,
  overviewRows,
  overviewTradeOffBandByOverpassId,
  propagationResult,
  renderExtractionProgressPanel,
  renderPanelDragHandle,
  renderSectionChevron,
  renderTradeOffPill,
  schedulableOverviewRows,
  schedulerLaunched,
  sessionId,
  setShowUnavailableOverviewRows,
  showOverviewProgress,
  showUnavailableOverviewRows,
  showWarningTooltip,
  toggleSection,
  tradeOffAvailable,
  tradeOffConfigValid,
  tradeOffsCalculated,
  visibleOverviewRows,
}) {
  return (
            <section
              className={`panel overview-panel ${expandedSections.overview ? '' : 'panel--collapsed'}${getPanelDragClassName('overview')}`}
              {...getPanelDropZoneProps('overview')}
            >
              <div
                className={`panel-heading ${expandedSections.overview ? '' : 'panel-heading--collapsed'}`}
                {...getPanelHeadingDragProps('overview')}
              >
                <div className="panel-heading-lead">
                  {renderPanelDragHandle('overview')}
                <div className="panel-heading-title">
                  <h2>Overview</h2>
                </div>
                </div>
                <div className="panel-heading-actions">
                  <div className="overview-inline-status">
                    {schedulerLaunched && (
                      <div className="overview-count-inline" title={`Orbit run: ${orbitEngineRunId ?? '—'} (${propagationResult?.overpass_blocks?.length ?? 0} propagated) · Filter run: ${filterRunId ?? '—'} (${filteredLinks.length} links) · Session: ${sessionId ?? '—'}`}>
                        <span className="overview-status-label">Overpasses</span>
                        <span className="overview-count-value">{overviewRows.length}</span>
                      </div>
                    )}
                    {schedulerLaunched && (
                      <div className="overview-count-inline">
                        <span className="overview-status-label">Available Links</span>
                        <span className="overview-count-value">{schedulableOverviewRows.length}</span>
                      </div>
                    )}
                  </div>
                  {schedulerLaunched && (
                    <div className="overview-table-visibility-toggle" role="group" aria-label="Overview visibility filter">
                      <button
                        type="button"
                        className={`overview-table-toggle-button ${showUnavailableOverviewRows ? 'overview-table-toggle-button--active' : ''}`}
                        onClick={() => setShowUnavailableOverviewRows(true)}
                        aria-pressed={showUnavailableOverviewRows}
                      >
                        Show all
                      </button>
                      <button
                        type="button"
                        className={`overview-table-toggle-button ${!showUnavailableOverviewRows ? 'overview-table-toggle-button--active' : ''}`}
                        onClick={() => setShowUnavailableOverviewRows(false)}
                        aria-pressed={!showUnavailableOverviewRows}
                      >
                        Show available
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="panel-collapse-toggle"
                    onClick={() => toggleSection('overview')}
                    aria-expanded={expandedSections.overview}
                    aria-controls="overview-panel-content"
                    aria-label={expandedSections.overview ? 'Collapse overview view' : 'Expand overview view'}
                  >
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.overview)}
                    </span>
                  </button>
                </div>
              </div>

              {expandedSections.overview && (
                <div id="overview-panel-content" className="panel-collapsible-content">
                <div className="overview-list">
                {showOverviewProgress ? (
                  renderExtractionProgressPanel()
                ) : (
                  <div className="overview-table-scroll">
                    <div className={`overview-list-header overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                      <span>Link ID</span>
                      <span>Status</span>
                      <span>Overpass ID</span>
                      <span>Sat ID</span>
                      <span>GS ID</span>
                      <span>Start</span>
                      <span>End</span>
                      <span title="Time until the overpass starts (T-minus)">T-</span>
                      <span>Duration</span>
                      <span>Max Elev.</span>
                      {tradeOffsCalculated && <span>Buffer level before</span>}
                      {tradeOffsCalculated && (
                        <span className="overview-header-cell overview-header-cell--tradeoff">
                          <span>Trade-Off<br />ID</span>
                        </span>
                      )}
                      {tradeOffsCalculated && (
                        <span className="overview-header-cell overview-header-cell--score">
                          <span>Score</span>
                        </span>
                      )}
                      {tradeOffsCalculated && <span>Real Data Downlink</span>}
                      {tradeOffsCalculated && (
                        <span className="overview-header-cell overview-header-cell--controls">
                          <span>Controls</span>
                        </span>
                      )}
                      {tradeOffsCalculated && (
                        <span className="overview-header-cell overview-header-cell--schedule">
                          <span>Schedule</span>
                        </span>
                      )}
                    </div>
                    {visibleOverviewRows.length === 0 ? (
                      <>
                        {/* No fabricated sample row here: the table only ever
                            renders links the backend actually returned. */}
                        <p className="overview-list-empty">
                          {overviewRows.length === 0
                            ? 'No candidate links yet. Run the scheduler to propagate orbits and extract overpasses.'
                            : 'No links match the current visibility filter.'}
                        </p>
                      </>
                    ) : (
                      <>
                        {visibleOverviewRows.map((row) => {
                          const rowOption = getOptionForLinkId(row.backendLinkId ?? row.linkId ?? null)
                          const rowStatus = getOverviewRowStatus(row)
                          const rowUnavailable = isOverviewRowUnavailable(row)
                          const rowAvailabilityLabel = getOverviewAvailabilityLabel(row)
                          const rowRejectionReason = row.rejectionReason ?? getScheduleBlockMessage(row)
                          const isRecommendedRow = tradeOffsCalculated && row.isScheduled && row.overrideState === 'auto'
                          const isSelectableRow = tradeOffsCalculated
                            && !rowUnavailable
                            && Boolean(sessionId)
                          const isSelectedRow = isSelectableRow && row.isScheduled
                          const overrideOption = rowOption ?? {
                            tradeOffGroupId: row.backendTradeOffId,
                            optionId: row.backendLinkId,
                            linkId: row.backendLinkId,
                            overpassId: row.overpassId,
                            satId: row.satId,
                            gsId: row.gsId,
                            startTime: row.startTime,
                          }
                          const rowTradeOffBandClass = overviewTradeOffBandByOverpassId.get(row.overpassId) ?? ''

                          return (
                            <div
                              key={row.overpassId}
                              className={`overview-list-row ${rowUnavailable ? 'overview-list-row--blocked' : ''} ${isRecommendedRow ? 'overview-list-row--recommended' : ''} ${isSelectedRow ? 'overview-list-row--selected' : ''} ${rowTradeOffBandClass} ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''} overview-list-grid`}
                            >
                              <span className="overview-linkid-cell">{getOverviewDisplayLinkId(row)}</span>
                              <span
                                className="overview-status-cell"
                                onMouseEnter={rowRejectionReason ? (event) => showWarningTooltip(rowRejectionReason, event) : undefined}
                                onMouseMove={rowRejectionReason ? moveWarningTooltip : undefined}
                                onMouseLeave={rowRejectionReason ? hideWarningTooltip : undefined}
                                onFocus={rowRejectionReason ? (event) => showWarningTooltip(rowRejectionReason, event) : undefined}
                                onBlur={rowRejectionReason ? hideWarningTooltip : undefined}
                              >
                                {isRecommendedRow ? (
                                  <span className="overview-row-note overview-row-note--recommended">
                                    Recommended
                                  </span>
                                ) : rowStatus === 'blocked' || rowStatus === 'ineligible' ? (
                                  <span className="overview-row-note">
                                    {rowAvailabilityLabel}
                                  </span>
                                ) : (
                                  <span className="overview-status-empty">Eligible</span>
                                )}
                              </span>
                              <span className="overview-overpass-cell">
                                <span>{row.overpassId}</span>
                              </span>
                              <span>{row.satId}</span>
                              <span>{row.gsId}</span>
                              <span>{formatOverviewStartDateTime(row.startTime)}</span>
                              <span>{formatOverviewEndDateTime(row.startTime, row.endTime)}</span>
                              <OverpassCountdownCell startTime={row.startTime} endTime={row.endTime} />
                              <span>{row.duration}</span>
                              <span>{row.maxElevation ?? '—'}</span>
                              {tradeOffsCalculated && (
                                <span>{formatBufferLevelGb(bufferLevelBeforeByLinkId.get(row.backendLinkId ?? row.linkId ?? null) ?? row.incomingBufferMb)}</span>
                              )}
                              {tradeOffsCalculated && (
                                rowUnavailable
                                  ? <span className="overview-tradeoff-cell">—</span>
                                  : row.tradeOffId !== '—'
                                  ? (
                                    <span className="overview-tradeoff-cell">
                                      <button
                                        type="button"
                                        className={`overview-tradeoff-button ${markedTimelineLinkId === (row.backendLinkId ?? row.linkId) ? 'overview-tradeoff-button--marked' : ''}`}
                                        onClick={() => handleOverviewTradeOffClick(row)}
                                        aria-pressed={markedTimelineLinkId === (row.backendLinkId ?? row.linkId)}
                                        title={`Show ${row.tradeOffId} and mark link ${row.backendLinkId ?? row.linkId}`}
                                      >
                                        {renderTradeOffPill(row.tradeOffId)}
                                      </button>
                                    </span>
                                  )
                                  : <span className="overview-tradeoff-cell">—</span>
                              )}
                              {tradeOffsCalculated && (
                                <span className="overview-score-cell">
                                  {Number.isFinite(row.score) ? row.score.toFixed(2) : '—'}
                                </span>
                              )}
                              {tradeOffsCalculated && (
                                <span className="overview-offloaded-cell">
                                  {formatDataDownlinkGb(
                                    row.potentialDataDownlinkMb
                                      ?? (() => {
                                        const passCap = getPassCapacityMb(row)
                                        const bufBefore = bufferLevelBeforeByLinkId.get(row.backendLinkId ?? row.linkId ?? null) ?? row.incomingBufferMb
                                        if (Number.isFinite(passCap) && Number.isFinite(bufBefore)) {
                                          return Math.min(passCap, bufBefore)
                                        }
                                        return getBackendDataDownlinkMb(row)
                                      })()
                                  )}
                                </span>
                              )}
                              {tradeOffsCalculated && (
                                <span className="overview-select-cell">
                                  {isSelectableRow ? (
                                    <span className="overview-override-controls" role="group" aria-label={`Override ${getOverviewDisplayLinkId(row)}`}>
                                      {['auto', 'pinned', 'excluded'].map((state) => (
                                        <button
                                          key={state}
                                          type="button"
                                          className={`overview-override-button ${row.overrideState === state ? 'overview-override-button--active' : ''}`}
                                          onClick={() => handleLinkOverride(overrideOption, state)}
                                          disabled={Boolean(overridingLinkId)}
                                          aria-pressed={row.overrideState === state}
                                          title={getOverviewControlTooltip(state)}
                                          onMouseEnter={(event) => showWarningTooltip(getOverviewControlTooltip(state), event)}
                                          onMouseMove={moveWarningTooltip}
                                          onMouseLeave={hideWarningTooltip}
                                          onFocus={(event) => showWarningTooltip(getOverviewControlTooltip(state), event)}
                                          onBlur={hideWarningTooltip}
                                        >
                                          {state === 'auto' ? 'A' : state === 'pinned' ? 'P' : 'X'}
                                        </button>
                                      ))}
                                    </span>
                                  ) : (
                                    <span className="overview-select-empty">—</span>
                                  )}
                                </span>
                              )}
                              {tradeOffsCalculated && (
                                <span className="overview-schedule-state-cell">
                                  {isSelectableRow ? (
                                    <button
                                      type="button"
                                      className={`overview-select-button ${row.isScheduled ? 'overview-select-button--selected' : ''}`}
                                      onClick={() => handleLinkOverride(
                                        overrideOption,
                                        getScheduleToggleState(row.isScheduled),
                                      )}
                                      disabled={Boolean(overridingLinkId)}
                                      aria-pressed={row.isScheduled}
                                      aria-label={row.isScheduled
                                        ? `Scheduled. Click to unschedule ${getOverviewDisplayLinkId(row)}`
                                        : `Unscheduled. Click to schedule ${getOverviewDisplayLinkId(row)}`}
                                      title={getScheduleToggleTitle(row.isScheduled)}
                                    >
                                      {row.isScheduled ? 'Scheduled' : 'Schedule'}
                                    </button>
                                  ) : (
                                    <span className="overview-select-empty">—</span>
                                  )}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
                </div>

                <div className="panel-action-wrapper">
                  <button
                    className="panel-action"
                    disabled={!schedulerLaunched || calculatingTradeOffs || !tradeOffAvailable}
                    onClick={handleCalculateTradeOffs}
                  >
                    {calculatingTradeOffs ? 'Calculating Trade-Offs...' : 'Calculate Trade-Offs'}
                  </button>
                  {!calculatingTradeOffs && (
                    <span className="panel-action-tooltip">
                      {!schedulerLaunched
                        ? 'Finish loading SCOPE and wait for extraction to complete.'
                        : !tradeOffAvailable
                          ? !bufferConfigValid
                            ? 'Enter a valid buffer configuration; initial fill cannot exceed capacity.'
                            : !tradeOffConfigValid
                              ? 'Enter a valid trade-off scoring configuration.'
                            : overviewRows.length > 0
                            ? 'All backend-filtered links are ineligible.'
                            : 'No filtered links are available.'
                          : 'Create a backend scheduling session for the filtered links.'}
                    </span>
                  )}
                </div>
                </div>
              )}
            </section>
  )
})

export default OverviewPanel
