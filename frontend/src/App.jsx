import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  interpolateTrackPosition,
  prepareTrackPoints,
} from './components/mapGeometry.js'
import {
  applySessionOverride,
  clearScopeActivities,
  commitSession,
  initializeAssets,
  pollTaskResult as pollBackendTaskResult,
  startLinkFiltering,
  startOrbitExtraction,
  startTradeOffProcessing,
} from './api/scopeApi.js'
import {
  applySessionPlanToRows,
  buildCurrentScheduleItems,
  buildCommitSummary,
  buildRowsFromFilteredLinks,
  buildSelectedOptionsFromPlan,
  buildTradeOffCardsFromPlan,
  getScheduledRows,
} from './domain/schedulingModel.js'
import {
  DEFAULT_DATA_CAPACITY_GB,
  DEFAULT_DATA_GENERATION_MBPS,
  DEFAULT_DATA_START_FILL_GB,
  DEFAULT_DOWNLINK_RATE_MBPS,
  DEFAULT_SCORING_ALPHA,
  DEFAULT_SCORING_EXPONENT,
  DEFAULT_TRADE_OFF_STRATEGY,
  TRADE_OFF_STRATEGIES,
} from './config/constants.js'
import {
  formatBufferLevelGb,
  formatDataDownlinkGb,
  formatDurationFromSeconds,
  formatElevation,
  formatGb,
  formatOverviewEndDateTime as formatOverviewEndDateTimeIn,
  formatOverviewStartDateTime as formatOverviewStartDateTimeIn,
  formatTimelineDateTime as formatTimelineDateTimeIn,
  formatTimelineItemDuration,
  formatTimelinePlayheadDateTime as formatTimelinePlayheadDateTimeIn,
  getBackendDataDownlinkMb,
  getOverviewRowStatus,
  getPassCapacityMb,
  isUnavailableOverviewRow,
  shouldHideOverviewRowInAvailableMode,
  toTimestamp,
} from './domain/format.js'
import {
  getOverviewControlTooltip,
  getScheduleToggleState,
  getScheduleToggleTitle,
} from './domain/assets.js'
import AppHeader from './features/workspace/AppHeader.jsx'
import AssetPicker from './features/landing/AssetPicker.jsx'
import PanelDragHandle from './features/workspace/PanelDragHandle.jsx'
import TimelineTooltip from './features/timeline/TimelineTooltip.jsx'
import LandingPage from './features/landing/LandingPage.jsx'
import WorkspaceLayout from './features/workspace/WorkspaceLayout.jsx'
import AssetWarning from './components/AssetWarning.jsx'
import BufferConfig from './features/landing/BufferConfig.jsx'
import GroundStationOptions from './features/landing/GroundStationOptions.jsx'
import PlanningWindowForm from './features/landing/PlanningWindowForm.jsx'
import SatelliteOptions from './features/landing/SatelliteOptions.jsx'
import SectionChevron from './components/SectionChevron.jsx'
import TradeOffPill from './components/TradeOffPill.jsx'
import UnavailableAssets from './features/landing/UnavailableAssets.jsx'
import PlanningTimeActions from './features/landing/PlanningTimeActions.jsx'
import TimeInput from './components/TimeInput.jsx'
import ExtractionProgress from './features/landing/ExtractionProgress.jsx'
import LinkFilters from './features/landing/LinkFilters.jsx'
import TradeOffConfig from './features/landing/TradeOffConfig.jsx'
import MapPanel from './features/map/MapPanel.jsx'
import OverviewPanel from './features/overview/OverviewPanel.jsx'
import TimelinePanel from './features/timeline/TimelinePanel.jsx'
import { usePanelLayout } from './state/usePanelLayout.js'
import { STAGE_PROGRESS_SPAN, useSchedulerRun } from './state/useSchedulerRun.js'
import { useSchedulerConfig } from './state/useSchedulerConfig.js'
import { useMapView } from './state/useMapView.js'
import { useStagingReview } from './state/useStagingReview.js'
import { usePlanningWindow } from './state/usePlanningWindow.js'
import { useSessionPlan } from './state/useSessionPlan.js'
import { useTimelineGeometry } from './state/useTimelineGeometry.js'
import { useMissionAssets } from './state/useMissionAssets.js'


let extractionMessageSequence = 0

// Ids for the extraction log. A monotonic counter rather than Date.now():
// the timestamp is an impure read the React compiler cannot memoize around,
// and two messages pushed inside the same millisecond would collide as keys.
const nextExtractionMessageId = (prefix) => {
  extractionMessageSequence += 1
  return `${prefix}-${extractionMessageSequence}`
}

