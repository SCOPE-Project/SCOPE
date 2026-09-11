import { useEffect, useState } from 'react'

import { DEFAULT_PLANNING_TIME_MODE } from '../config/constants.js'
import {
  DEFAULT_PLANNING_WINDOW_PRESET,
  PLANNING_PAST_TOLERANCE_MS,
  buildPlanningWindowPreset,
  formatPlanningDateFields,
  parsePlanningDateFields,
  resolvePlanningResetDate,
} from '../domain/planningWindow.js'

// The planning window the operator edits on the landing page.
//
// It is held as four text fields (two dates, two times) plus a time mode
// rather than as two Date objects, because that is what the form binds to and
// because a half-typed field must stay representable. Validity and the parsed
// instants are derived here so no consumer re-parses them.
export const usePlanningWindow = () => {
  const [planningTimeMode, setPlanningTimeMode] = useState(DEFAULT_PLANNING_TIME_MODE)
  const [planningWindowStartDate, setPlanningWindowStartDate] = useState(DEFAULT_PLANNING_WINDOW_PRESET.startDate)
  const [planningWindowStartTime, setPlanningWindowStartTime] = useState(DEFAULT_PLANNING_WINDOW_PRESET.startTime)
  const [planningWindowEndDate, setPlanningWindowEndDate] = useState(DEFAULT_PLANNING_WINDOW_PRESET.endDate)
  const [planningWindowEndTime, setPlanningWindowEndTime] = useState(DEFAULT_PLANNING_WINDOW_PRESET.endTime)
  const [planningWindowResetPreset, setPlanningWindowResetPreset] = useState({
    startIso: DEFAULT_PLANNING_WINDOW_PRESET.startIso,
    endIso: DEFAULT_PLANNING_WINDOW_PRESET.endIso,
  })
  // Re-read the wall clock periodically so the earliest selectable date, the
  // time dropdown and the validation message stay correct while the landing
  // page sits open.
  const [planningNowMs, setPlanningNowMs] = useState(() => Date.now())
  const [activeTimeMenu, setActiveTimeMenu] = useState(null)
  useEffect(() => {
    const intervalId = window.setInterval(() => setPlanningNowMs(Date.now()), 30000)
    return () => window.clearInterval(intervalId)
  }, [])
  const planningDateAndTimeToIso = (dateValue, timeValue, timeMode = planningTimeMode) =>
    parsePlanningDateFields(dateValue, timeValue, timeMode)?.toISOString() ?? null

  const setPlanningStartFromDate = (date) => {
    const fields = formatPlanningDateFields(date, planningTimeMode)
    setPlanningWindowStartDate(fields.date)
    setPlanningWindowStartTime(fields.time)
  }

  const setPlanningEndFromDate = (date) => {
    const fields = formatPlanningDateFields(date, planningTimeMode)
    setPlanningWindowEndDate(fields.date)
    setPlanningWindowEndTime(fields.time)
  }

  const handlePlanningTimeModeChange = (nextMode) => {
    if (nextMode === planningTimeMode) {
      return
    }

    const start = parsePlanningDateFields(
      planningWindowStartDate,
      planningWindowStartTime,
      planningTimeMode,
    )
    const end = parsePlanningDateFields(
      planningWindowEndDate,
      planningWindowEndTime,
      planningTimeMode,
    )

    setPlanningTimeMode(nextMode)

    if (start) {
      const startFields = formatPlanningDateFields(start, nextMode)
      setPlanningWindowStartDate(startFields.date)
      setPlanningWindowStartTime(startFields.time)
    }

    if (end) {
      const endFields = formatPlanningDateFields(end, nextMode)
      setPlanningWindowEndDate(endFields.date)
      setPlanningWindowEndTime(endFields.time)
    }
  }

  const handleSetCurrentPlanningTime = (target) => {
    const now = new Date()

    if (target === 'end') {
      setPlanningEndFromDate(now)
      return
    }

    const currentEnd = parsePlanningDateFields(
      planningWindowEndDate,
      planningWindowEndTime,
      planningTimeMode,
    )

    setPlanningStartFromDate(now)

    if (!currentEnd || currentEnd <= now) {
      setPlanningEndFromDate(new Date(now.getTime() + 60 * 60000))
    }
  }

  const handleShiftPlanningTime = (target, offsetMinutes) => {
    const isStart = target === 'start'
    const current = parsePlanningDateFields(
      isStart ? planningWindowStartDate : planningWindowEndDate,
      isStart ? planningWindowStartTime : planningWindowEndTime,
      planningTimeMode,
    ) ?? new Date()
    const shifted = new Date(current.getTime() + offsetMinutes * 60000)

    if (isStart) {
      setPlanningStartFromDate(shifted)
    } else {
      setPlanningEndFromDate(shifted)
    }
  }

  const handleResetPlanningTime = (target) => {
    const presetValue = target === 'start'
      ? planningWindowResetPreset.startIso
      : planningWindowResetPreset.endIso
    const presetDate = resolvePlanningResetDate(presetValue, planningTimeMode, target)

    if (target === 'start') {
      setPlanningStartFromDate(presetDate)
    } else {
      setPlanningEndFromDate(presetDate)
    }
  }
  const planningWindowComplete =
    planningWindowStartDate !== ''
    && planningWindowStartTime !== ''
    && planningWindowEndDate !== ''
    && planningWindowEndTime !== ''
  const planningWindowStartInstant = parsePlanningDateFields(
    planningWindowStartDate,
    planningWindowStartTime,
    planningTimeMode,
  )
  const planningWindowEndInstant = parsePlanningDateFields(
    planningWindowEndDate,
    planningWindowEndTime,
    planningTimeMode,
  )
  const planningEarliestAllowedMs = planningNowMs - PLANNING_PAST_TOLERANCE_MS
  const planningWindowInPast = (
    (planningWindowStartInstant !== null
      && planningWindowStartInstant.getTime() < planningEarliestAllowedMs)
    || (planningWindowEndInstant !== null
      && planningWindowEndInstant.getTime() < planningEarliestAllowedMs)
  )
  const planningWindowValid = Boolean(
    planningWindowComplete
    && planningWindowStartInstant
    && planningWindowEndInstant
    && planningWindowEndInstant > planningWindowStartInstant,
  )
  const resetPlanningWindow = () => {
    const preset = buildPlanningWindowPreset()
    setPlanningTimeMode(DEFAULT_PLANNING_TIME_MODE)
    setPlanningWindowStartDate(preset.startDate)
    setPlanningWindowStartTime(preset.startTime)
    setPlanningWindowEndDate(preset.endDate)
    setPlanningWindowEndTime(preset.endTime)
    setPlanningWindowResetPreset({ startIso: preset.startIso, endIso: preset.endIso })
    setActiveTimeMenu(null)
    return preset
  }

  return {
    planningTimeMode,
    planningWindowStartDate,
    setPlanningWindowStartDate,
    planningWindowStartTime,
    setPlanningWindowStartTime,
    planningWindowEndDate,
    setPlanningWindowEndDate,
    planningWindowEndTime,
    setPlanningWindowEndTime,
    planningNowMs,
    activeTimeMenu,
    setActiveTimeMenu,
    planningDateAndTimeToIso,
    handlePlanningTimeModeChange,
    handleSetCurrentPlanningTime,
    handleShiftPlanningTime,
    handleResetPlanningTime,
    planningWindowComplete,
    planningWindowStartInstant,
    planningWindowEndInstant,
    planningEarliestAllowedMs,
    planningWindowInPast,
    planningWindowValid,
    resetPlanningWindow,
  }
}
