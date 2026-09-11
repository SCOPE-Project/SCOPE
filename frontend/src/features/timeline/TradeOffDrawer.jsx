import { memo } from 'react'

import { useTimeline } from '../workspace/workspaceContext.js'

// The drawer that opens over the timeline when a trade-off is being examined:
// every link the backend considered for that conflict, side by side.
//
// It is draggable, so the operator can move it off whichever bars they want
// to compare it against.
const TradeOffDrawer = memo(function TradeOffDrawer() {
  const {
    activeTimelineTradeOffCard,
    bufferLevelBeforeByLinkId,
    closeTimelineTradeOffView,
    focusTimelineOnOption,
    formatBufferLevelGb,
    formatDataDownlinkGb,
    formatOverviewEndDateTime,
    formatOverviewStartDateTime,
    getBackendDataDownlinkMb,
    getOverviewControlTooltip,
    getPassCapacityMb,
    getScheduleToggleState,
    getScheduleToggleTitle,
    handleLinkOverride,
    handleTimelineTradeOffDrawerPointerDown,
    hideWarningTooltip,
    markedTradeOffOptionId,
    moveWarningTooltip,
    overridingLinkId,
    overviewRowByLinkId,
    renderAssetWarning,
    renderTradeOffPill,
    showWarningTooltip,
    timelineTradeOffDrawerOffset,
    timelineTradeOffDrawerRef,
  } = useTimeline()

  return (
                          <aside
                            ref={timelineTradeOffDrawerRef}
                            className="timeline-tradeoff-drawer"
                            style={{
                              transform: `translate(${timelineTradeOffDrawerOffset.x}px, ${timelineTradeOffDrawerOffset.y}px)`,
                            }}
                          >
                            <div
                              className="timeline-tradeoff-drawer-header"
                              onPointerDown={handleTimelineTradeOffDrawerPointerDown}
                            >
                              <div className="timeline-tradeoff-drawer-titleblock">
                                <span className="timeline-tradeoff-drawer-eyebrow">Trade-Off</span>
                                <h3>{renderTradeOffPill(activeTimelineTradeOffCard.title)}</h3>
                                <p className="timeline-tradeoff-drawer-resource">
                                  {activeTimelineTradeOffCard.resourceLabel}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="timeline-tradeoff-drawer-close"
                                onClick={closeTimelineTradeOffView}
                                aria-label="Close trade-off details"
                              >
                                ×
                              </button>
                            </div>
                            <div className="tradeoff-option-list">
                              {activeTimelineTradeOffCard.options.map((option) => {
                                const optionRow = overviewRowByLinkId.get(option.linkId)
                                const effectiveOverrideState = optionRow?.overrideState ?? option.overrideState
                                const optionScheduled = Boolean(optionRow?.isScheduled ?? option.isScheduled)
                                const optionRecommended = optionScheduled && effectiveOverrideState === 'auto'
                                const displayScore = Number(optionRow?.score ?? option.score ?? 0)

                                const optionMarked = markedTradeOffOptionId === option.optionId

                                return (
                                  <div
                                    key={option.optionId}
                                    data-option-id={option.optionId}
                                    className={[
                                      'tradeoff-option',
                                      optionScheduled ? 'tradeoff-option--selected' : '',
                                      optionMarked ? 'tradeoff-option--marked' : '',
                                      'tradeoff-option--timeline-drawer',
                                    ].filter(Boolean).join(' ')}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={optionMarked}
                                    title={optionMarked ? 'Unmark this pass in the timeline' : 'Mark this pass in the timeline'}
                                    onClick={() => focusTimelineOnOption(option)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        focusTimelineOnOption(option)
                                      }
                                    }}
                                  >
                                    <div className="tradeoff-option-header">
                                      <span className="tradeoff-option-id">{option.linkId ?? option.overpassId}</span>
                                      <div className="tradeoff-meta tradeoff-meta--option">
                                        {optionRecommended && <span className="tradeoff-recommended">Recommended</span>}
                                        <span className="tradeoff-score">Score {displayScore.toFixed(2)}</span>
                                      </div>
                                    </div>

                                    <dl className="tradeoff-option-facts">
                                      <div className="tradeoff-option-fact">
                                        <dt>Satellite</dt>
                                        <dd>{option.satId ?? '—'}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Ground Station</dt>
                                        <dd>{option.gsId ?? '—'}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Start</dt>
                                        <dd>{formatOverviewStartDateTime(option.startTime)}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>End</dt>
                                        <dd>{formatOverviewEndDateTime(option.startTime, option.endTime)}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Duration</dt>
                                        <dd>{option.duration ?? '—'}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Max Elev.</dt>
                                        <dd>{option.maxElevation ?? '—'}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Buffer level before</dt>
                                        <dd>{formatBufferLevelGb(bufferLevelBeforeByLinkId.get(option.linkId) ?? option.incomingBufferMb)}</dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Full pass capacity</dt>
                                        <dd>
                                          <span>{formatDataDownlinkGb(getPassCapacityMb(option))}</span>
                                          {(() => {
                                            const passCapMb = getPassCapacityMb(option)
                                            const bufBeforeMb = bufferLevelBeforeByLinkId.get(option.linkId) ?? option.incomingBufferMb
                                            if (Number.isFinite(passCapMb) && Number.isFinite(bufBeforeMb) && bufBeforeMb < passCapMb) {
                                              return renderAssetWarning("Pass Capacity exceeds Buffer level")
                                            }
                                            return null
                                          })()}
                                        </dd>
                                      </div>
                                      <div className="tradeoff-option-fact">
                                        <dt>Real data downlink</dt>
                                        <dd>
                                          {formatDataDownlinkGb(
                                            option.potentialDataDownlinkMb
                                              ?? (() => {
                                                const passCap = getPassCapacityMb(option)
                                                const bufBefore = bufferLevelBeforeByLinkId.get(option.linkId) ?? option.incomingBufferMb
                                                if (Number.isFinite(passCap) && Number.isFinite(bufBefore)) {
                                                  return Math.min(passCap, bufBefore)
                                                }
                                                return getBackendDataDownlinkMb(option)
                                              })()
                                          )}
                                        </dd>
                                      </div>
                                    </dl>

                                    <div className="tradeoff-option-actions">
                                      <span
                                        className="tradeoff-override-controls"
                                        role="group"
                                        aria-label={`Override ${option.linkId ?? option.overpassId}`}
                                      >
                                        {['auto', 'pinned', 'excluded'].map((state) => (
                                          <button
                                            key={state}
                                            type="button"
                                            className={`tradeoff-override-button ${effectiveOverrideState === state ? 'tradeoff-override-button--active' : ''}`}
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              handleLinkOverride(option, state)
                                            }}
                                            disabled={Boolean(overridingLinkId)}
                                            aria-pressed={effectiveOverrideState === state}
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
                                      <button
                                        type="button"
                                        className="tradeoff-select-button"
                                        onClick={(event) => {
                                          event.stopPropagation()
                                          handleLinkOverride(option, getScheduleToggleState(optionScheduled))
                                        }}
                                        disabled={Boolean(overridingLinkId)}
                                        aria-pressed={optionScheduled}
                                        title={getScheduleToggleTitle(optionScheduled)}
                                      >
                                        {optionScheduled ? 'Scheduled' : 'Schedule'}
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </aside>
  )
})

export default TradeOffDrawer