export default function App() {
  const missionMapRef = useRef(null)
  const visibleMapAssetListRef = useRef(null)
  const tradeOffCardListRef = useRef(null)
  const timelinePanelRef = useRef(null)
  const scheduleStagingReviewRef = useRef(null)
  const confirmationSuccessRef = useRef(null)
  const schedulerAbortControllerRef = useRef(null)
  const [error, setError] = useState(null)
  // fetchAssets resets the workspace, but resetWorkspaceState is defined
  // further down and closes over most of this component. The ref lets the
  // hook call the latest version without depending on its identity.
  const resetWorkspaceStateRef = useRef(null)
  const [view, setView] = useState('landing')
  const {
    assets,
    assetSchedules,
    setAssetSchedules,
    assetsCached,
    loading,
    backendAlive,
    satosAlive,
    selectedSatellites,
    setSelectedSatellites,
    selectedGroundStations,
    setSelectedGroundStations,
    setAssets,
    toggleSatellite,
    toggleGroundStation,
    satelliteAssets,
    groundStationAssets,
    unavailableAssets,
    missionAssetsLoaded,
    fetchAssets,
  } = useMissionAssets({
    view,
    onWorkspaceReset: () => resetWorkspaceStateRef.current?.(),
    onError: setError,
  })
  const [userName, setUserName] = useState('')
  const {
    minimumLinkElevationFilterDeg,
    setMinimumLinkElevationFilterDeg,
    minimumPeakElevationFilterDeg,
    setMinimumPeakElevationFilterDeg,
    minimumLinkElevationFilterValue,
    minimumPeakElevationFilterValue,
    linkFiltersValid,
    dataStartFillGb,
    setDataStartFillGb,
    dataGenerationMbps,
    setDataGenerationMbps,
    dataCapacityGb,
    setDataCapacityGb,
    dataDownlinkRateMbps,
    setDataDownlinkRateMbps,
    tradeOffStrategy,
    setTradeOffStrategy,
    scoringAlpha,
    setScoringAlpha,
    scoringExponent,
    setScoringExponent,
    clearExistingScopeActivities,
    setClearExistingScopeActivities,
    resetSchedulerConfig,
  } = useSchedulerConfig()
  const {
    activeMapAssetId,
    setActiveMapAssetId,
    showGroundStationVisibilityCircles,
    setShowGroundStationVisibilityCircles,
    showSatelliteVisibilityCircles,
    setShowSatelliteVisibilityCircles,
    showGroundTracks,
    setShowGroundTracks,
    groundTrackWindowHours,
    setGroundTrackWindowHours,
    resetMapView,
  } = useMapView()
  const {
    planningTimeMode,
    planningWindowStartDate,
    setPlanningWindowStartDate,
    planningWindowStartTime,
    setPlanningWindowStartTime,
    planningWindowEndDate,
    setPlanningWindowEndDate,
    planningWindowEndTime,
    setPlanningWindowEndTime,
    activeTimeMenu,
    setActiveTimeMenu,
    planningDateAndTimeToIso,
    handlePlanningTimeModeChange,
    handleSetCurrentPlanningTime,
    handleShiftPlanningTime,
    handleResetPlanningTime,
    planningWindowComplete,
    planningWindowInPast,
    planningWindowValid,
    resetPlanningWindow,
  } = usePlanningWindow()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const {
    progress: extractionProgress,
    statusLabel: extractionStatus,
    messages: extractionMessages,
    launchingScheduler,
    calculatingTradeOffs,
    schedulerLaunched,
    tradeOffsCalculated,
    dispatch: dispatchScheduler,
    reset: resetSchedulerRun,
  } = useSchedulerRun()
  const {
    satelliteTracks,
    setSatelliteTracks,
    orbitEngineRunId,
    setOrbitEngineRunId,
    propagationResult,
    setPropagationResult,
    propagationRequestKey,
    setPropagationRequestKey,
    filterRunId,
    setFilterRunId,
    filteredLinks,
    setFilteredLinks,
    overviewRows,
    setOverviewRows,
    sessionId,
    setSessionId,
    sessionPlan,
    setSessionPlan,
    tradeOffCards,
    setTradeOffCards,
    activeTradeOffCardIndex,
    setActiveTradeOffCardIndex,
    selectedTradeOffOption,
    setSelectedTradeOffOption,
    overridingLinkId,
    setOverridingLinkId,
    clearSession,
    clearPropagation,
    resetSessionPlan,
  } = useSessionPlan()
  const [showUnavailableOverviewRows, setShowUnavailableOverviewRows] = useState(true)
  const [timelineTradeOffViewId, setTimelineTradeOffViewId] = useState(null)
  const [timelineTradeOffDrawerOffset, setTimelineTradeOffDrawerOffset] = useState({ x: 0, y: 0 })
  const [warningTooltip, setWarningTooltip] = useState({
    visible: false,
    message: '',
    x: 0,
    y: 0,
  })

  const {
    confirmingSchedule,
    setConfirmingSchedule,
    confirmationProgress,
    setConfirmationProgress,
    confirmationStep,
    setConfirmationStep,
    isScheduleStaged,
    confirmedStagingLinks,
    setConfirmationSuccess,
    confirmationSuccess,
    scheduleCommitted,
    setScheduleCommitted,
    confirmedScheduleCount,
    setConfirmedScheduleCount,
    createdActivitiesCount,
    setCreatedActivitiesCount,
    toggleStagingLinkConfirmation,
    toggleStagingAssetConfirmation,
    areAllLinksConfirmed,
    resetStagingReview,
    enterStagingReview,
    leaveStagingReview,
  } = useStagingReview()
  const [activePlanningWindow, setActivePlanningWindow] = useState(null)
  const [expandedSections, setExpandedSections] = useState({
    timeWindow: true,
    satellites: true,
    groundStations: true,
    unavailableAssets: false,
    linkFilters: true,
    bufferConfig: true,
    tradeOffConfig: true,
    mapView: true,
    overview: true,
    timeline: true,
  })

  const {
    splitPanelsRef,
    overviewPanelWidth,
    panelSlotAssignment,
    bottomTopHeightPx,
    topPanelsHeightPx,
    mapViewHeightPx,
    handlePanelResizeStart,
    handlePanelResizeKeyDown,
    handlePlanningRowResizeStart,
    handlePlanningRowResizeKeyDown,
    handleTopPanelsResizeStart,
    handleTopPanelsResizeKeyDown,
    handlePanelDragStart,
    handlePanelDragEnd,
    getPanelDropZoneProps,
    getPanelDragClassName,
    getPanelHeadingDragProps,
  } = usePanelLayout({ expandedSections, missionMapRef })

  const preparedSatelliteTracks = useMemo(() => Object.fromEntries(
    Object.entries(satelliteTracks).map(([assetName, points]) => [
      assetName,
      prepareTrackPoints(points),
    ]),
  ), [satelliteTracks])

  useEffect(() => {
    const isNumberInput = (target) => (
      target instanceof HTMLInputElement && target.type === 'number'
    )
    const preventNumberInputStepping = (event) => {
      if (isNumberInput(event.target) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
      }
    }
    const preventNumberInputWheel = (event) => {
      if (isNumberInput(event.target) && document.activeElement === event.target) {
        event.preventDefault()
      }
    }

    document.addEventListener('keydown', preventNumberInputStepping, true)
    document.addEventListener('wheel', preventNumberInputWheel, { capture: true, passive: false })
    return () => {
      document.removeEventListener('keydown', preventNumberInputStepping, true)
      document.removeEventListener('wheel', preventNumberInputWheel, true)
    }
  }, [])

  // Any change to the schedule invalidates every staging sign-off: a
  // confirmation always refers to one specific version of the plan.
  //
  // resetStagingReview is deliberately NOT a dependency. It is redefined on
  // every render, so including it would re-run this effect continuously and
  // wipe the staging state the moment the operator entered it.
  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      resetStagingReview()
    })
    return () => window.cancelAnimationFrame(animationFrameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTradeOffOption, tradeOffsCalculated, schedulerLaunched])

  const toggleSection = (section) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const toggleTimelineLayer = (layer) => {
    setTimelineLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }))
  }

  const formatTaskStatusLabel = (status) => {
    switch (status) {
      case 'queued':
        return 'Queued'
      case 'processing':
        return 'Running'
      case 'completed':
        return 'Completed'
      case 'failed':
        return 'Failed'
      default:
        return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : 'Running'
    }
  }

  const appendTaskStatus = (taskStatus, stageLabel, progressStart = 0, progressSpan = 100) => {
    const taskProgress = Number.isFinite(taskStatus.progress) ? taskStatus.progress : 0
    dispatchScheduler({
      type: 'progressReported',
      statusLabel: `${stageLabel}: ${formatTaskStatusLabel(taskStatus.status)}`,
      progress: Math.round(progressStart + (taskProgress / 100) * progressSpan),
    })

    if (taskStatus.message) {
      // The reducer drops a repeat of the previous line, so a stage that
      // polls for a minute does not print the same message sixty times.
      dispatchScheduler({
        type: 'messageAppended',
        message: {
          id: nextExtractionMessageId(`${stageLabel}-${taskStatus.status}-${taskStatus.progress ?? 0}`),
          text: `${stageLabel}: ${taskStatus.message}`,
        },
      })
    }
  }

  // The time mode the operator is actually looking at: the window the
  // scheduler ran with once one exists, otherwise the landing form's setting.
  // These four formatters defaulted to it before they moved to domain/format.js.
  const displayTimeMode = activePlanningWindow?.timeMode ?? planningTimeMode
  const formatOverviewStartDateTime = (value, timeMode = displayTimeMode) =>
    formatOverviewStartDateTimeIn(value, timeMode)
  const formatOverviewEndDateTime = (startValue, endValue, timeMode = displayTimeMode) =>
    formatOverviewEndDateTimeIn(startValue, endValue, timeMode)
  const formatTimelineDateTime = (value, timeMode = displayTimeMode) =>
    formatTimelineDateTimeIn(value, timeMode)
  const formatTimelinePlayheadDateTime = (value, timeMode = displayTimeMode) =>
    formatTimelinePlayheadDateTimeIn(value, timeMode)

  const formatFilteredRows = (links) => buildRowsFromFilteredLinks(links).map((row) => ({
    ...row,
    duration: formatDurationFromSeconds(row.durationSeconds),
    maxElevation: formatElevation(row.maxElevationDeg),
    tradeOffColorIndex: null,
  }))

  const handleLaunchScheduler = async () => {
    if (!launchRequirementsMet || backendAlive !== true) return false

    const planningWindow = {
      startTime: planningDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime),
      endTime: planningDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime),
      timeMode: planningTimeMode,
    }

    if (!planningWindow.startTime || !planningWindow.endTime) {
      setError('Enter a valid planning window before launching the scheduler.')
      return false
    }

    if (new Date(planningWindow.endTime) <= new Date(planningWindow.startTime)) {
      setError('The planning window end must be after the start time.')
      return false
    }

    const nextPropagationRequestKey = JSON.stringify({
      satellites: [...selectedSatellites].sort(),
      groundstations: [...selectedGroundStations].sort(),
      start_time: planningWindow.startTime,
      end_time: planningWindow.endTime,
    })
    const canReusePropagation = Boolean(
      orbitEngineRunId
      && propagationResult
      && propagationRequestKey === nextPropagationRequestKey
    )
    let completedPropagationResult = canReusePropagation ? propagationResult : null
    let nextOrbitEngineRunId = canReusePropagation ? orbitEngineRunId : null
    let activeBackendStage = canReusePropagation ? 'Filtering' : 'Propagation'

    setError(null)

    const initialMessages = clearExistingScopeActivities
      ? [
          {
            id: nextExtractionMessageId('clear-scope-init'),
            text: 'SatOS: Clearing all existing SCOPE activities from configured schedules...',
          },
        ]
      : [
          {
            id: nextExtractionMessageId('queued'),
            text: 'Task queued. Waiting for backend processing to start.',
          },
        ]

    dispatchScheduler({
      type: 'runStarted',
      purging: clearExistingScopeActivities,
      messages: initialMessages,
    })
    setOverviewRows([])
    if (!canReusePropagation) {
      clearPropagation()
    }
    clearSession()
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption({})
    setTimelineTradeOffViewId(null)
    setExpandedTimelineGroups({})
    setExpandedTimelineSections({ satellites: true, groundStations: true })
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    resetStagingReview()
    jumpTimelinePlayheadTo(new Date(planningWindow.startTime).getTime())
    setSidebarCollapsed(true)

    setActivePlanningWindow(planningWindow)

    const abortController = new AbortController()
    schedulerAbortControllerRef.current = abortController

    try {
      if (clearExistingScopeActivities) {
        activeBackendStage = 'SatOS Purge'
        const clearPayload = {
          schedule_names: [...selectedSatellites, ...selectedGroundStations],
          start_time: planningWindow.startTime,
          end_time: planningWindow.endTime,
        }
        const clearResult = await clearScopeActivities(clearPayload, abortController.signal)
        const deletedCount = clearResult?.deleted_count ?? 0
        const schedCount = Object.keys(clearResult?.schedules_cleared || {}).length
        const summaryText = deletedCount > 0
          ? `SatOS: Purge complete. Successfully cleared ${deletedCount} SCOPE activit${deletedCount === 1 ? 'y' : 'ies'} across ${schedCount} schedule(s).`
          : 'SatOS: Purge complete. No existing SCOPE activities found in the selected schedule interval.'

        dispatchScheduler({
          type: 'messageAppended',
          message: { id: nextExtractionMessageId('clear-scope-done'), text: summaryText },
        })
        dispatchScheduler({
          type: 'messageAppended',
          message: {
            id: nextExtractionMessageId('queued-after-clear'),
            text: 'Task queued. Waiting for backend processing to start.',
          },
        })

        try {
          const freshAssets = await initializeAssets()
          if (freshAssets && Array.isArray(freshAssets.schedules)) {
            setAssetSchedules(freshAssets.schedules)
          }
        } catch (refreshErr) {
          console.warn('Failed to refresh asset schedules after clearing SatOS activities:', refreshErr)
        }
      }

      activeBackendStage = canReusePropagation ? 'Filtering' : 'Propagation'

      if (!canReusePropagation) {
        const extractionReceipt = await startOrbitExtraction({
          satellites: selectedSatellites,
          groundstations: selectedGroundStations,
          start_time: planningWindow.startTime,
          end_time: planningWindow.endTime,
        }, abortController.signal)
        const extractionResult = await pollBackendTaskResult(extractionReceipt.task_id, {
          signal: abortController.signal,
          onStatusUpdate: (taskStatus) => appendTaskStatus(taskStatus, 'Propagation', 0, 65),
        })

        completedPropagationResult = extractionResult?.payload ?? null
        nextOrbitEngineRunId = completedPropagationResult?.metadata?.task_id ?? extractionReceipt.task_id
        setOrbitEngineRunId(nextOrbitEngineRunId)
        setPropagationResult(completedPropagationResult)
        setPropagationRequestKey(nextPropagationRequestKey)
        setSatelliteTracks(completedPropagationResult?.global_tracks ?? {})
      } else {
        dispatchScheduler({
          type: 'stageEntered',
          status: 'filtering',
          statusLabel: 'Filtering: Queued',
          progress: STAGE_PROGRESS_SPAN.filtering.start,
        })
        dispatchScheduler({
          type: 'messageAppended',
          message: {
            id: `propagation-reused-${nextOrbitEngineRunId}`,
            text: 'Propagation: Reusing the current orbit-engine result.',
          },
        })
      }

      activeBackendStage = 'Filtering'
      dispatchScheduler({ type: 'stageEntered', status: 'filtering' })
      dispatchScheduler({
        type: 'messageAppended',
        message: { id: `filter-queued-${nextOrbitEngineRunId}`, text: 'Filtering: Task queued.' },
      })

      const filterReceipt = await startLinkFiltering({
        orbit_engine_run_id: nextOrbitEngineRunId,
        min_aos_los_elevation_deg: minimumLinkElevationFilterValue,
        min_peak_elevation_deg: minimumPeakElevationFilterValue,
        default_downlink_rate_mbps: Number(dataDownlinkRateMbps),
      }, abortController.signal)
      const filterResult = await pollBackendTaskResult(filterReceipt.task_id, {
        signal: abortController.signal,
        onStatusUpdate: (taskStatus) => appendTaskStatus(taskStatus, 'Filtering', 65, 35),
      })

      const nextFilteredLinks = filterResult?.payload?.links ?? []
      setFilterRunId(filterResult?.payload?.filter_run_id ?? filterReceipt.task_id)
      setFilteredLinks(nextFilteredLinks)
      setOverviewRows(formatFilteredRows(nextFilteredLinks))
      dispatchScheduler({ type: 'linksReady' })
      return true
    } catch (err) {
      const wasTerminated = err?.name === 'AbortError'
      if (!wasTerminated) {
        console.error(err)
      }
      clearSession()
      setActivePlanningWindow(null)
      setSidebarCollapsed(false)
      dispatchScheduler({ type: 'runFailed', aborted: wasTerminated })
      if (!completedPropagationResult) {
        clearPropagation()
      }
      setError(wasTerminated ? null : (err.message || `${activeBackendStage} failed in the backend.`))
      return false
    } finally {
      schedulerAbortControllerRef.current = null
    }
  }

  const handleLoadScope = async () => {
    if (loadScopeDisabled) {
      return
    }

    setError(null)
    const schedulerStarted = await handleLaunchScheduler()

    if (schedulerStarted) {
      setView('workspace')
    }
  }

  // The backend has no task-cancellation endpoint. This only stops the browser
  // from waiting for the current propagation/filtering task.
  const handleTerminateScheduler = () => {
    schedulerAbortControllerRef.current?.abort()
  }

  const applyAuthoritativeSessionPlan = (
    plan,
    baseRows = overviewRows,
    { focusTimeline = true } = {},
  ) => {
    const plannedRows = applySessionPlanToRows(baseRows, plan)
    const rawCards = buildTradeOffCardsFromPlan(plan, plannedRows)
    const colorByLinkId = new Map(
      rawCards.flatMap((card) => card.options.map((option) => [option.linkId, card.colorIndex])),
    )
    const nonTrivialGroupIds = new Set(rawCards.map((card) => card.id))
    const nextRows = plannedRows.map((row) => ({
      ...row,
      duration: formatDurationFromSeconds(row.durationSeconds),
      maxElevation: formatElevation(row.maxElevationDeg),
      tradeOffId: nonTrivialGroupIds.has(row.backendTradeOffId) ? row.backendTradeOffId : '—',
      tradeOffColorIndex: colorByLinkId.get(row.backendLinkId) ?? null,
    }))
    const nextCards = rawCards.map((card) => ({
      ...card,
      options: card.options.map((option) => ({
        ...option,
        duration: formatDurationFromSeconds(option.durationSeconds),
        maxElevation: formatElevation(option.maxElevationDeg),
      })),
    }))
    const nextSelectedOptions = buildSelectedOptionsFromPlan(plan)
    const preservedTimelineTradeOffCard = timelineTradeOffViewId
      ? nextCards.find((card) => card.id === timelineTradeOffViewId) ?? null
      : null

    setSessionPlan(plan)
    setSessionId(plan.session_id)
    setFilterRunId(plan.filter_run_id)
    setOverviewRows(nextRows)
    setTradeOffCards(nextCards)
    setSelectedTradeOffOption(nextSelectedOptions)
    dispatchScheduler({ type: 'scored' })
    setTimelineTradeOffViewId(preservedTimelineTradeOffCard?.id ?? null)
    setActiveTradeOffCardIndex(
      preservedTimelineTradeOffCard
        ? nextCards.findIndex((card) => card.id === preservedTimelineTradeOffCard.id)
        : 0,
    )
    resetStagingReview()
    if (focusTimeline && !preservedTimelineTradeOffCard) {
      focusTimelineOnTradeOffCard(nextCards[0])
    }
  }

  const handleCalculateTradeOffs = async () => {
    if (
      !schedulerLaunched
      || !filterRunId
      || overviewRows.length === 0
      || !bufferConfigValid
      || !tradeOffConfigValid
    ) return

    dispatchScheduler({ type: 'scoringStarted' })
    setError(null)

    try {
      const receipt = await startTradeOffProcessing({
        filter_run_id: filterRunId,
        default_buffer_config: {
          capacity_mb: dataCapacityValueGb * 1000,
          initial_level_mb: dataStartFillValueGb * 1000,
          payload_generation_rate_mbps: dataGenerationRateValue,
          downlink_rate_mbps: dataDownlinkRateValue,
        },
        scoring_config: {
          name: tradeOffStrategy,
          parameters: tradeOffStrategy === 'buffer_overflow_avoidance'
            ? { alpha: scoringAlphaValue, exponent: scoringExponentValue }
            : {},
        },
      })
      const result = await pollBackendTaskResult(receipt.task_id, {
        onStatusUpdate: (taskStatus) => appendTaskStatus(taskStatus, 'Scheduling', 0, 100),
      })
      const plan = result?.payload
      if (!plan?.session_id) {
        throw new Error('The backend returned an invalid scheduling-session result.')
      }
      applyAuthoritativeSessionPlan(plan)
    } catch (err) {
      console.error(err)
      // Scoring failing leaves the filtered links intact: the operator can
      // adjust the buffer configuration and score the same run again.
      dispatchScheduler({ type: 'scoringFailed' })
      setError(err.message || 'Failed to create the backend scheduling session.')
    }
  }

  const handleConfirmSchedule = () => {
    if (!sessionId || finalScheduleRows.length === 0 || confirmingSchedule) {
      return
    }
    setError(null)
    enterStagingReview()

    window.requestAnimationFrame(() => {
      scheduleStagingReviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleBackToEdit = leaveStagingReview

  const handleCommitToSatOS = async () => {
    if (
      !sessionId
      || finalScheduleRows.length === 0
      || confirmingSchedule
      || !allStagingLinksConfirmed
      || scheduleCommitted
    ) {
      return
    }

    setConfirmingSchedule(true)
    setConfirmationProgress(20)
    setConfirmationStep('Committing the backend session to SatOS...')
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setCreatedActivitiesCount(0)
    setError(null)

    try {
      const result = await commitSession(sessionId, userName.trim())
      setConfirmationProgress(100)
      setConfirmationStep('Communication schedule confirmed.')
      setConfirmationSuccess(true)
      setScheduleCommitted(true)
      setConfirmedScheduleCount(result.committed_links_count ?? 0)
      setCreatedActivitiesCount(result.created_activities_count ?? 0)

      window.requestAnimationFrame(() => {
        confirmationSuccessRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })

      try {
        const initialized = await initializeAssets()
        if (Array.isArray(initialized?.assets)) {
          setAssets(initialized.assets)
          setAssetSchedules(Array.isArray(initialized.schedules) ? initialized.schedules : [])
        }
      } catch (refreshError) {
        console.error(refreshError)
        setError('The schedule was committed, but the refreshed SatOS baseline could not be loaded.')
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to commit the scheduling session to SatOS.')
    } finally {
      setConfirmingSchedule(false)
    }
  }

  const backendStatusClass =
    backendAlive === null ? 'checking' : backendAlive ? 'online' : 'offline'

  const backendStatusLabel =
    backendAlive === null ? 'Backend Check' : backendAlive ? 'Backend Online' : 'Backend Offline'

  const satosStatusClass =
    satosAlive === null ? 'idle' : satosAlive ? 'online' : 'offline'

  const satosStatusLabel =
    satosAlive === null
      ? backendAlive === false
        ? 'SatOS Unchecked'
        : 'SatOS Check'
      : satosAlive
        ? 'SatOS Connected'
        : 'SatOS Access Failed'

  const appHeader = (showStatus = true) => (
    <AppHeader
      showStatus={showStatus}
      backendStatusClass={backendStatusClass}
      backendStatusLabel={backendStatusLabel}
      satosStatusClass={satosStatusClass}
      satosStatusLabel={satosStatusLabel}
      userName={userName}
    />
  )

  const dataCapacityValueGb = Number(dataCapacityGb)
  const dataStartFillValueGb = Number(dataStartFillGb)
  const dataGenerationRateValue = Number(dataGenerationMbps)
  const dataDownlinkRateValue = Number(dataDownlinkRateMbps)
  const scoringAlphaValue = Number(scoringAlpha)
  const scoringExponentValue = Number(scoringExponent)
  const bufferConfigValid = (
    String(dataCapacityGb).trim() !== ''
    && Number.isFinite(dataCapacityValueGb)
    && dataCapacityValueGb > 0
    && String(dataStartFillGb).trim() !== ''
    && Number.isFinite(dataStartFillValueGb)
    && dataStartFillValueGb >= 0
    && dataStartFillValueGb <= dataCapacityValueGb
    && String(dataGenerationMbps).trim() !== ''
    && Number.isFinite(dataGenerationRateValue)
    && dataGenerationRateValue >= 0
    && String(dataDownlinkRateMbps).trim() !== ''
    && Number.isFinite(dataDownlinkRateValue)
    && dataDownlinkRateValue > 0
  )
  const tradeOffConfigValid = (
    TRADE_OFF_STRATEGIES.some((strategy) => strategy.value === tradeOffStrategy)
    && (
      tradeOffStrategy !== 'buffer_overflow_avoidance'
      || (
        String(scoringAlpha).trim() !== ''
        && Number.isFinite(scoringAlphaValue)
        && scoringAlphaValue >= 0
        && String(scoringExponent).trim() !== ''
        && Number.isFinite(scoringExponentValue)
        && scoringExponentValue > 0
      )
    )
  )
  const operatorNameValid = userName.trim().length > 0
  const launchRequirementsMet =
    operatorNameValid
    && planningWindowValid
    && selectedSatellites.length >= 1
    && selectedGroundStations.length >= 1
    && linkFiltersValid
    && bufferConfigValid
    && tradeOffConfigValid
  const missionAssetsStatus = loading
    ? {
      tone: 'busy',
      label: 'Loading mission assets from SatOS\u2026',
      busy: true,
      retryLabel: null,
    }
    : missionAssetsLoaded
      ? {
        tone: 'ready',
        label: assetsCached
          ? `Mission assets loaded from Python session cache \u2014 ${assets.length} asset${assets.length === 1 ? '' : 's'}`
          : `Mission assets loaded from SatOS initialization \u2014 ${assets.length} asset${assets.length === 1 ? '' : 's'}`,
        busy: false,
        retryLabel: backendAlive ? 'RELOAD' : null,
      }
      : backendAlive === null
        ? {
          tone: 'busy',
          label: 'Connecting to the SCOPE backend\u2026',
          busy: true,
          retryLabel: null,
        }
        : backendAlive === false
          ? {
            tone: 'error',
            label: 'Backend offline \u2014 start the SCOPE backend to load mission assets.',
            busy: false,
            retryLabel: null,
          }
          : {
            tone: 'error',
            label: error || 'Mission assets could not be loaded from SatOS.',
            busy: false,
            retryLabel: 'Retry',
          }
  const loadScopeDisabled =
    loading
    || launchingScheduler
    || backendAlive !== true
    || !missionAssetsLoaded
    || !launchRequirementsMet
  const loadScopeDisabledReason =
    loading
      ? 'Wait until the current request is finished.'
      : launchingScheduler
        ? 'SCOPE is currently starting.'
        : backendAlive === false
          ? 'Backend offline \u2014 start the SCOPE backend to load SCOPE.'
          : backendAlive === null
            ? 'Connecting to the SCOPE backend\u2026'
            : !missionAssetsLoaded
              ? 'Waiting for SatOS mission data to finish loading.'
              : !operatorNameValid
                ? 'Enter an operator name before launching SCOPE.'
                : !planningWindowValid
                  ? 'Enter a valid planning window with an end time after the start time.'
                  : selectedSatellites.length < 1
                    ? 'Select at least one satellite.'
                    : selectedGroundStations.length < 1
                      ? 'Select at least one ground station.'
                      : !linkFiltersValid
                        ? 'Optional filter values must stay between 0° and 90°.'
                        : !bufferConfigValid
                          ? 'Enter a valid buffer configuration and keep initial fill at or below capacity.'
                          : !tradeOffConfigValid
                            ? 'Enter a valid trade-off scoring configuration.'
                            : ''
  const timeOptions = Array.from({ length: 96 }, (_, index) => {
    const hours = String(Math.floor(index / 4)).padStart(2, '0')
    const minutes = String((index % 4) * 15).padStart(2, '0')
    return `${hours}:${minutes}`
  })

  const getAssetCoordinates = (asset) => {
    if (
      typeof asset?.details?.latitude === 'number' &&
      typeof asset?.details?.longitude === 'number'
    ) {
      return {
        latitude: asset.details.latitude,
        longitude: asset.details.longitude,
      }
    }

    return null
  }

  const planningWindowStartTimestamp = toTimestamp(activePlanningWindow?.startTime)
  const planningWindowEndTimestamp = toTimestamp(activePlanningWindow?.endTime)
  const clampToPlanningWindow = (timestamp) => {
    if (
      planningWindowStartTimestamp === null
      || planningWindowEndTimestamp === null
    ) {
      return timestamp
    }

    return Math.max(
      planningWindowStartTimestamp,
      Math.min(planningWindowEndTimestamp, timestamp),
    )
  }


  const formatCoordinate = (value, positiveLabel, negativeLabel) => {
    const direction = value >= 0 ? positiveLabel : negativeLabel
    return `${Math.abs(value).toFixed(2)}° ${direction}`
  }

  const formatAltitude = (value) => (
    Number.isFinite(value) ? `${(value / 1000).toFixed(1)} km` : '—'
  )

  const selectedGroundStationAssets = useMemo(
    () => groundStationAssets.filter((asset) => selectedGroundStations.includes(asset.name)),
    [groundStationAssets, selectedGroundStations],
  )

  const selectedSatelliteAssets = useMemo(
    () => satelliteAssets.filter((asset) => selectedSatellites.includes(asset.name)),
    [satelliteAssets, selectedSatellites],
  )

  const currentScheduleItems = useMemo(() => buildCurrentScheduleItems(
    assetSchedules,
    [...selectedSatellites, ...selectedGroundStations],
  // The builder is declared in App because the existing SatOS parsing helpers
  // are scoped here; its data dependencies are fully listed below.
  ), [assetSchedules, selectedGroundStations, selectedSatellites])
  const showOverviewProgress =
    launchingScheduler
    || extractionStatus === 'Queued'
    || extractionStatus === 'Running'
  const getOverviewAvailabilityLabel = (row) => {
    const status = getOverviewRowStatus(row)
    if (status === 'blocked') return 'Blocked'
    if (status === 'ineligible') return 'Ineligible'
    return 'Eligible'
  }

  // Override state a Schedule/Scheduled toggle must send. It keys off whether
  // the link is currently in the plan, never off its override state: an
  // auto-scheduled link sits at 'auto', so the old toggle sent 'pinned', the
  // link stayed scheduled and the button looked dead. 'excluded' is the only
  // state that removes a link from the plan - 'auto' would just let the solver
  // pick it straight back up.
  const isOverviewRowUnavailable = (row) => isUnavailableOverviewRow(row)
  const schedulableOverviewRows = overviewRows.filter((row) => getOverviewRowStatus(row) === 'eligible')
  const visibleOverviewRows = showUnavailableOverviewRows
    ? overviewRows
    : overviewRows.filter((row) => !shouldHideOverviewRowInAvailableMode(row))
  const overviewTradeOffBandByOverpassId = useMemo(() => {
    let bandIndex = 0
    let previousTradeOffId = null
    const next = new Map()

    visibleOverviewRows.forEach((row) => {
      if (!row.tradeOffId || row.tradeOffId === '—') {
        next.set(row.overpassId, '')
        previousTradeOffId = null
        return
      }

      if (row.tradeOffId !== previousTradeOffId) {
        bandIndex += 1
        previousTradeOffId = row.tradeOffId
      }

      next.set(
        row.overpassId,
        bandIndex % 2 === 1
          ? 'overview-list-row--tradeoff-band-a'
          : 'overview-list-row--tradeoff-band-b',
      )
    })

    return next
  }, [visibleOverviewRows])
  const tradeOffAvailable = Boolean(filterRunId)
    && schedulerLaunched
    && filteredLinks.some((link) => link.is_eligible)
    && schedulableOverviewRows.length > 0
    && bufferConfigValid
    && tradeOffConfigValid
  // Memoized so that commitSummary (and every other consumer) sees a stable
  // reference: getScheduledRows returns a fresh array on every call, which
  // defeated the memoization below and every dependency array downstream.
  const finalScheduleRows = useMemo(() => getScheduledRows(overviewRows), [overviewRows])
  const commitSummary = useMemo(
    () => buildCommitSummary(finalScheduleRows, sessionPlan),
    [finalScheduleRows, sessionPlan],
  )
  const allScheduledLinkIds = [
    ...new Set(finalScheduleRows.map((row) => row.backendLinkId || row.linkId)),
  ]
  const allStagingLinksConfirmed = areAllLinksConfirmed(allScheduledLinkIds)
  const overviewRowByLinkId = useMemo(
    () => new Map(overviewRows.map((row) => [row.backendLinkId ?? row.linkId, row])),
    [overviewRows],
  )
  const bufferLevelBeforeByLinkId = useMemo(() => {
    const next = new Map()
    const currentPlan = sessionPlan?.current_plan ?? {}

    Object.entries(currentPlan).forEach(([linkId, status]) => {
      if (status?.incoming_buffer_mb !== undefined && status?.incoming_buffer_mb !== null) {
        next.set(linkId, Number(status.incoming_buffer_mb))
      }
    })

    const profiles = sessionPlan?.satellite_buffer_profiles ?? {}
    Object.values(profiles).forEach((profile) => {
      ;(profile?.profile_points ?? []).forEach((point) => {
        if (point?.event_type === 'downlink_start' && point?.associated_id && !next.has(point.associated_id)) {
          next.set(point.associated_id, Number(point.level_mb ?? 0))
        }
      })
    })

    return next
  }, [sessionPlan])
  const confirmScheduleAvailable =
    Boolean(sessionId)
    && schedulerLaunched
    && tradeOffsCalculated
    && finalScheduleRows.length > 0
  const {
    jumpTimelinePlayheadTo,
    toggleTimelineSection,
    toggleTimelineGroup,
    toggleTimelineAssetVisibility,
    handleTimelineItemClick,
    handleTimelineBackgroundClick,
    getOptionForLinkId,
    handleOverviewTradeOffClick,
    setTimelineLive,
    timelinePlaying,
    timelinePlaybackSpeed,
    setTimelinePlaybackSpeed,
    timelineZoomLevel,
    timelineViewportWidthPx,
    timelineCustomZoomMultiplier,
    timelineLayers,
    setTimelineLayers,
    timelineAssetVisibility,
    expandedTimelineGroups,
    setExpandedTimelineGroups,
    expandedTimelineSections,
    setExpandedTimelineSections,
    markedTimelineLinkId,
    setMarkedTimelineLinkId,
    markedTradeOffOptionId,
    setMarkedTradeOffOptionId,
    timelineTooltip,
    setTimelineTooltip,
    timelineHorizontalControl,
    timelineScrollRef,
    timelineScrollFrameRef,
    timelineHorizontalRangeRef,
    timelinePlayheadSliderRef,
    resetTimelineView,
    timelineModel,
    timelinePlayheadTimestamp,
    timelineWheelHintRef,
    timelineTradeOffDrawerRef,
    activeTimelineTradeOffCard,
    buildDataVolumePolyline,
    clearTimelineTooltipHideTimeout,
    closeTimelineTradeOffView,
    dataVolumeModel,
    dataVolumeYMaxGb,
    focusTimelineOnOption,
    focusTimelineOnTradeOffCard,
    focusedTimelineTradeOffId,
    getTimelineRowHeight,
    handleResetTimelineView,
    handleTimelineKeyDown,
    handleTimelinePlaybackToggle,
    handleTimelinePlayheadKeyDown,
    handleTimelinePlayheadPointerDown,
    handleTimelinePlayheadPointerMove,
    handleTimelinePlayheadPointerUp,
    handleTimelineTradeOffDrawerPointerDown,
    hideTimelineTooltip,
    hideWarningTooltip,
    isTimelineItemAtPlayhead,
    moveTimelineTooltip,
    moveWarningTooltip,
    openTimelineTradeOffView,
    pauseTimelineLiveMode,
    scheduleTimelineTooltipHide,
    showTimelineTooltip,
    showWarningTooltip,
    timelineIsFit,
    timelinePlayheadCanvasRatio,
    timelineRenderRows,
    timelineWidthPx,
    visibleTimelineTicks,
  } = useTimelineGeometry({
    currentScheduleItems,
    overviewRows,
    selectedGroundStations,
    selectedSatellites,
    activePlanningWindow,
    tradeOffsCalculated,
    activeTradeOffCardIndex,
    clampToPlanningWindow,
    expandedSections,
    finalScheduleRows,
    formatTimelinePlayheadDateTime,
    missionMapRef,
    planningWindowEndTimestamp,
    planningWindowStartTimestamp,
    schedulerLaunched,
    sessionPlan,
    setActiveTradeOffCardIndex,
    setWarningTooltip,
    timelinePanelRef,
    timelineTradeOffViewId,
    setTimelineTradeOffViewId,
    timelineTradeOffDrawerOffset,
    setTimelineTradeOffDrawerOffset,
    tradeOffCardListRef,
    tradeOffCards,
    view,
  })

  const resetWorkspaceState = () => {
    const planningWindowPreset = resetPlanningWindow()

    setSelectedSatellites([])
    setSelectedGroundStations([])
    resetSchedulerConfig()
    setSidebarCollapsed(false)
    resetSchedulerRun()
    resetSessionPlan()
    setShowUnavailableOverviewRows(true)
    setTimelineTradeOffViewId(null)
    resetMapView()
    setActivePlanningWindow(null)
    resetTimelineView(new Date(planningWindowPreset.startIso).getTime())
    setExpandedSections({
      timeWindow: true,
      satellites: true,
      groundStations: true,
      unavailableAssets: false,
      linkFilters: true,
      bufferConfig: true,
      tradeOffConfig: true,
      mapView: true,
      overview: true,
      timeline: true,
    })
    setDataStartFillGb(DEFAULT_DATA_START_FILL_GB)
    setDataGenerationMbps(DEFAULT_DATA_GENERATION_MBPS)
    setDataCapacityGb(DEFAULT_DATA_CAPACITY_GB)
    setDataDownlinkRateMbps(DEFAULT_DOWNLINK_RATE_MBPS)
    setTradeOffStrategy(DEFAULT_TRADE_OFF_STRATEGY)
    setScoringAlpha(DEFAULT_SCORING_ALPHA)
    setScoringExponent(DEFAULT_SCORING_EXPONENT)
    setConfirmingSchedule(false)
    setConfirmationProgress(0)
    setConfirmationStep('')
    resetStagingReview()
    setOverridingLinkId(null)
  }

  // Assigned in an effect rather than during render: writing a ref while
  // rendering is not allowed, and the hook only ever calls it from an event.

  useEffect(() => {
    resetWorkspaceStateRef.current = resetWorkspaceState
  })

  const getSatelliteTrackCoordinates = useCallback((assetName) => (
    interpolateTrackPosition(preparedSatelliteTracks[assetName], timelinePlayheadTimestamp)
  ), [preparedSatelliteTracks, timelinePlayheadTimestamp])

  const selectedMapAssets = useMemo(() => [
    ...selectedGroundStationAssets
      .map((asset) => {
        const coordinates = getAssetCoordinates(asset)
        if (!coordinates) {
          return null
        }

        return {
          id: `ground-station-${asset.name}`,
          name: asset.name,
          type: 'Ground Station',
          markerType: 'ground-station',
          minLinkElevation: asset.details?.min_link_elevation,
          ...coordinates,
        }
      })
      .filter(Boolean),
    ...selectedSatelliteAssets
      .map((asset) => {
        const coordinates = getSatelliteTrackCoordinates(asset.name)
        if (!coordinates) {
          return null
        }

        return {
          id: `satellite-${asset.name}`,
          name: asset.name,
          type: 'Satellite',
          markerType: 'satellite',
          ...coordinates,
        }
      })
      .filter(Boolean),
  ], [
    getSatelliteTrackCoordinates,
    selectedGroundStationAssets,
    selectedSatelliteAssets,
  ])

  const visibleMapAssets = selectedMapAssets

  const selectedAssetsWithoutLocation = useMemo(() => [
    ...selectedSatelliteAssets
      .filter((asset) => !getSatelliteTrackCoordinates(asset.name))
      .map((asset) => ({
        id: `selected-satellite-${asset.name}`,
        name: asset.name,
        type: 'Satellite',
        locationMessage: schedulerLaunched
          ? 'No propagated position is available at the selected time.'
          : 'Satellite position becomes available after propagation.',
      })),
  ], [
    getSatelliteTrackCoordinates,
    schedulerLaunched,
    selectedSatelliteAssets,
  ])
  // No fallback to visibleMapAssets[0] here: defaulting to "always something
  // highlighted" would make it impossible to ever reach a genuinely
  // unhighlighted state -- clicking to deselect (or clicking empty map
  // space, see MissionMap's background-click handling) needs an actual
  // "nothing selected" state to land on.
  const activeMapAsset = visibleMapAssets.find((asset) => asset.id === activeMapAssetId) ?? null

  const handleSelectMapAsset = useCallback((assetId) => {
    setActiveMapAssetId(assetId)
    if (!assetId) {
      return
    }

    requestAnimationFrame(() => {
      const assetCard = [...(visibleMapAssetListRef.current?.querySelectorAll(
        '.map-asset-card',
      ) ?? [])].find((card) => card.dataset.mapAssetId === assetId)

      assetCard?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    })
  }, [setActiveMapAssetId])


  const renderTimelineTooltipContent = (item, pinned = false) => (
    <TimelineTooltip
      item={item}
      pinned={pinned}
      formatTimelineDateTime={formatTimelineDateTime}
      handleLinkOverride={handleLinkOverride}
      hideTimelineTooltip={hideTimelineTooltip}
      openTimelineTradeOffView={openTimelineTradeOffView}
      overridingLinkId={overridingLinkId}
      sessionId={sessionId}
      tradeOffsCalculated={tradeOffsCalculated}
    />
  )

  const renderAssetWarning = (message) => (
    <AssetWarning
      message={message}
      hideWarningTooltip={hideWarningTooltip}
      moveWarningTooltip={moveWarningTooltip}
      showWarningTooltip={showWarningTooltip}
    />
  )

  const renderPanelDragHandle = (panelId) => (
    <PanelDragHandle
      panelId={panelId}
      handlePanelDragEnd={handlePanelDragEnd}
      handlePanelDragStart={handlePanelDragStart}
    />
  )

  const renderTradeOffPill = (tradeOffId) => (
    <TradeOffPill tradeOffId={tradeOffId} />
  )

  const handleLinkOverride = async (option, overrideState) => {
    if (!sessionId || !option?.linkId || overridingLinkId) {
      return
    }

    setOverridingLinkId(option.linkId)
    setError(null)

    try {
      const updatedPlan = await applySessionOverride(sessionId, {
        link_id: option.linkId,
        override_state: overrideState,
      })
      applyAuthoritativeSessionPlan(updatedPlan, overviewRows, { focusTimeline: false })

      const updatedStatus = updatedPlan.current_plan?.[option.linkId]
      if (updatedStatus) {
        setTimelineTooltip((current) => (
          current.item?.linkId === option.linkId
            ? {
                ...current,
                item: {
                  ...current.item,
                  isScheduled: Boolean(updatedStatus.is_scheduled),
                  overrideState: updatedStatus.override_state ?? 'auto',
                  recommended: Boolean(updatedStatus.is_scheduled)
                    && (updatedStatus.override_state ?? 'auto') === 'auto',
                  usefulDataOffloadedMb: updatedStatus.useful_data_offloaded_mb
                    ?? current.item.usefulDataOffloadedMb,
                  score: updatedStatus.score ?? current.item.score,
                  rejectionReason: updatedStatus.rejection_reason ?? null,
                },
              }
            : current
        ))
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to update the scheduling-session override.')
      return
    } finally {
      setOverridingLinkId(null)
    }

    setMarkedTimelineLinkId(option.linkId)
    setMarkedTradeOffOptionId(option.optionId)
  }

  const renderTimelineBar = (item, rowType = 'link') => {
    const isLink = item.kind === 'link'
    const isGroupRow = rowType === 'group'
    const laneStepRem = isGroupRow ? 3.08 : 2.34
    const barHeightRem = isGroupRow ? 2.58 : 1.92
    const barTopOffsetRem = isGroupRow ? 0.62 : 0.44
    // Both instances of the same link (satellite side and ground station side)
    // carry the same linkId, so marking one visibly marks the other -- that is
    // the "visuelle Verknuepfung" the asset rows exist for.
    const marked = isLink && markedTimelineLinkId !== null && markedTimelineLinkId === item.linkId
    const outsideFocusedTradeOff = isLink
      && focusedTimelineTradeOffId !== null
      && item.tradeOffId !== focusedTimelineTradeOffId
    const outsideMarkedLink = isLink
      && markedTimelineLinkId !== null
      && item.linkId !== markedTimelineLinkId
    const pinned = timelineTooltip.pinned && timelineTooltip.item?.id === item.id

    return (
      <button
        key={item.id}
        type="button"
        className={[
          'timeline-bar',
          `timeline-bar--${item.variant}`,
          isTimelineItemAtPlayhead(item) ? 'timeline-bar--playhead-active' : '',
          item.dimmed ? 'timeline-bar--dimmed' : '',
          outsideFocusedTradeOff || (focusedTimelineTradeOffId === null && outsideMarkedLink) ? 'timeline-bar--context-dimmed' : '',
          marked ? 'timeline-bar--marked' : '',
          pinned ? 'timeline-bar--tooltip-pinned' : '',
          isGroupRow ? 'timeline-bar--group-row' : 'timeline-bar--link-row',
          isLink ? '' : 'timeline-bar--static',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${(item.startMinutes / timelineModel.totalMinutes) * 100}%`,
          width: `${(item.durationMinutes / timelineModel.totalMinutes) * 100}%`,
          top: `calc(${barTopOffsetRem}rem + ${(item.laneIndex ?? 0) * laneStepRem}rem)`,
          height: `${barHeightRem}rem`,
        }}
        data-timeline-item-id={item.id}
        data-link-id={item.linkId ?? undefined}
        data-playback-start={item.startTimestamp}
        data-playback-end={item.endTimestamp}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => handleTimelineItemClick(item, event)}
        onMouseEnter={(event) => showTimelineTooltip(item, event)}
        onMouseMove={moveTimelineTooltip}
        onMouseLeave={scheduleTimelineTooltipHide}
        onFocus={(event) => showTimelineTooltip(item, event)}
        onBlur={scheduleTimelineTooltipHide}
        aria-pressed={isLink ? marked : undefined}
        aria-haspopup={isLink ? 'dialog' : undefined}
        aria-expanded={isLink ? pinned : undefined}
        aria-label={`${item.label}. ${item.detail}. Start ${formatTimelineDateTime(item.startTime)}. End ${formatTimelineDateTime(item.endTime)}. Duration ${formatTimelineItemDuration(item)}.`}
      ></button>
    )
  }

  const renderSectionChevron = (expanded) => (
    <SectionChevron expanded={expanded} />
  )

  const getScheduleBlockMessage = (row) => {
    if (!row.scheduleBlocked) {
      return ''
    }

    const blockingActivityLabel = row.scheduleBlockLabel ?? 'a scheduled activity'
    const blockingAsset = row.scheduleBlockAsset ?? 'the current schedule'

    return `${row.overpassId} is blocked because ${blockingActivityLabel} on ${blockingAsset} has priority.`
  }

  const formatTimeTextInput = (rawValue, previousValue = '') => {
    const digitsOnly = rawValue.replace(/\D/g, '').slice(0, 4)

    if (digitsOnly.length <= 1) {
      return digitsOnly
    }

    if (digitsOnly.length === 2) {
      if (rawValue === digitsOnly && previousValue === `${digitsOnly}:`) {
        return digitsOnly.slice(0, 1)
      }

      return `${digitsOnly}:`
    }

    return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2)}`
  }

  // Past time windows are allowed (a warning is shown instead), so every
  // time-of-day option stays selectable regardless of the chosen date.
  const getSelectableTimeOptions = () => timeOptions

  const renderTimeInput = (menuKey, value, setValue, disabled = false) => (
    <TimeInput
      menuKey={menuKey}
      value={value}
      setValue={setValue}
      disabled={disabled}
      activeTimeMenu={activeTimeMenu}
      formatTimeTextInput={formatTimeTextInput}
      getSelectableTimeOptions={getSelectableTimeOptions}
      setActiveTimeMenu={setActiveTimeMenu}
    />
  )

  const renderPlanningTimeActions = (target, disabled = false) => (
    <PlanningTimeActions
      target={target}
      disabled={disabled}
      handleResetPlanningTime={handleResetPlanningTime}
      handleSetCurrentPlanningTime={handleSetCurrentPlanningTime}
      handleShiftPlanningTime={handleShiftPlanningTime}
    />
  )

  const renderExtractionProgressPanel = () => (
    <ExtractionProgress
      extractionMessages={extractionMessages}
      extractionProgress={extractionProgress}
    />
  )

  const renderPlanningWindowContent = (disabled = false) => (
    <PlanningWindowForm
      disabled={disabled}
      handlePlanningTimeModeChange={handlePlanningTimeModeChange}
      planningTimeMode={planningTimeMode}
      planningWindowComplete={planningWindowComplete}
      planningWindowEndDate={planningWindowEndDate}
      planningWindowEndTime={planningWindowEndTime}
      planningWindowInPast={planningWindowInPast}
      planningWindowStartDate={planningWindowStartDate}
      planningWindowStartTime={planningWindowStartTime}
      planningWindowValid={planningWindowValid}
      renderPlanningTimeActions={renderPlanningTimeActions}
      renderTimeInput={renderTimeInput}
      setPlanningWindowEndDate={setPlanningWindowEndDate}
      setPlanningWindowEndTime={setPlanningWindowEndTime}
      setPlanningWindowStartDate={setPlanningWindowStartDate}
      setPlanningWindowStartTime={setPlanningWindowStartTime}
    />
  )

  const renderLinkFiltersContent = (disabled = false) => (
    <LinkFilters
      disabled={disabled}
      linkFiltersValid={linkFiltersValid}
      minimumLinkElevationFilterDeg={minimumLinkElevationFilterDeg}
      minimumPeakElevationFilterDeg={minimumPeakElevationFilterDeg}
      setMinimumLinkElevationFilterDeg={setMinimumLinkElevationFilterDeg}
      setMinimumPeakElevationFilterDeg={setMinimumPeakElevationFilterDeg}
    />
  )

  const renderBufferConfigContent = (disabled = false) => (
    <BufferConfig
      disabled={disabled}
      bufferConfigValid={bufferConfigValid}
      dataCapacityGb={dataCapacityGb}
      dataDownlinkRateMbps={dataDownlinkRateMbps}
      dataGenerationMbps={dataGenerationMbps}
      dataStartFillGb={dataStartFillGb}
      setDataCapacityGb={setDataCapacityGb}
      setDataDownlinkRateMbps={setDataDownlinkRateMbps}
      setDataGenerationMbps={setDataGenerationMbps}
      setDataStartFillGb={setDataStartFillGb}
    />
  )

  const renderTradeOffConfigContent = (disabled = false) => (
    <TradeOffConfig
      disabled={disabled}
      scoringAlpha={scoringAlpha}
      scoringExponent={scoringExponent}
      setScoringAlpha={setScoringAlpha}
      setScoringExponent={setScoringExponent}
      setTradeOffStrategy={setTradeOffStrategy}
      tradeOffConfigValid={tradeOffConfigValid}
      tradeOffStrategy={tradeOffStrategy}
    />
  )

  const renderSatelliteOptionsContent = (configDisabled = false) => (
    <SatelliteOptions
      configDisabled={configDisabled}
      renderAssetWarning={renderAssetWarning}
      satelliteAssets={satelliteAssets}
      selectedSatellites={selectedSatellites}
      toggleSatellite={toggleSatellite}
    />
  )

  const renderGroundStationOptionsContent = (configDisabled = false) => (
    <GroundStationOptions
      configDisabled={configDisabled}
      groundStationAssets={groundStationAssets}
      renderAssetWarning={renderAssetWarning}
      selectedGroundStations={selectedGroundStations}
      toggleGroundStation={toggleGroundStation}
    />
  )

  const renderUnavailableAssetsContent = (configDisabled = false) => (
    <UnavailableAssets
      configDisabled={configDisabled}
      renderAssetWarning={renderAssetWarning}
      unavailableAssets={unavailableAssets}
    />
  )

  const renderAssetsLandingContent = (configDisabled = false) => (
    <AssetPicker
      configDisabled={configDisabled}
      expandedSections={expandedSections}
      renderGroundStationOptionsContent={renderGroundStationOptionsContent}
      renderSatelliteOptionsContent={renderSatelliteOptionsContent}
      renderSectionChevron={renderSectionChevron}
      renderUnavailableAssetsContent={renderUnavailableAssetsContent}
      toggleSection={toggleSection}
    />
  )

  if (view === 'landing') {
    return (
      <LandingPage
        appHeader={appHeader}
        clearExistingScopeActivities={clearExistingScopeActivities}
        error={error}
        fetchAssets={fetchAssets}
        handleLoadScope={handleLoadScope}
        handleTerminateScheduler={handleTerminateScheduler}
        launchingScheduler={launchingScheduler}
        loadScopeDisabled={loadScopeDisabled}
        loadScopeDisabledReason={loadScopeDisabledReason}
        missionAssetsLoaded={missionAssetsLoaded}
        missionAssetsStatus={missionAssetsStatus}
        renderAssetsLandingContent={renderAssetsLandingContent}
        renderBufferConfigContent={renderBufferConfigContent}
        renderExtractionProgressPanel={renderExtractionProgressPanel}
        renderLinkFiltersContent={renderLinkFiltersContent}
        renderPlanningWindowContent={renderPlanningWindowContent}
        renderTradeOffConfigContent={renderTradeOffConfigContent}
        setClearExistingScopeActivities={setClearExistingScopeActivities}
        setUserName={setUserName}
        showOverviewProgress={showOverviewProgress}
        userName={userName}
        warningTooltip={warningTooltip}
      />
    )
  }

  const overviewPanelNode = (
    <OverviewPanel
      bufferConfigValid={bufferConfigValid}
      bufferLevelBeforeByLinkId={bufferLevelBeforeByLinkId}
      calculatingTradeOffs={calculatingTradeOffs}
      expandedSections={expandedSections}
      filterRunId={filterRunId}
      filteredLinks={filteredLinks}
      formatOverviewEndDateTime={formatOverviewEndDateTime}
      formatOverviewStartDateTime={formatOverviewStartDateTime}
      getOptionForLinkId={getOptionForLinkId}
      getOverviewAvailabilityLabel={getOverviewAvailabilityLabel}
      getPanelDragClassName={getPanelDragClassName}
      getPanelDropZoneProps={getPanelDropZoneProps}
      getPanelHeadingDragProps={getPanelHeadingDragProps}
      getScheduleBlockMessage={getScheduleBlockMessage}
      handleCalculateTradeOffs={handleCalculateTradeOffs}
      handleLinkOverride={handleLinkOverride}
      handleOverviewTradeOffClick={handleOverviewTradeOffClick}
      hideWarningTooltip={hideWarningTooltip}
      isOverviewRowUnavailable={isOverviewRowUnavailable}
      markedTimelineLinkId={markedTimelineLinkId}
      moveWarningTooltip={moveWarningTooltip}
      orbitEngineRunId={orbitEngineRunId}
      overridingLinkId={overridingLinkId}
      overviewRows={overviewRows}
      overviewTradeOffBandByOverpassId={overviewTradeOffBandByOverpassId}
      propagationResult={propagationResult}
      renderExtractionProgressPanel={renderExtractionProgressPanel}
      renderPanelDragHandle={renderPanelDragHandle}
      renderSectionChevron={renderSectionChevron}
      renderTradeOffPill={renderTradeOffPill}
      schedulableOverviewRows={schedulableOverviewRows}
      schedulerLaunched={schedulerLaunched}
      sessionId={sessionId}
      setShowUnavailableOverviewRows={setShowUnavailableOverviewRows}
      showOverviewProgress={showOverviewProgress}
      showUnavailableOverviewRows={showUnavailableOverviewRows}
      showWarningTooltip={showWarningTooltip}
      toggleSection={toggleSection}
      tradeOffAvailable={tradeOffAvailable}
      tradeOffConfigValid={tradeOffConfigValid}
      tradeOffsCalculated={tradeOffsCalculated}
      visibleOverviewRows={visibleOverviewRows}
    />
  )

  const mapViewPanelNode = (
    <MapPanel
      activeMapAsset={activeMapAsset}
      activePlanningWindow={activePlanningWindow}
      expandedSections={expandedSections}
      formatAltitude={formatAltitude}
      formatCoordinate={formatCoordinate}
      formatTimelinePlayheadDateTime={formatTimelinePlayheadDateTime}
      getPanelDragClassName={getPanelDragClassName}
      getPanelDropZoneProps={getPanelDropZoneProps}
      getPanelHeadingDragProps={getPanelHeadingDragProps}
      groundTrackWindowHours={groundTrackWindowHours}
      handleSelectMapAsset={handleSelectMapAsset}
      mapViewHeightPx={mapViewHeightPx}
      missionMapRef={missionMapRef}
      planningTimeMode={planningTimeMode}
      preparedSatelliteTracks={preparedSatelliteTracks}
      renderPanelDragHandle={renderPanelDragHandle}
      renderSectionChevron={renderSectionChevron}
      schedulerLaunched={schedulerLaunched}
      selectedAssetsWithoutLocation={selectedAssetsWithoutLocation}
      setActiveMapAssetId={setActiveMapAssetId}
      setGroundTrackWindowHours={setGroundTrackWindowHours}
      setShowGroundStationVisibilityCircles={setShowGroundStationVisibilityCircles}
      setShowGroundTracks={setShowGroundTracks}
      setShowSatelliteVisibilityCircles={setShowSatelliteVisibilityCircles}
      showGroundStationVisibilityCircles={showGroundStationVisibilityCircles}
      showGroundTracks={showGroundTracks}
      showSatelliteVisibilityCircles={showSatelliteVisibilityCircles}
      toggleSection={toggleSection}
      visibleMapAssetListRef={visibleMapAssetListRef}
      visibleMapAssets={visibleMapAssets}
    />
  )

  // Everything TimelineTracks reads. Assembled here rather than threaded
  // through props: the surface is genuinely this wide, and one named bundle
  // is easier to keep honest than a sixty-attribute call site.
  const timelineContextValue = {
    activeTimelineTradeOffCard,
    bufferLevelBeforeByLinkId,
    buildDataVolumePolyline,
    closeTimelineTradeOffView,
    dataVolumeModel,
    dataVolumeYMaxGb,
    expandedTimelineGroups,
    expandedTimelineSections,
    focusTimelineOnOption,
    formatBufferLevelGb,
    formatDataDownlinkGb,
    formatGb,
    formatOverviewEndDateTime,
    formatOverviewStartDateTime,
    formatTimelineDateTime,
    formatTimelinePlayheadDateTime,
    getBackendDataDownlinkMb,
    getOverviewControlTooltip,
    getPassCapacityMb,
    getScheduleToggleState,
    getScheduleToggleTitle,
    getTimelineRowHeight,
    handleLinkOverride,
    handleTimelineBackgroundClick,
    handleTimelineKeyDown,
    handleTimelinePlayheadKeyDown,
    handleTimelinePlayheadPointerDown,
    handleTimelinePlayheadPointerMove,
    handleTimelinePlayheadPointerUp,
    handleTimelineTradeOffDrawerPointerDown,
    hideWarningTooltip,
    markedTimelineLinkId,
    markedTradeOffOptionId,
    moveWarningTooltip,
    overridingLinkId,
    overviewRowByLinkId,
    pauseTimelineLiveMode,
    planningWindowEndTimestamp,
    planningWindowStartTimestamp,
    renderAssetWarning,
    renderSectionChevron,
    renderTimelineBar,
    renderTradeOffPill,
    showWarningTooltip,
    timelineIsFit,
    timelineModel,
    timelinePlayheadCanvasRatio,
    timelinePlayheadSliderRef,
    timelinePlayheadTimestamp,
    timelineRenderRows,
    timelineScrollFrameRef,
    timelineScrollRef,
    timelineTradeOffDrawerOffset,
    timelineTradeOffDrawerRef,
    timelineWheelHintRef,
    timelineWidthPx,
    toggleTimelineGroup,
    toggleTimelineSection,
    visibleTimelineTicks,
  }

  const timelinePanelNode = (
    <TimelinePanel
      activePlanningWindow={activePlanningWindow}
      allStagingLinksConfirmed={allStagingLinksConfirmed}
      commitSummary={commitSummary}
      confirmScheduleAvailable={confirmScheduleAvailable}
      confirmationSuccess={confirmationSuccess}
      confirmationSuccessRef={confirmationSuccessRef}
      confirmedScheduleCount={confirmedScheduleCount}
      confirmedStagingLinks={confirmedStagingLinks}
      confirmingSchedule={confirmingSchedule}
      createdActivitiesCount={createdActivitiesCount}
      expandedSections={expandedSections}
      finalScheduleRows={finalScheduleRows}
      getPanelDragClassName={getPanelDragClassName}
      getPanelDropZoneProps={getPanelDropZoneProps}
      getPanelHeadingDragProps={getPanelHeadingDragProps}
      handleBackToEdit={handleBackToEdit}
      handleCommitToSatOS={handleCommitToSatOS}
      handleConfirmSchedule={handleConfirmSchedule}
      handleResetTimelineView={handleResetTimelineView}
      handleTimelinePlaybackToggle={handleTimelinePlaybackToggle}
      isScheduleStaged={isScheduleStaged}
      planningWindowEndTimestamp={planningWindowEndTimestamp}
      planningWindowStartTimestamp={planningWindowStartTimestamp}
      renderPanelDragHandle={renderPanelDragHandle}
      renderSectionChevron={renderSectionChevron}
      scheduleCommitted={scheduleCommitted}
      scheduleStagingReviewRef={scheduleStagingReviewRef}
      schedulerLaunched={schedulerLaunched}
      sessionId={sessionId}
      setTimelinePlaybackSpeed={setTimelinePlaybackSpeed}
      timelineAssetVisibility={timelineAssetVisibility}
      timelineContextValue={timelineContextValue}
      timelineCustomZoomMultiplier={timelineCustomZoomMultiplier}
      timelineLayers={timelineLayers}
      timelineModel={timelineModel}
      timelinePanelRef={timelinePanelRef}
      timelinePlaybackSpeed={timelinePlaybackSpeed}
      timelinePlaying={timelinePlaying}
      timelineRenderRows={timelineRenderRows}
      timelineZoomLevel={timelineZoomLevel}
      toggleSection={toggleSection}
      toggleStagingAssetConfirmation={toggleStagingAssetConfirmation}
      toggleStagingLinkConfirmation={toggleStagingLinkConfirmation}
      toggleTimelineAssetVisibility={toggleTimelineAssetVisibility}
      toggleTimelineLayer={toggleTimelineLayer}
      tradeOffsCalculated={tradeOffsCalculated}
      userName={userName}
    />
  )

  const panelNodesById = {
    overview: overviewPanelNode,
    mapView: mapViewPanelNode,
    timeline: timelinePanelNode,
  }

  const pageContent = (
    <WorkspaceLayout
      backendAlive={backendAlive}
      bottomTopHeightPx={bottomTopHeightPx}
      expandedSections={expandedSections}
      groundStationAssets={groundStationAssets}
      handleLaunchScheduler={handleLaunchScheduler}
      handlePanelResizeKeyDown={handlePanelResizeKeyDown}
      handlePanelResizeStart={handlePanelResizeStart}
      handlePlanningRowResizeKeyDown={handlePlanningRowResizeKeyDown}
      handlePlanningRowResizeStart={handlePlanningRowResizeStart}
      handleTerminateScheduler={handleTerminateScheduler}
      handleTopPanelsResizeKeyDown={handleTopPanelsResizeKeyDown}
      handleTopPanelsResizeStart={handleTopPanelsResizeStart}
      launchRequirementsMet={launchRequirementsMet}
      launchingScheduler={launchingScheduler}
      overviewPanelWidth={overviewPanelWidth}
      panelNodesById={panelNodesById}
      panelSlotAssignment={panelSlotAssignment}
      renderAssetWarning={renderAssetWarning}
      renderBufferConfigContent={renderBufferConfigContent}
      renderLinkFiltersContent={renderLinkFiltersContent}
      renderPlanningWindowContent={renderPlanningWindowContent}
      renderSectionChevron={renderSectionChevron}
      renderTradeOffConfigContent={renderTradeOffConfigContent}
      satelliteAssets={satelliteAssets}
      selectedGroundStations={selectedGroundStations}
      selectedSatellites={selectedSatellites}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarCollapsed={sidebarCollapsed}
      splitPanelsRef={splitPanelsRef}
      toggleGroundStation={toggleGroundStation}
      toggleSatellite={toggleSatellite}
      toggleSection={toggleSection}
      topPanelsHeightPx={topPanelsHeightPx}
      unavailableAssets={unavailableAssets}
    />
  )

  return (
    <div className={`app-shell ${confirmingSchedule ? 'app-shell--locked' : ''}`}>
      {appHeader(false)}

      <div className="app-content">
        {pageContent}
      </div>

      {warningTooltip.visible && (
        <div
          className="app-hover-tooltip"
          style={{
            left: `${Math.max(12, Math.min(warningTooltip.x + 16, window.innerWidth - 320))}px`,
            top: `${Math.max(12, Math.min(warningTooltip.y + 18, window.innerHeight - 120))}px`,
          }}
        >
          {warningTooltip.message}
        </div>
      )}

      {timelineTooltip.visible && timelineTooltip.item && createPortal((
        <div
          className={`timeline-hover-tooltip ${timelineTooltip.pinned ? 'timeline-hover-tooltip--pinned' : ''}`}
          role={timelineTooltip.pinned ? 'dialog' : 'tooltip'}
          aria-label={timelineTooltip.pinned
            ? `${timelineTooltip.item.kind === 'link' ? `Schedule controls for ${timelineTooltip.item.linkId}` : timelineTooltip.item.label}`
            : undefined}
          style={{
            left: `${timelineTooltip.pinned
              ? Math.max(16, Math.min(timelineTooltip.x, window.innerWidth - 392))
              : Math.max(16, Math.min(timelineTooltip.x + 18, window.innerWidth - 392))}px`,
            top: `${timelineTooltip.pinned
              ? Math.max(16, Math.min(timelineTooltip.y, window.innerHeight - 380))
              : Math.max(16, Math.min(timelineTooltip.y + 22, window.innerHeight - 380))}px`,
          }}
          onMouseEnter={clearTimelineTooltipHideTimeout}
          onMouseLeave={() => {
            if (!timelineTooltip.pinned) {
              scheduleTimelineTooltipHide()
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {timelineTooltip.pinned && (
            <button
              type="button"
              className="timeline-hover-tooltip-dismiss"
              onClick={() => hideTimelineTooltip(true)}
              aria-label="Close timeline popup"
            >
              ×
            </button>
          )}
          {renderTimelineTooltipContent(timelineTooltip.item, timelineTooltip.pinned)}
        </div>
      ), document.body)}

      {timelineHorizontalControl.visible && createPortal((
        <label
          className="timeline-horizontal-scroll-control timeline-horizontal-scroll-control--floating"
          style={{
            left: `${timelineHorizontalControl.left}px`,
            width: `${timelineHorizontalControl.width}px`,
          }}
        >
          <span>Horizontal position</span>
          <input
            ref={timelineHorizontalRangeRef}
            type="range"
            min="0"
            max={timelineIsFit ? 0 : Math.max(0, timelineWidthPx - timelineViewportWidthPx)}
            step="1"
            defaultValue="0"
            disabled={timelineIsFit}
            aria-label="Horizontal timeline position"
            onInput={(event) => {
              const scrollLeft = Number(event.currentTarget.value)
              if (timelineScrollRef.current && Number.isFinite(scrollLeft)) {
                setTimelineLive(false)
                timelineScrollRef.current.scrollLeft = scrollLeft
              }
            }}
          />
        </label>
      ), document.body)}

      {confirmingSchedule && (
        <div className="workspace-lock-overlay" role="status" aria-live="polite">
          <div className="workspace-lock-card">
            <span className="workspace-lock-label">Confirming Schedule</span>
            <h3>{confirmationStep || 'Preparing confirmation workflow...'}</h3>
            <div className="workspace-lock-progress">
              <div
                className="workspace-lock-progress-bar"
                style={{ width: `${confirmationProgress}%` }}
              ></div>
            </div>
            <p>{confirmationProgress}% completed</p>
          </div>
        </div>
      )}
    </div>
  )
}
