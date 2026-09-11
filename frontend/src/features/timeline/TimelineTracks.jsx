import { memo } from 'react'

import DataVolumeChart from './DataVolumeChart.jsx'
import TradeOffDrawer from './TradeOffDrawer.jsx'
import { useTimeline } from '../workspace/workspaceContext.js'

// The timeline canvas: the ruler, the asset/counterpart track rows, the
// playhead, and the trade-off drawer that opens over them.
//
// Rows are asset-centric, so every link appears TWICE -- once under its
// satellite and once under its ground station. Both instances share a linkId,
// which is what lets marking one mark the other.
//
// This reads its world from TimelineContext rather than taking sixty props:
// the surface is genuinely that wide, and naming it once in the provider is
// more honest than threading it through a call site nobody can read.
const TimelineTracks = memo(function TimelineTracks() {
  const {
    activeTimelineTradeOffCard,
    buildDataVolumePolyline,
    dataVolumeModel,
    dataVolumeYMaxGb,
    expandedTimelineGroups,
    expandedTimelineSections,
    formatGb,
    formatTimelineDateTime,
    formatTimelinePlayheadDateTime,
    getTimelineRowHeight,
    handleTimelineBackgroundClick,
    handleTimelineKeyDown,
    handleTimelinePlayheadKeyDown,
    handleTimelinePlayheadPointerDown,
    handleTimelinePlayheadPointerMove,
    handleTimelinePlayheadPointerUp,
    markedTimelineLinkId,
    pauseTimelineLiveMode,
    planningWindowEndTimestamp,
    planningWindowStartTimestamp,
    renderSectionChevron,
    renderTimelineBar,
    timelineIsFit,
    timelineModel,
    timelinePlayheadCanvasRatio,
    timelinePlayheadSliderRef,
    timelinePlayheadTimestamp,
    timelineRenderRows,
    timelineScrollFrameRef,
    timelineScrollRef,
    timelineWheelHintRef,
    timelineWidthPx,
    toggleTimelineGroup,
    toggleTimelineSection,
    visibleTimelineTicks,
  } = useTimeline()

  return (
                    <div
                      className="timeline-layout"
                      onClick={handleTimelineBackgroundClick}
                    >
                      <div className="timeline-label-column">
                        <div className="timeline-label-cell timeline-label-cell--day"></div>
                        <div className="timeline-label-cell timeline-label-cell--axis"></div>
                        {timelineRenderRows.map((renderRow) => {
                          const rowStyle = {
                            '--timeline-row-height': getTimelineRowHeight(renderRow),
                          }

                          if (renderRow.type === 'section') {
                            const sectionExpanded = Boolean(
                              expandedTimelineSections[renderRow.section.id],
                            )

                            return (
                              <div
                                key={`${renderRow.key}-label`}
                                className="timeline-label-cell timeline-label-cell--section"
                                style={rowStyle}
                              >
                                <button
                                  type="button"
                                  className="timeline-section-toggle"
                                  onClick={() => toggleTimelineSection(renderRow.section.id)}
                                  aria-expanded={sectionExpanded}
                                  aria-label={`${sectionExpanded ? 'Collapse' : 'Expand'} ${renderRow.label}`}
                                >
                                  <span className="timeline-group-chevron" aria-hidden="true">
                                    {renderSectionChevron(sectionExpanded)}
                                  </span>
                                  <span className="timeline-section-name">{renderRow.label}</span>
                                  <span className="timeline-section-count">
                                    {renderRow.section.groups.length}
                                  </span>
                                </button>
                              </div>
                            )
                          }

                          if (renderRow.type === 'group') {
                            const groupExpanded = Boolean(expandedTimelineGroups[renderRow.group.id])
                            const groupMarked = renderRow.group.rows.some((row) => (
                              row.items.some((item) => item.linkId === markedTimelineLinkId)
                            ))
                            const groupSelected = renderRow.group.rows.some((row) => (
                              row.items.some((item) => item.variant === 'selected')
                            ))

                            return (
                              <div
                                key={`${renderRow.key}-label`}
                                className={`timeline-label-cell timeline-label-cell--group ${groupExpanded ? 'timeline-label-cell--group-open' : ''} ${groupMarked ? 'timeline-label-cell--marked' : ''} ${groupSelected ? 'timeline-label-cell--selected' : ''}`}
                                style={rowStyle}
                              >
                                <button
                                  type="button"
                                  className="timeline-group-toggle"
                                  onClick={() => toggleTimelineGroup(renderRow.group.id)}
                                  aria-expanded={groupExpanded}
                                  aria-label={`${groupExpanded ? 'Collapse' : 'Expand'} ${renderRow.group.label}`}
                                >
                                  <span className="timeline-group-chevron" aria-hidden="true">
                                    {renderSectionChevron(groupExpanded)}
                                  </span>
                                  <span className="timeline-group-name">{renderRow.group.label}</span>
                                  {renderRow.group.linkCount > 0 && (
                                    <span className="timeline-group-count">
                                      {renderRow.group.linkCount}
                                    </span>
                                  )}
                                </button>
                              </div>
                            )
                          }

                          if (renderRow.type === 'dataVolume') {
                            const { series } = renderRow

                            return (
                              <div
                                key={`${renderRow.key}-label`}
                                className="timeline-label-cell timeline-label-cell--data-volume"
                                style={rowStyle}
                              >
                                <span className="timeline-data-volume-title">Data Volume</span>
                                {series ? (
                                  <>
                                    <span className="data-volume-axis-label">
                                      {formatGb(series.capacityGb)} capacity · {formatGb(series.totalDownlinkedGb)} downlinked
                                    </span>
                                    <span className="data-volume-flags">
                                      {series.overflowed && (
                                        <span className="data-volume-flag data-volume-flag--overflow">Buffer full</span>
                                      )}
                                      {series.totalLostGb > 0 && (
                                        <span className="data-volume-flag data-volume-flag--overflow">
                                          {formatGb(series.totalLostGb)} lost
                                        </span>
                                      )}
                                    </span>
                                  </>
                                ) : (
                                  <span className="data-volume-axis-label">Available after Calculate Trade-Offs</span>
                                )}
                              </div>
                            )
                          }

                          const linkRowMarked = renderRow.row.items.some((item) => item.linkId === markedTimelineLinkId)
                          const linkRowSelected = renderRow.row.items.some((item) => item.variant === 'selected')

                          return (
                            <div
                              key={`${renderRow.key}-label`}
                              className={`timeline-label-cell timeline-label-cell--link ${linkRowMarked ? 'timeline-label-cell--marked' : ''} ${linkRowSelected ? 'timeline-label-cell--selected' : ''}`}
                              style={rowStyle}
                            >
                              <span className="timeline-link-name">{renderRow.row.counterpartName}</span>
                            </div>
                          )
                        })}
                      </div>

                      <div className={`timeline-main-stage ${activeTimelineTradeOffCard ? 'timeline-main-stage--with-tradeoff' : ''}`}>
                      <div ref={timelineScrollFrameRef} className="timeline-scroll-frame">
                        <span
                          ref={timelineWheelHintRef}
                          className="timeline-wheel-hint"
                          aria-hidden="true"
                        >
                          Hold Ctrl (⌘ on Mac) + scroll to zoom the timeline
                        </span>
                        {timelinePlayheadCanvasRatio !== null
                          && timelinePlayheadCanvasRatio >= 0
                          && timelinePlayheadCanvasRatio <= 1 && (
                          <div
                            ref={timelinePlayheadSliderRef}
                            className="timeline-playhead-slider"
                            data-timeline-playhead
                            role="slider"
                            tabIndex="0"
                            aria-label="Current time shown on the map"
                            aria-valuemin={planningWindowStartTimestamp ?? undefined}
                            aria-valuemax={planningWindowEndTimestamp ?? undefined}
                            aria-valuenow={timelinePlayheadTimestamp}
                            aria-valuetext={formatTimelinePlayheadDateTime(timelinePlayheadTimestamp)}
                            onPointerDown={handleTimelinePlayheadPointerDown}
                            onPointerMove={handleTimelinePlayheadPointerMove}
                            onPointerUp={handleTimelinePlayheadPointerUp}
                            onPointerCancel={handleTimelinePlayheadPointerUp}
                            onKeyDown={handleTimelinePlayheadKeyDown}
                          >
                            <span className="timeline-playhead-handle" aria-hidden="true"></span>
                            <span className="timeline-playhead-label">
                              <span data-playback-label>
                                {formatTimelinePlayheadDateTime(timelinePlayheadTimestamp)}
                              </span>
                            </span>
                          </div>
                        )}
                        <div
                          ref={timelineScrollRef}
                          className={`timeline-scroll ${timelineIsFit ? 'timeline-scroll--fit' : ''}`}
                          tabIndex="0"
                          role="region"
                          aria-label="Interactive planning timeline"
                          onPointerDown={pauseTimelineLiveMode}
                          onTouchStart={pauseTimelineLiveMode}
                          onKeyDown={handleTimelineKeyDown}
                        >
                          <div
                            className={`timeline-time-canvas ${timelineIsFit ? 'timeline-time-canvas--fit' : ''}`}
                            style={{
                              width: `${timelineWidthPx}px`,
                              '--timeline-hour-width': `${(60 / timelineModel.totalMinutes) * 100}%`,
                              '--timeline-major-width': `${(120 / timelineModel.totalMinutes) * 100}%`,
                            }}
                          >
                        <div className="timeline-content-plane">
                        <div className="timeline-day-row">
                          <div
                            className="timeline-scenario-edge timeline-scenario-edge--start"
                            style={{ left: 0 }}
                          >
                            <span>Scenario Start</span>
                          </div>
                          <div
                            className="timeline-scenario-edge timeline-scenario-edge--end"
                            style={{ right: 0 }}
                          >
                            <span>Scenario End</span>
                          </div>
                          {timelineModel.dayBands.map((band, index) => (
                            <div
                              key={`${band.label}-${index}`}
                              className={`timeline-day-band ${band.alt ? 'timeline-day-band--alt' : ''}`}
                              style={{
                                left: `${(band.startMinutes / timelineModel.totalMinutes) * 100}%`,
                                width: `${(band.widthMinutes / timelineModel.totalMinutes) * 100}%`,
                              }}
                            >
                              {band.label}
                            </div>
                          ))}
                        </div>

                        <div className="timeline-axis-row">
                          {visibleTimelineTicks.map((tick) => (
                            <div
                              key={tick.offsetMinutes}
                              className={`timeline-axis-marker ${tick.offsetMinutes % 120 === 0 ? 'timeline-axis-marker--major' : ''}`}
                              style={{ left: `${(tick.offsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                            >
                              <span>{tick.label}</span>
                            </div>
                          ))}
                        </div>

                        <div className="timeline-grid-backdrop" aria-hidden="true"></div>

                        {timelineRenderRows.map((renderRow) => {
                          const rowStyle = {
                            '--timeline-row-height': getTimelineRowHeight(renderRow),
                          }

                          if (renderRow.type === 'section') {
                            return (
                              <div
                                key={`${renderRow.key}-row`}
                                className="timeline-track-row timeline-track-row--section"
                                style={rowStyle}
                              ></div>
                            )
                          }

                          if (renderRow.type === 'dataVolume') {
                            const { series } = renderRow

                            return (
                              <div
                                key={`${renderRow.key}-row`}
                                className="timeline-track-row timeline-track-row--data-volume data-volume-row"
                                style={rowStyle}
                              >
                                <DataVolumeChart
                                  series={series}
                                  dataVolumeModel={dataVolumeModel}
                                  dataVolumeYMaxGb={dataVolumeYMaxGb}
                                  buildDataVolumePolyline={buildDataVolumePolyline}
                                  formatTimelineDateTime={formatTimelineDateTime}
                                />
                              </div>
                            )
                          }

                          const rowItems = renderRow.type === 'group'
                            ? renderRow.group.items
                            : renderRow.row.items
                          const rowMarked = rowItems.some((item) => item.linkId === markedTimelineLinkId)
                          const rowSelected = rowItems.some((item) => item.variant === 'selected')

                          return (
                            <div
                              key={`${renderRow.key}-row`}
                              className={`timeline-track-row timeline-track-row--${renderRow.type} ${rowMarked ? 'timeline-track-row--marked' : ''} ${rowSelected ? 'timeline-track-row--selected' : ''}`}
                              style={rowStyle}
                            >
                              {rowItems.map((item) => renderTimelineBar(item, renderRow.type))}
                            </div>
                          )
                        })}
                          </div>
                        </div>
                      </div>
                      </div>
                      {activeTimelineTradeOffCard && <TradeOffDrawer />}
                    </div>
                    </div>
  )
})

export default TimelineTracks
