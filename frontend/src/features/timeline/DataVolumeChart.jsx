import { memo } from 'react'

// One satellite's data budget over the planning window, drawn from the
// backend's buffer profile.
//
// The chart is plotted in a fixed 1000x100 viewBox and stretched by CSS, so
// the polyline maths never has to know the panel's pixel width.
const DataVolumeChart = memo(function DataVolumeChart({
  buildDataVolumePolyline,
  dataVolumeModel,
  dataVolumeYMaxGb,
  formatTimelineDateTime,
  series,
}) {
  return (
    <>
                                {series ? (
                                  <>
                                    {series.payloadWindows.map((payloadWindow) => (
                                      <span
                                        key={`${series.id}-payload-${payloadWindow.id}`}
                                        className="data-volume-payload-window"
                                        style={{
                                          left: `${((payloadWindow.startTimestamp - dataVolumeModel.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                          width: `${((payloadWindow.endTimestamp - payloadWindow.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                        }}
                                        role="img"
                                        aria-label={`Payload data generation from ${formatTimelineDateTime(payloadWindow.startTimestamp)} to ${formatTimelineDateTime(payloadWindow.endTimestamp)}.`}
                                        title={`Payload data generation: ${formatTimelineDateTime(payloadWindow.startTimestamp)} – ${formatTimelineDateTime(payloadWindow.endTimestamp)}`}
                                      ></span>
                                    ))}
                                    <svg
                                      className="data-volume-chart"
                                      viewBox="0 0 1000 100"
                                      preserveAspectRatio="none"
                                      aria-hidden="true"
                                    >
                                      <line
                                        className="data-volume-capacity-line"
                                        x1="0"
                                        x2="1000"
                                        y1={100 - ((series.capacityGb / dataVolumeYMaxGb) * 100)}
                                        y2={100 - ((series.capacityGb / dataVolumeYMaxGb) * 100)}
                                      />
                                      <polyline
                                        className="data-volume-curve"
                                        points={buildDataVolumePolyline(series.points)}
                                      />
                                    </svg>

                                    {series.steps.map((step) => (
                                      <span
                                        key={`${series.id}-${step.id}`}
                                        className="data-volume-step"
                                        style={{
                                          left: `${((step.startTimestamp - dataVolumeModel.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                          width: `${((step.endTimestamp - step.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                        }}
                                        aria-hidden="true"
                                      ></span>
                                    ))}
                                  </>
                                ) : (
                                  <span className="data-volume-inline-empty">
                                    Calculate Trade-Offs to load the backend buffer profile.
                                  </span>
                                )}
    </>
  )
})

export default DataVolumeChart
