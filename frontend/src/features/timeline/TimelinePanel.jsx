import { memo } from 'react'

import StagingReviewPanel from '../staging/StagingReviewPanel.jsx'
import TimelineControls from './TimelineControls.jsx'
import TimelineTracks from './TimelineTracks.jsx'
import { TimelineContext } from '../workspace/workspaceContext.js'
import { formatPlanningWindow, getDayOfYear } from '../../domain/format.js'

// The Timeline panel: control strip, the track canvas, and the two-stage
// confirmation flow that ends at SatOS.
//
// The panel owns the flow, not the drawing -- TimelineTracks does that, and
// reads its world from TimelineContext, which App assembles.
const TimelinePanel = memo(function TimelinePanel({
  activePlanningWindow,
  allStagingLinksConfirmed,
  commitSummary,
  confirmScheduleAvailable,
  confirmationSuccess,
  confirmationSuccessRef,
  confirmedScheduleCount,
  confirmedStagingLinks,
  confirmingSchedule,
  createdActivitiesCount,
  expandedSections,
  finalScheduleRows,
  getPanelDragClassName,
  getPanelDropZoneProps,
  getPanelHeadingDragProps,
  handleBackToEdit,
  handleCommitToSatOS,
  handleConfirmSchedule,
  handleResetTimelineView,
  handleTimelinePlaybackToggle,
  isScheduleStaged,
  planningWindowEndTimestamp,
  planningWindowStartTimestamp,
  renderPanelDragHandle,
  renderSectionChevron,
  scheduleCommitted,
  scheduleStagingReviewRef,
  schedulerLaunched,
  sessionId,
  setTimelinePlaybackSpeed,
  timelineAssetVisibility,
  timelineContextValue,
  timelineCustomZoomMultiplier,
  timelineLayers,
  timelineModel,
  timelinePanelRef,
  timelinePlaybackSpeed,
  timelinePlaying,
  timelineRenderRows,
  timelineZoomLevel,
  toggleSection,
  toggleStagingAssetConfirmation,
  toggleStagingLinkConfirmation,
  toggleTimelineAssetVisibility,
  toggleTimelineLayer,
  tradeOffsCalculated,
  userName,
}) {
  return (
            <section
              ref={timelinePanelRef}
              className={`panel timeline-panel ${expandedSections.timeline ? '' : 'panel--collapsed'}${getPanelDragClassName('timeline')}`}
              {...getPanelDropZoneProps('timeline')}
            >
              <div
                className={`panel-heading panel-heading--timeline ${expandedSections.timeline ? '' : 'panel-heading--collapsed'}`}
                {...getPanelHeadingDragProps('timeline')}
              >
                <div className="panel-heading-lead">
                  {renderPanelDragHandle('timeline')}
                <div className="panel-heading-title">
                  <h2>Timeline</h2>
                </div>
                </div>
                <div className="panel-heading-actions">
                  {timelineModel && (
                    <div className="timeline-header-meta">
                      <span className="timeline-meta-item">
                        <span className="timeline-meta-label">
                          Planning Window ({activePlanningWindow?.timeMode === 'local' ? 'Local' : 'UTC'})
                        </span>
                        <span className="timeline-meta-value">
                          {formatPlanningWindow(
                            activePlanningWindow?.startTime,
                            activePlanningWindow?.endTime,
                            activePlanningWindow?.timeMode,
                          )}
                        </span>
                      </span>
                      <span className="timeline-meta-item timeline-meta-item--muted">
                        <span className="timeline-meta-label">DOY</span>
                        <span className="timeline-meta-value">
                          {getDayOfYear(timelineModel.baseDate, activePlanningWindow?.timeMode)}
                        </span>
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="panel-collapse-toggle"
                    onClick={() => toggleSection('timeline')}
                    aria-expanded={expandedSections.timeline}
                    aria-controls="timeline-panel-content"
                    aria-label={expandedSections.timeline ? 'Collapse timeline view' : 'Expand timeline view'}
                  >
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.timeline)}
                    </span>
                  </button>
                </div>
              </div>

              {expandedSections.timeline && (
                <div id="timeline-panel-content" className="panel-collapsible-content">
                  {!schedulerLaunched && (
                    <p className="timeline-empty-copy">
                      Launch Communication Scheduler to initialize the planning timeline.
                    </p>
                  )}

                  {schedulerLaunched && timelineModel && (
                    <>
                  <TimelineControls
                    handleResetTimelineView={handleResetTimelineView}
                    handleTimelinePlaybackToggle={handleTimelinePlaybackToggle}
                    planningWindowEndTimestamp={planningWindowEndTimestamp}
                    planningWindowStartTimestamp={planningWindowStartTimestamp}
                    setTimelinePlaybackSpeed={setTimelinePlaybackSpeed}
                    timelineAssetVisibility={timelineAssetVisibility}
                    timelineCustomZoomMultiplier={timelineCustomZoomMultiplier}
                    timelineLayers={timelineLayers}
                    timelinePlaybackSpeed={timelinePlaybackSpeed}
                    timelinePlaying={timelinePlaying}
                    timelineZoomLevel={timelineZoomLevel}
                    toggleTimelineAssetVisibility={toggleTimelineAssetVisibility}
                    toggleTimelineLayer={toggleTimelineLayer}
                  />

                  {timelineRenderRows.length === 0 ? (
                    <p className="timeline-empty-copy">Enable at least one timeline layer and one asset section to display the schedule view.</p>
                  ) : (
                    <TimelineContext.Provider value={timelineContextValue}>
                      <TimelineTracks />
                    </TimelineContext.Provider>
                  )}

                  <div className="timeline-confirmation">
                    <div className="timeline-confirmation-copy">
                      <div className="timeline-confirmation-heading">
                        <span className="timeline-confirmation-title">Confirm Communication Schedule</span>
                      </div>
                      <span className="timeline-confirmation-text">
                        Stage and review the schedule summary before writing activities to SatOS.
                      </span>
                    </div>
                    <div className="timeline-confirmation-actions">
                      <button
                        type="button"
                        className="btn-fetch timeline-confirm-button"
                        disabled={!confirmScheduleAvailable || confirmingSchedule || isScheduleStaged}
                        onClick={handleConfirmSchedule}
                      >
                        {isScheduleStaged ? '✓ Schedule Staged for Review' : 'Confirm Communication Schedule'}
                      </button>
                      {!confirmingSchedule && !confirmScheduleAvailable && (
                        <span className="timeline-confirmation-tooltip">
                          {!schedulerLaunched
                            ? 'Launch Communication Scheduler first.'
                            : !tradeOffsCalculated
                              ? 'Calculate Trade-Offs first so a backend session exists.'
                              : finalScheduleRows.length === 0
                                ? 'The backend session currently contains no scheduled links.'
                                : 'The final schedule is not ready yet.'}
                        </span>
                      )}
                    </div>
                  </div>

                  {isScheduleStaged && finalScheduleRows.length > 0 && (
                    <StagingReviewPanel
                      allStagingLinksConfirmed={allStagingLinksConfirmed}
                      commitSummary={commitSummary}
                      confirmedStagingLinks={confirmedStagingLinks}
                      confirmingSchedule={confirmingSchedule}
                      finalScheduleRows={finalScheduleRows}
                      handleBackToEdit={handleBackToEdit}
                      handleCommitToSatOS={handleCommitToSatOS}
                      scheduleCommitted={scheduleCommitted}
                      scheduleStagingReviewRef={scheduleStagingReviewRef}
                      sessionId={sessionId}
                      toggleStagingAssetConfirmation={toggleStagingAssetConfirmation}
                      toggleStagingLinkConfirmation={toggleStagingLinkConfirmation}
                      userName={userName}
                    />
                  )}

                  {confirmationSuccess && (
                    <div
                      ref={confirmationSuccessRef}
                      className="confirmation-success"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="confirmation-success-icon" aria-hidden="true">✓</span>
                      <div className="confirmation-success-copy">
                        <strong>Success</strong>
                        <span>
                          {confirmedScheduleCount} link{confirmedScheduleCount === 1 ? '' : 's'} committed as {createdActivitiesCount} SatOS activit{createdActivitiesCount === 1 ? 'y' : 'ies'}.
                        </span>
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </div>
              )}
            </section>
  )
})

export default TimelinePanel
