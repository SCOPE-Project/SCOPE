// The satellite data-budget curves under the timeline.
//
// Curves and KPIs are rendered from the authoritative backend session
// profiles; this module only converts units and positions returned points.
// It never derives a buffer level the backend did not report.

import { toTimestamp } from './format.js'

export const buildDataVolumeModel = ({
  timelineModel,
  sessionPlan,
  expandedTimelineSections,
  expandedTimelineGroups,
  finalScheduleRows,
}) => {
    if (!timelineModel || !sessionPlan) {
      return null
    }

    const startTimestamp = timelineModel.baseDate.getTime()
    const endTimestamp = timelineModel.endDate.getTime()
    const satelliteGroups = expandedTimelineSections.satellites
      ? (timelineModel.sections.find((section) => section.id === 'satellites')?.groups ?? [])
        .filter((group) => expandedTimelineGroups[group.id])
      : []

    const series = satelliteGroups.map((group) => {
      const profile = sessionPlan.satellite_buffer_profiles?.[group.name]
      if (!profile) {
        return null
      }

      const profilePoints = (profile.profile_points ?? []).map((point) => ({
        timestamp: toTimestamp(point.timestamp),
        level: Number(point.level_mb ?? 0) / 1000,
        eventType: point.event_type,
        associatedId: point.associated_id,
      })).filter((point) => point.timestamp !== null)
      const pointsByLinkAndEvent = new Map(
        profilePoints.map((point) => [`${point.associatedId}:${point.eventType}`, point]),
      )
      const payloadWindows = profilePoints
        .filter((point) => point.eventType === 'payload_start' && point.associatedId)
        .map((startPoint) => {
          const endPoint = pointsByLinkAndEvent.get(`${startPoint.associatedId}:payload_end`)
          if (!endPoint) {
            return null
          }

          const visibleStartTimestamp = Math.max(startTimestamp, startPoint.timestamp)
          const visibleEndTimestamp = Math.min(endTimestamp, endPoint.timestamp)
          if (visibleEndTimestamp <= visibleStartTimestamp) {
            return null
          }

          return {
            id: startPoint.associatedId,
            startTimestamp: visibleStartTimestamp,
            endTimestamp: visibleEndTimestamp,
          }
        })
        .filter(Boolean)
      const downlinkRateMbps = sessionPlan.satellite_configs?.[group.name]?.downlink_rate_mbps ?? 0
      const steps = finalScheduleRows
        .filter((row) => row.satId === group.name)
        .map((row) => {
          const startPoint = pointsByLinkAndEvent.get(`${row.backendLinkId}:downlink_start`)
          const endPoint = pointsByLinkAndEvent.get(`${row.backendLinkId}:downlink_end`)
          return {
            id: row.backendLinkId,
            label: row.overpassId,
            gsId: row.gsId,
            maxElevation: row.maxElevation,
            startTimestamp: toTimestamp(row.startTime),
            endTimestamp: toTimestamp(row.endTime),
            downlinkMbps: downlinkRateMbps,
            transferredGb: Number(row.usefulDataOffloadedMb ?? 0) / 1000,
            levelBefore: startPoint?.level ?? 0,
            levelAfter: endPoint?.level ?? 0,
          }
        })
        .filter((step) => step.startTimestamp !== null && step.endTimestamp !== null)

      return {
        id: group.id,
        name: group.name,
        capacityGb: Number(profile.capacity_mb ?? 0) / 1000,
        points: profilePoints,
        payloadWindows,
        steps,
        overflowed: (profile.overflow_events ?? []).length > 0,
        totalGeneratedGb: Number(profile.total_generated_mb ?? 0) / 1000,
        totalDownlinkedGb: Number(profile.total_downlinked_mb ?? 0) / 1000,
        totalLostGb: Number(profile.total_lost_mb ?? 0) / 1000,
        finalLevelGb: Number(profile.final_level_mb ?? 0) / 1000,
        peakLevelGb: Number(profile.peak_level_mb ?? 0) / 1000,
      }
    }).filter(Boolean)

    return {
      startTimestamp,
      endTimestamp,
      durationMs: Math.max(1, endTimestamp - startTimestamp),
      capacityGb: Math.max(1, ...series.map((item) => item.capacityGb)),
      series,
      expandedSatelliteCount: satelliteGroups.length,
    }
}

// Maps profile points into the chart's 1000x100 viewBox. The scale arrives
// explicitly rather than being read from a surrounding scope, so the same
// points can be plotted against a different y-axis without a second function.
export const buildDataVolumePolyline = (points, scale) => {
  if (!scale || points.length === 0) {
    return ''
  }

  const { startTimestamp, durationMs, yMaxGb } = scale

  return points
    .map((point) => {
      const x = ((point.timestamp - startTimestamp) / durationMs) * 1000
      const y = 100 - ((point.level / yMaxGb) * 100)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
