// Presentation helpers: timestamps, durations, elevations and data volumes.
//
// Every function here is pure and takes its time mode explicitly. In App.jsx
// four of them defaulted `timeMode` from component state; that default now
// lives in the thin wrappers App keeps, so these stay testable in isolation.

import { DEFAULT_PLANNING_TIME_MODE } from '../config/constants.js'
import { formatPlanningDateFields } from './planningWindow.js'

export const getEventTimestamp = (event) => {
  if (!event) {
    return null
  }

  if (typeof event === 'string') {
    return event
  }

  if (typeof event.timestamp === 'string') {
    return event.timestamp
  }

  return null
}

export const getActivityStartTimestamp = (activity) =>
  getEventTimestamp(activity?.start_event)
  ?? getEventTimestamp(activity?.startEvent)
  ?? activity?.start_timestamp
  ?? activity?.startTimestamp
  ?? null

export const getActivityEndTimestamp = (activity) =>
  getEventTimestamp(activity?.end_event)
  ?? getEventTimestamp(activity?.endEvent)
  ?? activity?.end_timestamp
  ?? activity?.endTimestamp
  ?? null

export const toTimestamp = (value) => {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export const formatDurationFromSeconds = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—'
  }

  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}min ${remainingSeconds}s`
}

export const formatUtcEventDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}, ${hours}:${minutes}:${seconds}`
}

export const getTimeZoneFormatOptions = (timeMode) =>
  timeMode === 'utc' ? { timeZone: 'UTC' } : {}

export const formatOverviewDateLabel = (date, timeMode) =>
  date.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    ...getTimeZoneFormatOptions(timeMode),
  })

export const formatOverviewTimeLabel = (date, timeMode) =>
  date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...getTimeZoneFormatOptions(timeMode),
  })

export const getOverviewDayKey = (date, timeMode) =>
  formatPlanningDateFields(date, timeMode).date

export const getOverviewDayOffset = (startDate, endDate, timeMode) => {
  if (getOverviewDayKey(startDate, timeMode) === getOverviewDayKey(endDate, timeMode)) {
    return 0
  }

  const startDayTimestamp = timeMode === 'utc'
    ? Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
    : new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime()
  const endDayTimestamp = timeMode === 'utc'
    ? Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
    : new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime()

  return Math.max(0, Math.round((endDayTimestamp - startDayTimestamp) / 86400000))
}

export const formatOverviewStartDateTime = (
  value,
  timeMode = DEFAULT_PLANNING_TIME_MODE,
) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    return '—'
  }

  return `${formatOverviewDateLabel(parsed, timeMode)} ${formatOverviewTimeLabel(parsed, timeMode)}`
}

export const formatOverviewEndDateTime = (
  startValue,
  endValue,
  timeMode = DEFAULT_PLANNING_TIME_MODE,
) => {
  if (!startValue || !endValue) {
    return '—'
  }

  const startDate = new Date(startValue)
  const endDate = new Date(endValue)
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return '—'
  }

  const dayOffset = getOverviewDayOffset(startDate, endDate, timeMode)
  const timeLabel = formatOverviewTimeLabel(endDate, timeMode)

  return dayOffset > 0 ? `${timeLabel} +${dayOffset}` : timeLabel
}

export const formatElevation = (value) => {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return `${value.toFixed(1)}°`
}

export const getOverviewRowStatus = (row) => {
  if (row.scheduleBlocked || row.availabilityStatus === 'blocked') {
    return 'blocked'
  }

  if (
    row.isEligible === false
    || row.availabilityStatus === 'filtered'
    || row.availabilityStatus === 'unavailable'
  ) {
    return 'ineligible'
  }

  return 'eligible'
}

export const isUnavailableOverviewRow = (row) => getOverviewRowStatus(row) !== 'eligible'

export const shouldHideOverviewRowInAvailableMode = (row) => getOverviewRowStatus(row) === 'ineligible'

export const getOverviewDisplayLinkId = (row) => {
  if (getOverviewRowStatus(row) === 'ineligible') {
    return '—'
  }

  return row.backendLinkId ?? row.linkId ?? '—'
}

export const formatDataDownlinkGb = (valueMb) => {
  if (!Number.isFinite(valueMb)) {
    return '—'
  }

  return formatGb(valueMb / 1000)
}

// The volume the backend scheduler actually offloads over this link
// (ScheduledLinkStatus.useful_data_offloaded_mb). It is authoritative and is
// never substituted with a locally derived estimate: the backend reports 0.0
// for every link it did not schedule, and presenting the theoretical pass
// capacity instead made unscheduled links look like they carried data.
export const getBackendDataDownlinkMb = (item) => {
  const usefulDataOffloadedMb = Number(item?.usefulDataOffloadedMb)
  return Number.isFinite(usefulDataOffloadedMb) ? usefulDataOffloadedMb : Number.NaN
}

// What the link could carry if it were scheduled and the buffer were full
// (LinkBlock.estimated_data_capacity_mb, produced by the filter pipeline).
// A separate quantity from the offloaded volume - never conflate the two.
export const getPassCapacityMb = (item) => {
  const estimatedDataCapacityMb = Number(item?.estimatedDataCapacityMb)
  return Number.isFinite(estimatedDataCapacityMb) ? estimatedDataCapacityMb : Number.NaN
}

