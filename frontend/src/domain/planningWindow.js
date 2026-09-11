// Planning-window arithmetic: the date/time field pair the landing form
// edits, and the presets Reset falls back to.
//
// Pure by construction except where a function reads the wall clock, which
// is always through an injectable argument so tests can pin "now".

import { DEFAULT_PLANNING_TIME_MODE } from '../config/constants.js'

export const padDateTimePart = (value) => String(value).padStart(2, '0')

export const formatPlanningDateFields = (date, timeMode) => {
  const useUtc = timeMode === 'utc'
  const year = useUtc ? date.getUTCFullYear() : date.getFullYear()
  const month = (useUtc ? date.getUTCMonth() : date.getMonth()) + 1
  const day = useUtc ? date.getUTCDate() : date.getDate()
  const hours = useUtc ? date.getUTCHours() : date.getHours()
  const minutes = useUtc ? date.getUTCMinutes() : date.getMinutes()

  return {
    date: `${year}-${padDateTimePart(month)}-${padDateTimePart(day)}`,
    time: `${padDateTimePart(hours)}:${padDateTimePart(minutes)}`,
  }
}

export const parsePlanningDateFields = (dateValue, timeValue, timeMode) => {
  if (!dateValue || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null
  }

  const suffix = timeMode === 'utc' ? 'Z' : ''
  const parsed = new Date(`${dateValue}T${timeValue}:00${suffix}`)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

// The planning window may never begin in the past. A small tolerance keeps a
// window the operator just chose from turning invalid because the wall clock
// advanced a few seconds while they were still typing.
export const PLANNING_PAST_TOLERANCE_MS = 60 * 1000

// Smallest hour boundary strictly after `date`. Adding milliseconds (rather
// than incrementing the hour field) keeps this correct across DST changes.
export const roundUpToNextHour = (date) => {
  const rounded = new Date(date)
  rounded.setMinutes(0, 0, 0)
  while (rounded.getTime() <= date.getTime()) {
    rounded.setTime(rounded.getTime() + 60 * 60000)
  }
  return rounded
}

export const buildPlanningWindowPreset = (timeMode = DEFAULT_PLANNING_TIME_MODE, start = new Date()) => {
  const roundedStart = roundUpToNextHour(start)
  const end = new Date(roundedStart.getTime() + 60 * 60000)
  const startFields = formatPlanningDateFields(roundedStart, timeMode)
  const endFields = formatPlanningDateFields(end, timeMode)

  return {
    startDate: startFields.date,
    startTime: startFields.time,
    endDate: endFields.date,
    endTime: endFields.time,
    startIso: roundedStart.toISOString(),
    endIso: end.toISOString(),
  }
}

// The stored reset preset was built when the workspace was reset and may have
// aged into the past. Fall back to a freshly rounded window so Reset always
// lands on a clean future hour instead of clamping to a ragged "now".
export const resolvePlanningResetDate = (presetIso, timeMode, target) => {
  const presetDate = new Date(presetIso)

  if (presetDate.getTime() >= Date.now()) {
    return presetDate
  }

  const freshPreset = buildPlanningWindowPreset(timeMode)
  return new Date(target === 'start' ? freshPreset.startIso : freshPreset.endIso)
}

export const DEFAULT_PLANNING_WINDOW_PRESET = buildPlanningWindowPreset()
