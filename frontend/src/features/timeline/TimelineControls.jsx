import { memo } from 'react'

import {
  TIMELINE_DEFAULT_ZOOM_LEVEL,
  TIMELINE_LAYERS,
  TIMELINE_PLAYBACK_SPEEDS,
} from '../../config/constants.js'

// The timeline's own control strip: layer and asset toggles on the left,
// zoom and playback on the right.
//
// Zoom is either a preset (Fit / Detail) or a continuous multiplier the
// operator reached with Ctrl/Cmd + wheel; the preset buttons read as active
// only while no continuous value is overriding them.
const TimelineControls = memo(function TimelineControls({
  handleResetTimelineView,
  handleTimelinePlaybackToggle,
  planningWindowEndTimestamp,
  planningWindowStartTimestamp,
  setTimelinePlaybackSpeed,
  timelineAssetVisibility,
  timelineCustomZoomMultiplier,
  timelineLayers,
  timelinePlaybackSpeed,
  timelinePlaying,
  timelineZoomLevel,
  toggleTimelineAssetVisibility,
  toggleTimelineLayer,
}) {
  return (
                  <div className="timeline-toolbar">
                    <div className="timeline-toolbar-groups">
                      <div className="timeline-toolbar-row">
                        <div className="timeline-toolbar-side timeline-toolbar-side--left">
                          <div className="timeline-toggle-group" role="group" aria-label="Timeline layers">
                            {TIMELINE_LAYERS.map((layer) => (
                              <button
                                key={layer.id}
                                type="button"
                                className={`timeline-toggle ${timelineLayers[layer.id] ? 'timeline-toggle--active' : ''}`}
                                onClick={() => toggleTimelineLayer(layer.id)}
                                aria-pressed={Boolean(timelineLayers[layer.id])}
                              >
                                {layer.label}
                              </button>
                            ))}
                            {timelineLayers.communication && (
                              <button
                                type="button"
                                className={`timeline-toggle timeline-toggle--sub ${timelineLayers.ineligible ? 'timeline-toggle--active' : ''}`}
                                onClick={() => toggleTimelineLayer('ineligible')}
                                aria-pressed={Boolean(timelineLayers.ineligible)}
                              >
                                Show Ineligible Links
                              </button>
                            )}
                          </div>
                          <div className="timeline-toggle-group timeline-toggle-group--asset" role="group" aria-label="Timeline assets">
                            <button
                              type="button"
                              className={`timeline-toggle ${timelineAssetVisibility.satellites ? 'timeline-toggle--active' : ''}`}
                              onClick={() => toggleTimelineAssetVisibility('satellites')}
                              aria-pressed={timelineAssetVisibility.satellites}
                            >
                              Satellites
                            </button>
                            <button
                              type="button"
                              className={`timeline-toggle ${timelineAssetVisibility.groundStations ? 'timeline-toggle--active' : ''}`}
                              onClick={() => toggleTimelineAssetVisibility('groundStations')}
                              aria-pressed={timelineAssetVisibility.groundStations}
                            >
                              Ground Stations
                            </button>
                          </div>
                        </div>
                        <div className="timeline-toolbar-side timeline-toolbar-side--right">
                          <div className="timeline-toggle-group timeline-toggle-group--playback" role="group" aria-label="Timeline playback">
                            <button
                              type="button"
                              className={`timeline-toggle timeline-play-toggle ${timelinePlaying ? 'timeline-toggle--active' : ''}`}
                              onClick={handleTimelinePlaybackToggle}
                              disabled={planningWindowStartTimestamp === null || planningWindowEndTimestamp === null}
                              aria-pressed={timelinePlaying}
                            >
                              <span className="timeline-play-icon" aria-hidden="true">
                                {timelinePlaying ? '⏸' : '▶'}
                              </span>
                              {timelinePlaying ? 'Pause' : 'Play'}
                            </button>
                            <div className="timeline-speed-control" role="group" aria-label="Playback speed">
                              {TIMELINE_PLAYBACK_SPEEDS.map((speed) => (
                                <button
                                  key={speed}
                                  type="button"
                                  className={`timeline-speed-option ${timelinePlaybackSpeed === speed ? 'timeline-speed-option--active' : ''}`}
                                  onClick={() => setTimelinePlaybackSpeed(speed)}
                                  aria-pressed={timelinePlaybackSpeed === speed}
                                >
                                  {speed}×
                                </button>
                              ))}
                            </div>
                            <div className="timeline-zoom-control">
                              <button
                                type="button"
                                className="timeline-zoom-option timeline-zoom-reset"
                                onClick={handleResetTimelineView}
                                disabled={
                                  timelineZoomLevel === TIMELINE_DEFAULT_ZOOM_LEVEL
                                  && timelineCustomZoomMultiplier === null
                                }
                              >
                                Reset View
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
  )
})

export default TimelineControls