export const formatBufferLevelGb = (valueMb) => {
  if (!Number.isFinite(valueMb)) {
    return '—'
  }

  return formatGb(valueMb / 1000)
}

export const getDayOfYear = (date, timeMode = DEFAULT_PLANNING_TIME_MODE) => {
  const useUtc = timeMode === 'utc'
  const year = useUtc ? date.getUTCFullYear() : date.getFullYear()
  const month = useUtc ? date.getUTCMonth() : date.getMonth()
  const day = useUtc ? date.getUTCDate() : date.getDate()
  const start = Date.UTC(year, 0, 0)
  const current = Date.UTC(year, month, day)
  return Math.floor((current - start) / 86400000)
}

export const formatTimelineHour = (date, timeMode) =>
  date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...getTimeZoneFormatOptions(timeMode),
  })

export const formatTimelineDateTime = (
  value,
  timeMode = DEFAULT_PLANNING_TIME_MODE,
) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    return '—'
  }

  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...getTimeZoneFormatOptions(timeMode),
  })
}

export const formatTimelinePlayheadDateTime = (
  value,
  timeMode = DEFAULT_PLANNING_TIME_MODE,
) => {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    return '—'
  }

  const formatted = parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...getTimeZoneFormatOptions(timeMode),
  })

  return `${formatted} ${timeMode === 'local' ? 'Local' : 'UTC'}`
}

export const formatTimelineDuration = (startValue, endValue) => {
  const startTimestamp = toTimestamp(startValue)
  const endTimestamp = toTimestamp(endValue)

  if (
    startTimestamp === null
    || endTimestamp === null
    || endTimestamp <= startTimestamp
  ) {
    return '—'
  }

  const durationSeconds = (endTimestamp - startTimestamp) / 1000
  return formatDurationFromSeconds(durationSeconds)
}

export const formatTimelineItemDuration = (item) => {
  if (item?.kind === 'link' && Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) {
    return formatDurationFromSeconds(item.durationSeconds)
  }

  return formatTimelineDuration(item?.startTime, item?.endTime)
}

export const formatTimelineDay = (date, timeMode) =>
  `${date.toLocaleDateString([], {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    ...getTimeZoneFormatOptions(timeMode),
  })} (DOY ${getDayOfYear(date, timeMode)})`

export const formatPlanningWindow = (startValue, endValue, timeMode = DEFAULT_PLANNING_TIME_MODE) => {
  const start = startValue ? new Date(startValue) : null
  const end = endValue ? new Date(endValue) : null

  if (
    !start
    || !end
    || !Number.isFinite(start.getTime())
    || !Number.isFinite(end.getTime())
  ) {
    return '—'
  }

  const sameDay = formatPlanningDateFields(start, timeMode).date
    === formatPlanningDateFields(end, timeMode).date

  if (sameDay) {
    return `${start.toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })}, ${start.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })} - ${end.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })}`
  }

  return `${formatTimelineDateTime(startValue, timeMode)} - ${formatTimelineDateTime(endValue, timeMode)}`
}

export const layoutTimelineItems = (items) => {
  const lanes = []

  const positionedItems = [...items]
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .map((item) => {
      let laneIndex = lanes.findIndex((laneEnd) => item.startMinutes >= laneEnd)

      if (laneIndex === -1) {
        laneIndex = lanes.length
        lanes.push(item.startMinutes + item.durationMinutes)
      } else {
        lanes[laneIndex] = item.startMinutes + item.durationMinutes
      }

      return {
        ...item,
        laneIndex,
      }
    })

  return {
    laneCount: Math.max(1, lanes.length),
    items: positionedItems,
  }
}

export const buildDayBands = (baseDate, totalMinutes, timeMode) => {
  const bands = []
  let cursor = new Date(baseDate)
  if (timeMode === 'utc') {
    cursor.setUTCHours(0, 0, 0, 0)
  } else {
    cursor.setHours(0, 0, 0, 0)
  }

  while (bands.length === 0 || cursor < new Date(baseDate.getTime() + totalMinutes * 60000)) {
    const nextDay = new Date(cursor)
    if (timeMode === 'utc') {
      nextDay.setUTCDate(cursor.getUTCDate() + 1)
    } else {
      nextDay.setDate(cursor.getDate() + 1)
    }

    const startMinutes = Math.max(0, (cursor.getTime() - baseDate.getTime()) / 60000)
    const endMinutes = Math.min(totalMinutes, (nextDay.getTime() - baseDate.getTime()) / 60000)

    if (endMinutes > startMinutes) {
      bands.push({
        startMinutes,
        widthMinutes: endMinutes - startMinutes,
        label: formatTimelineDay(cursor, timeMode),
        alt: bands.length % 2 === 1,
      })
    }

    if (endMinutes >= totalMinutes) {
      break
    }

    cursor = nextDay
  }

  return bands
}

export const formatGb = (value) => `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`
