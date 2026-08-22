import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  interpolateTrackPosition,
  prepareTrackPoints,
} from './components/mapGeometry.js'
import {
  BACKEND_BASE_URL,
  applySessionOverride,
  commitSession,
  initializeAssets,
  pollTaskResult as pollBackendTaskResult,
  startLinkFiltering,
  startOrbitExtraction,
  startTradeOffProcessing,
} from './api/scopeApi.js'
import {
  applySessionPlanToRows,
  buildRowsFromFilteredLinks,
  buildSelectedOptionsFromPlan,
  buildTradeOffCardsFromPlan,
  getScheduledRows,
} from './schedulingModel.js'

const MissionMap = lazy(() => import('./components/MissionMap.jsx'))
const TRADE_OFF_ACCENT_COLORS = ['#c56b2d', '#5b7cfa', '#2a9d8f', '#9b5de5']
// Reset View puts the whole planning window back on screen. Everything between
// 1x and the max multiplier is reached with Ctrl/Cmd + wheel.
const TIMELINE_DEFAULT_ZOOM_LEVEL = 'fit'
// The three layers used to BE the timeline's rows. Since rows became
// asset-centric they are pure filters over which kind of bar is drawn.
const TIMELINE_LAYERS = [
  { id: 'current', label: 'Current Schedule' },
  { id: 'potential', label: 'Potential Links' },
  { id: 'proposed', label: 'Proposed Schedule' },
]
const TIMELINE_WHEEL_ZOOM_STEP = 0.6
const TIMELINE_MIN_ZOOM_MULTIPLIER = 1
const TIMELINE_MAX_ZOOM_MULTIPLIER = 24
const TIMELINE_PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128]
const DEFAULT_PLANNING_TIME_MODE = 'utc'
const MAP_PANEL_CHROME_OVERHEAD_PX = 88
// Panel identity is separate from panel position: PANEL_LABELS/panelSlotAssignment
// let every panel (Overview, Trade-Off, Map View, Timeline) be
// dragged between layout slots, while collapse state etc. stays keyed
// to the panel itself.
const PANEL_LABELS = {
  overview: 'Overview',
  tradeOff: 'Trade-Off',
  mapView: 'Map View',
  timeline: 'Timeline',
}

// The separate Trade-Off panel is deprecated. Backend-owned scheduling status
// and override controls live in the Overview; the dormant card view remains
// available behind this flag for layouts that still need it.
const TRADE_OFF_PANEL_ENABLED = false

// Values entered in GB are converted to MB at the API boundary. Backend rate
// fields currently use MB/s semantics despite their historical `_mbps` names.
const DEFAULT_DATA_START_FILL_GB = 40
const DEFAULT_DATA_GENERATION_MBPS = 100
const DEFAULT_DATA_CAPACITY_GB = 100
const DEFAULT_DOWNLINK_RATE_MBPS = 25
const DEFAULT_TRADE_OFF_STRATEGY = 'buffer_overflow_avoidance'
const DEFAULT_SCORING_ALPHA = 2
const DEFAULT_SCORING_EXPONENT = 2
const TRADE_OFF_STRATEGIES = [
  { value: 'buffer_overflow_avoidance', label: 'Buffer overflow avoidance' },
  { value: 'max_downlink_throughput', label: 'Maximum downlink throughput' },
  { value: 'max_pass_duration', label: 'Maximum pass duration' },
]

class MapErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mission-map-shell">
          <div className="mission-map-state mission-map-state--error" role="alert">
            Map could not be initialized: {this.state.error.message}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

const padDateTimePart = (value) => String(value).padStart(2, '0')

const formatPlanningDateFields = (date, timeMode) => {
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

const parsePlanningDateFields = (dateValue, timeValue, timeMode) => {
  if (!dateValue || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null
  }

  const suffix = timeMode === 'utc' ? 'Z' : ''
  const parsed = new Date(`${dateValue}T${timeValue}:00${suffix}`)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const buildPlanningWindowPreset = (timeMode = DEFAULT_PLANNING_TIME_MODE, start = new Date()) => {
  const end = new Date(start.getTime() + 60 * 60000)
  const startFields = formatPlanningDateFields(start, timeMode)
  const endFields = formatPlanningDateFields(end, timeMode)

  return {
    startDate: startFields.date,
    startTime: startFields.time,
    endDate: endFields.date,
    endTime: endFields.time,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

const DEFAULT_PLANNING_WINDOW_PRESET = buildPlanningWindowPreset()

export default function App() {
  const splitPanelsRef = useRef(null)
  const planningRowResizeDragCleanupRef = useRef(null)
  const topPanelsResizeDragCleanupRef = useRef(null)
  const splitDragCleanupRef = useRef(null)
  const timelineScrollRef = useRef(null)
  const timelineScrollFrameRef = useRef(null)
  const timelineLayoutKeyRef = useRef('')
  const timelineProgrammaticScrollRef = useRef(false)
  const timelinePlayheadSliderRef = useRef(null)
  const timelinePlaybackRafRef = useRef(null)
  const timelinePlaybackFrameTimestampRef = useRef(null)
  const timelinePlayheadTimeRef = useRef(null)
  const timelinePlaybackDomRef = useRef({ markers: [], bars: [], thumb: null, label: null })
  const timelinePlaybackLastTextSyncRef = useRef(0)
  const missionMapRef = useRef(null)
  const visibleMapAssetListRef = useRef(null)
  const tradeOffCardListRef = useRef(null)
  const timelinePanelRef = useRef(null)
  const timelineWheelHintRef = useRef(null)
  const timelineWheelHintTimeoutRef = useRef(null)
  const timelineWheelHandlerRef = useRef(null)
  const schedulerAbortControllerRef = useRef(null)
  const [assets, setAssets] = useState([])
  const [assetSchedules, setAssetSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [backendAlive, setBackendAlive] = useState(null)
  const [satosAlive, setSatosAlive] = useState(null)
  const [view, setView] = useState('landing')
  const [selectedSatellites, setSelectedSatellites] = useState([])
  const [selectedGroundStations, setSelectedGroundStations] = useState([])
  const [minimumLinkElevationFilterDeg, setMinimumLinkElevationFilterDeg] = useState('')
  const [minimumPeakElevationFilterDeg, setMinimumPeakElevationFilterDeg] = useState('')
  const [planningTimeMode, setPlanningTimeMode] = useState(DEFAULT_PLANNING_TIME_MODE)
  const [planningWindowStartDate, setPlanningWindowStartDate] = useState(DEFAULT_PLANNING_WINDOW_PRESET.startDate)
  const [planningWindowStartTime, setPlanningWindowStartTime] = useState(DEFAULT_PLANNING_WINDOW_PRESET.startTime)
  const [planningWindowEndDate, setPlanningWindowEndDate] = useState(DEFAULT_PLANNING_WINDOW_PRESET.endDate)
  const [planningWindowEndTime, setPlanningWindowEndTime] = useState(DEFAULT_PLANNING_WINDOW_PRESET.endTime)
  const [planningWindowResetPreset, setPlanningWindowResetPreset] = useState({
    startIso: DEFAULT_PLANNING_WINDOW_PRESET.startIso,
    endIso: DEFAULT_PLANNING_WINDOW_PRESET.endIso,
  })
  const [activeTimeMenu, setActiveTimeMenu] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [launchingScheduler, setLaunchingScheduler] = useState(false)
  const [schedulerLaunched, setSchedulerLaunched] = useState(false)
  const [overviewRows, setOverviewRows] = useState([])
  const [showUnavailableOverviewRows, setShowUnavailableOverviewRows] = useState(true)
  const [satelliteTracks, setSatelliteTracks] = useState({})
  const [orbitEngineRunId, setOrbitEngineRunId] = useState(null)
  const [propagationResult, setPropagationResult] = useState(null)
  const [propagationRequestKey, setPropagationRequestKey] = useState(null)
  const [filterRunId, setFilterRunId] = useState(null)
  const [filteredLinks, setFilteredLinks] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessionPlan, setSessionPlan] = useState(null)
  const [extractionStatus, setExtractionStatus] = useState('Not started')
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionMessages, setExtractionMessages] = useState([])
  const [calculatingTradeOffs, setCalculatingTradeOffs] = useState(false)
  const [tradeOffsCalculated, setTradeOffsCalculated] = useState(false)
  const [tradeOffCards, setTradeOffCards] = useState([])
  const [activeTradeOffCardIndex, setActiveTradeOffCardIndex] = useState(0)
  const [selectedTradeOffOption, setSelectedTradeOffOption] = useState({})
  const [warningTooltip, setWarningTooltip] = useState({
    visible: false,
    message: '',
    x: 0,
    y: 0,
  })
  const [overviewPanelWidth, setOverviewPanelWidth] = useState(58)
  // Which panel currently occupies which layout slot. The top row
  // (topLeft/topRight) sits side by side with a width-resizer between them;
  // the bottom column (bottomTop/bottomMiddle) is stacked with a
  // height-resizer between each pair.
  //
  // Every divider in this layout obeys the same rule: dragging it moves the
  // divider itself and resizes the panel BEFORE it (above for horizontal, left
  // for vertical). For that to hold, each slot that has a divider below it
  // needs an explicit pixel height -- a slot sized `auto` pins its own bottom
  // edge to its content, so its divider could never follow the pointer. Hence
  // bottomTop is pixel-sized and the last slot grows with its content.
  // Dragging a panel's handle onto another panel swaps their
  // slots, regardless of row — this does not persist across reloads.
  const [panelSlotAssignment, setPanelSlotAssignment] = useState(() => ({
    topLeft: 'overview',
    ...(TRADE_OFF_PANEL_ENABLED ? { topRight: 'tradeOff' } : {}),
    bottomTop: 'mapView',
    bottomMiddle: 'timeline',
  }))
  const [draggedPanelId, setDraggedPanelId] = useState(null)
  const [dragOverPanelId, setDragOverPanelId] = useState(null)
  // Height (px) of the bottomTop slot -- this is the whole panel's grid
  // row (heading + padding + content), not just its content area; the
  // bottomMiddle slot always flows naturally beneath it. 540px is 50%
  // taller again on top of the previous 360px default (itself 50% taller
  // than 240px, which was 50% taller than the original 160px default).
  const [bottomTopHeightPx, setBottomTopHeightPx] = useState(540)
  // Default buffer configuration sent to the backend session engine.
  const [dataStartFillGb, setDataStartFillGb] = useState(DEFAULT_DATA_START_FILL_GB)
  const [dataGenerationMbps, setDataGenerationMbps] = useState(DEFAULT_DATA_GENERATION_MBPS)
  const [dataCapacityGb, setDataCapacityGb] = useState(DEFAULT_DATA_CAPACITY_GB)
  const [dataDownlinkRateMbps, setDataDownlinkRateMbps] = useState(DEFAULT_DOWNLINK_RATE_MBPS)
  const [tradeOffStrategy, setTradeOffStrategy] = useState(DEFAULT_TRADE_OFF_STRATEGY)
  const [scoringAlpha, setScoringAlpha] = useState(DEFAULT_SCORING_ALPHA)
  const [scoringExponent, setScoringExponent] = useState(DEFAULT_SCORING_EXPONENT)
  // Shared height (px) of the top row (Overview/Trade-Off by default);
  // both panels stretch to this height and scroll their own content
  // internally. 346px is 60% of the panels' original fixed 36rem (576px)
  // height.
  const [topPanelsHeightPx, setTopPanelsHeightPx] = useState(346)
  const [confirmingSchedule, setConfirmingSchedule] = useState(false)
  const [confirmationProgress, setConfirmationProgress] = useState(0)
  const [confirmationStep, setConfirmationStep] = useState('')
  const [confirmationSuccess, setConfirmationSuccess] = useState(false)
  const [confirmedScheduleCount, setConfirmedScheduleCount] = useState(0)
  const [createdActivitiesCount, setCreatedActivitiesCount] = useState(0)
  const [overridingLinkId, setOverridingLinkId] = useState(null)
  const [activeMapAssetId, setActiveMapAssetId] = useState(null)
  const [showGroundStationVisibilityCircles, setShowGroundStationVisibilityCircles] = useState(true)
  const [showSatelliteVisibilityCircles, setShowSatelliteVisibilityCircles] = useState(true)
  const [showGroundTracks, setShowGroundTracks] = useState(true)
  const [groundTrackWindowHours, setGroundTrackWindowHours] = useState(6)
  const [activePlanningWindow, setActivePlanningWindow] = useState(null)
  const [timelineNow, setTimelineNow] = useState(() => Date.now())
  const [timelinePlayheadTime, setTimelinePlayheadTime] = useState(() => Date.now())
  const [timelineLive, setTimelineLive] = useState(true)
  const [timelinePlaying, setTimelinePlaying] = useState(false)
  const [timelinePlaybackSpeed, setTimelinePlaybackSpeed] = useState(1)
  const [timelineZoomLevel, setTimelineZoomLevel] = useState(TIMELINE_DEFAULT_ZOOM_LEVEL)
  const [timelineViewportWidthPx, setTimelineViewportWidthPx] = useState(0)
  // null means "use the preset multiplier from timelineZoomLevel"; a number
  // means the person has zoomed continuously with Ctrl/⌘ + scroll (mirroring
  // the map's Ctrl-gated wheel zoom) and that exact value overrides the
  // Fit/Detail preset until they click a preset button again.
  const [timelineCustomZoomMultiplier, setTimelineCustomZoomMultiplier] = useState(null)
  const [timelineLayers, setTimelineLayers] = useState({
    current: true,
    potential: true,
    proposed: true,
  })
  const [timelineAssetVisibility, setTimelineAssetVisibility] = useState({
    satellites: true,
    groundStations: true,
  })
  // Asset groups start collapsed: the header row already aggregates what is
  // scheduled for the asset, and selecting a trade-off expands exactly the
  // groups that matter (see the auto-expand effect below).
  const [expandedTimelineGroups, setExpandedTimelineGroups] = useState({})
  // The two section headers (Satellites / Ground Stations) collapse the whole
  // block. Unlike the asset groups these start OPEN -- collapsed sections would
  // leave the timeline showing nothing at all after the scheduler run.
  const [expandedTimelineSections, setExpandedTimelineSections] = useState({
    satellites: true,
    groundStations: true,
  })
  // Purely navigational: clicking a bar marks a link (both of its instances)
  // and scrolls the Trade-Off panel to the matching option. It never changes
  // selectedTradeOffOption -- the timeline shows and navigates, it does not decide.
  const [markedTimelineLinkId, setMarkedTimelineLinkId] = useState(null)
  const [markedTradeOffOptionId, setMarkedTradeOffOptionId] = useState(null)
  const [timelineTooltip, setTimelineTooltip] = useState({
    visible: false,
    pinned: false,
    item: null,
    x: 0,
    y: 0,
  })
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
    tradeOff: true,
    timeline: true,
  })

  const preparedSatelliteTracks = useMemo(() => Object.fromEntries(
    Object.entries(satelliteTracks).map(([assetName, points]) => [
      assetName,
      prepareTrackPoints(points),
    ]),
  ), [satelliteTracks])
  const timelineTooltipHideTimeoutRef = useRef(null)

  useEffect(() => {
    let active = true
    let intervalId = null
    let checkInFlight = false

    const fetchWithTimeout = async (url, options = {}, timeoutMs = 1500) => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    const checkConnections = async () => {
      if (checkInFlight) {
        return
      }

      checkInFlight = true

      try {
        const backendResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/status`, {
          cache: 'no-store',
        })
        if (!active) {
          return
        }

        if (backendResponse.ok) {
          setBackendAlive(true)

          try {
            const satosResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/satos/asset/list`, {
              cache: 'no-store',
            }, 1500)
            if (active) {
              setSatosAlive(satosResponse.ok)
            }
          } catch {
            if (active) {
              setSatosAlive(false)
            }
          }
        } else {
          setBackendAlive(false)
          setSatosAlive(null)
        }
      } catch {
        if (active) {
          setBackendAlive(false)
          setSatosAlive(null)
        }
      } finally {
        checkInFlight = false
      }
    }

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const startPolling = () => {
      if (
        intervalId !== null
        || view !== 'landing'
        || document.visibilityState !== 'visible'
      ) {
        return
      }

      intervalId = window.setInterval(checkConnections, 2000)
    }

    checkConnections()
    const handleVisibilityChange = () => {
      if (view !== 'landing') {
        stopPolling()
        return
      }

      if (document.visibilityState === 'visible') {
        checkConnections()
        startPolling()
      } else {
        stopPolling()
      }
    }

    startPolling()

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      stopPolling()
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [view])

  useEffect(() => () => {
    if (timelineTooltipHideTimeoutRef.current !== null) {
      window.clearTimeout(timelineTooltipHideTimeoutRef.current)
      timelineTooltipHideTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!schedulerLaunched || !timelineLive) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setTimelineNow(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [schedulerLaunched, timelineLive])

  useEffect(() => () => {
    if (splitDragCleanupRef.current) {
      splitDragCleanupRef.current()
    }
    if (planningRowResizeDragCleanupRef.current) {
      planningRowResizeDragCleanupRef.current()
    }
    if (topPanelsResizeDragCleanupRef.current) {
      topPanelsResizeDragCleanupRef.current()
    }
  }, [])

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      setConfirmationSuccess(false)
      setConfirmedScheduleCount(0)
      setCreatedActivitiesCount(0)
    })
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [selectedTradeOffOption, tradeOffsCalculated, schedulerLaunched])

  const toggleSatellite = (name) => {
    setSelectedSatellites((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  const toggleGroundStation = (name) => {
    setSelectedGroundStations((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

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

  const getEventTimestamp = (event) => {
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

  const getActivityStartTimestamp = (activity) =>
    getEventTimestamp(activity?.start_event)
    ?? getEventTimestamp(activity?.startEvent)
    ?? activity?.start_timestamp
    ?? activity?.startTimestamp
    ?? null

  const getActivityEndTimestamp = (activity) =>
    getEventTimestamp(activity?.end_event)
    ?? getEventTimestamp(activity?.endEvent)
    ?? activity?.end_timestamp
    ?? activity?.endTimestamp
    ?? null

  const toTimestamp = (value) => {
    if (!value) {
      return null
    }

    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  const formatDurationFromSeconds = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '—'
    }

    if (seconds < 60) {
      return `${Math.round(seconds)} sec`
    }

    return `${Math.round(seconds / 60)} min`
  }

  const getTimeZoneFormatOptions = (timeMode) =>
    timeMode === 'utc' ? { timeZone: 'UTC' } : {}

  const formatOverviewDateLabel = (date, timeMode) =>
    date.toLocaleDateString([], {
      day: '2-digit',
      month: 'short',
      ...getTimeZoneFormatOptions(timeMode),
    })

  const formatOverviewTimeLabel = (date, timeMode) =>
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })

  const getOverviewDayKey = (date, timeMode) =>
    formatPlanningDateFields(date, timeMode).date

  const getOverviewDayOffset = (startDate, endDate, timeMode) => {
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

  const formatOverviewStartDateTime = (
    value,
    timeMode = activePlanningWindow?.timeMode ?? planningTimeMode,
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

  const formatOverviewEndDateTime = (
    startValue,
    endValue,
    timeMode = activePlanningWindow?.timeMode ?? planningTimeMode,
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

  const formatElevation = (value) => {
    if (!Number.isFinite(value)) {
      return '—'
    }

    return `${value.toFixed(1)}°`
  }

  const buildCurrentScheduleItems = (schedules, relevantScheduleNames) => {
    const relevantNames = new Set(relevantScheduleNames)

    return schedules
      .filter((schedule) => relevantNames.size === 0 || relevantNames.has(schedule.name))
      .flatMap((schedule) =>
        (schedule.activities ?? []).map((activity, activityIndex) => {
          const startTime = getActivityStartTimestamp(activity)
          const endTime = getActivityEndTimestamp(activity)

          if (!startTime || !endTime) {
            return null
          }

          return {
            id: `current-${schedule.name}-${activity.uuid ?? activityIndex}`,
            activityUuid: activity.uuid ? String(activity.uuid) : null,
            label: activity.name?.trim() || 'Scheduled activity',
            detail: schedule.name,
            startTime,
            endTime,
          }
        })
      )
      .filter(Boolean)
      .sort((left, right) => {
        const leftTimestamp = toTimestamp(left.startTime) ?? 0
        const rightTimestamp = toTimestamp(right.startTime) ?? 0
        return leftTimestamp - rightTimestamp
      })
  }

  const getOverviewRowStatus = (row) => {
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

  const isUnavailableOverviewRow = (row) => getOverviewRowStatus(row) !== 'eligible'

  const shouldHideOverviewRowInAvailableMode = (row) => getOverviewRowStatus(row) === 'ineligible'

  const getOverviewDisplayLinkId = (row) => {
    if (getOverviewRowStatus(row) === 'ineligible') {
      return '—'
    }

    return row.backendLinkId ?? row.linkId ?? '—'
  }

  const getDayOfYear = (date, timeMode = DEFAULT_PLANNING_TIME_MODE) => {
    const useUtc = timeMode === 'utc'
    const year = useUtc ? date.getUTCFullYear() : date.getFullYear()
    const month = useUtc ? date.getUTCMonth() : date.getMonth()
    const day = useUtc ? date.getUTCDate() : date.getDate()
    const start = Date.UTC(year, 0, 0)
    const current = Date.UTC(year, month, day)
    return Math.floor((current - start) / 86400000)
  }

  const formatTimelineHour = (date, timeMode) =>
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })

  const formatTimelineDateTime = (
    value,
    timeMode = activePlanningWindow?.timeMode ?? planningTimeMode,
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

  const formatTimelinePlayheadDateTime = (
    value,
    timeMode = activePlanningWindow?.timeMode ?? planningTimeMode,
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

  const formatTimelineDuration = (startValue, endValue) => {
    const startTimestamp = toTimestamp(startValue)
    const endTimestamp = toTimestamp(endValue)

    if (
      startTimestamp === null
      || endTimestamp === null
      || endTimestamp <= startTimestamp
    ) {
      return '—'
    }

    const durationMinutes = Math.round((endTimestamp - startTimestamp) / 60000)
    if (durationMinutes < 60) {
      return `${durationMinutes} min`
    }

    const hours = Math.floor(durationMinutes / 60)
    const minutes = durationMinutes % 60
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
  }

  const formatTimelineDay = (date, timeMode) =>
    `${date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })} (DOY ${getDayOfYear(date, timeMode)})`

  const formatPlanningWindow = (startValue, endValue, timeMode = DEFAULT_PLANNING_TIME_MODE) => {
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

  const layoutTimelineItems = (items) => {
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

  const buildDayBands = (baseDate, totalMinutes, timeMode) => {
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

  // Timeline rows are asset-centric: one collapsible group per satellite and
  // per ground station, a header row per group that aggregates what is
  // actually scheduled for that asset, and one sub-row per counterpart it
  // actually has overpasses with. Every link therefore appears TWICE (once
  // under its satellite, once under its ground station); both instances share
  // a `linkId` so marking one marks the other.
  const buildTimelineModel = (rows, groups, currentScheduleItems, planningWindow) => {
    const timeMode = planningWindow?.timeMode ?? DEFAULT_PLANNING_TIME_MODE
    const optionByOverpassId = new Map(
      groups
        .flatMap((group) => group.options)
        .map((option) => [option.overpassId, option]),
    )

    // One bar per overpass instead of one bar per layer. With per-counterpart
    // rows a "potential" and a "proposed" copy of the same overpass would land
    // on the exact same pixels of the exact same row, so the layer toggles now
    // filter which KIND of bar is drawn rather than which track exists.
    const linkSourceItems = rows
      .map((row) => {
        const startTimestamp = toTimestamp(row.startTime)
        const endTimestamp = toTimestamp(row.endTime)

        if (
          startTimestamp === null
          || endTimestamp === null
          || endTimestamp <= startTimestamp
        ) {
          return null
        }

        const linkedOption = optionByOverpassId.get(row.overpassId)
        const hasTradeOff = Boolean(row.tradeOffId && row.tradeOffId !== '—')
        const partOfProposal = tradeOffsCalculated && row.isScheduled
        const dimmed = tradeOffsCalculated && hasTradeOff && !row.isScheduled

        let variant = 'neutral'
        if (row.scheduleBlocked) {
          variant = 'blocked'
        } else if (row.overrideState === 'excluded') {
          variant = 'excluded'
        } else if (row.overrideState === 'pinned') {
          variant = 'pinned'
        } else if (row.isScheduled) {
          variant = 'selected'
        } else if (hasTradeOff) {
          variant = 'candidate'
        } else if (tradeOffsCalculated) {
          variant = 'neutral'
        }

        return {
          kind: 'link',
          linkId: row.backendLinkId ?? row.linkId,
          overpassId: row.overpassId,
          satId: row.satId,
          gsId: row.gsId,
          label: row.backendLinkId ?? row.linkId,
          detail: hasTradeOff
            ? `${row.satId} → ${row.gsId} · ${row.tradeOffId}`
            : `${row.satId} → ${row.gsId}`,
          startTime: row.startTime,
          endTime: row.endTime,
          startTimestamp,
          endTimestamp,
          layer: partOfProposal ? 'proposed' : 'potential',
          variant,
          dimmed,
          blocked: Boolean(row.scheduleBlocked),
          blockMessage: row.scheduleBlocked
            ? row.rejectionReason
            : null,
          tradeOffId: hasTradeOff ? row.tradeOffId : null,
          tradeOffGroupId: linkedOption?.tradeOffGroupId ?? (hasTradeOff ? row.tradeOffId : null),
          tradeOffColorIndex: row.tradeOffColorIndex ?? null,
          optionId: linkedOption?.optionId ?? null,
          isSchedulable: getOverviewRowStatus(row) === 'eligible',
          isScheduled: Boolean(row.isScheduled),
          recommended: row.isScheduled && row.overrideState === 'auto',
          overrideState: row.overrideState,
          usefulDataOffloadedMb: row.usefulDataOffloadedMb,
          score: row.score,
          rejectionReason: row.rejectionReason,
        }
      })
      .filter(Boolean)

    const blockedRows = rows.filter((row) => row.scheduleBlocked)
    const currentSourceItems = currentScheduleItems
      .map((item) => {
        const startTimestamp = toTimestamp(item.startTime)
        const endTimestamp = toTimestamp(item.endTime)

        if (
          startTimestamp === null
          || endTimestamp === null
          || endTimestamp <= startTimestamp
        ) {
          return null
        }

        // A SatOS activity that pushes an overpass out of the plan is drawn in
        // the asset's header row as a blocking bar -- that is the red bar in
        // the agreed layout sketch.
        const blocking = blockedRows.some(
          (row) => row.conflictingActivityUuid && row.conflictingActivityUuid === item.activityUuid,
        )

        return {
          kind: 'activity',
          id: item.id,
          linkId: null,
          assetName: item.detail,
          label: item.label,
          detail: item.detail,
          startTime: item.startTime,
          endTime: item.endTime,
          startTimestamp,
          endTimestamp,
          layer: 'current',
          variant: blocking ? 'blocking' : 'current',
          dimmed: false,
          blocked: false,
          blockMessage: null,
          tradeOffId: null,
          tradeOffScore: null,
          tradeOffColorIndex: null,
          optionId: null,
          recommended: false,
        }
      })
      .filter(Boolean)

    const planningStartTimestamp = toTimestamp(planningWindow?.startTime)
    const planningEndTimestamp = toTimestamp(planningWindow?.endTime)

    const clampTimelineItemToWindow = (item) => {
      const clampedStartTimestamp = planningStartTimestamp !== null
        ? Math.max(item.startTimestamp, planningStartTimestamp)
        : item.startTimestamp
      const clampedEndTimestamp = planningEndTimestamp !== null
        ? Math.min(item.endTimestamp, planningEndTimestamp)
        : item.endTimestamp

      if (clampedEndTimestamp <= clampedStartTimestamp) {
        return null
      }

      return {
        ...item,
        startTimestamp: clampedStartTimestamp,
        endTimestamp: clampedEndTimestamp,
        startTime: new Date(clampedStartTimestamp).toISOString(),
        endTime: new Date(clampedEndTimestamp).toISOString(),
      }
    }

    const clampedLinkItems = linkSourceItems
      .map(clampTimelineItemToWindow)
      .filter(Boolean)
    const clampedCurrentItems = currentSourceItems
      .map(clampTimelineItemToWindow)
      .filter(Boolean)
    const allTimestampItems = [...clampedCurrentItems, ...clampedLinkItems]

    if (
      allTimestampItems.length === 0
      && (planningStartTimestamp === null || planningEndTimestamp === null)
    ) {
      return null
    }

    const minTimestamp = allTimestampItems.length > 0
      ? Math.min(...allTimestampItems.map((item) => item.startTimestamp))
      : planningStartTimestamp
    const maxTimestamp = allTimestampItems.length > 0
      ? Math.max(...allTimestampItems.map((item) => item.endTimestamp))
      : planningEndTimestamp
    const baseTimestamp = planningStartTimestamp ?? (minTimestamp - 30 * 60000)
    const endTimestamp = planningEndTimestamp ?? (maxTimestamp + 30 * 60000)
    // When an explicit planning window is active, use its exact (possibly
    // fractional) duration in minutes instead of flooring/padding it. The
    // playhead slider above the timeline positions itself as a fraction of
    // planningWindowStartTimestamp/EndTimestamp directly, while the marker
    // line drawn inside the scrollable canvas positions itself as a
    // fraction of this totalMinutes value -- if totalMinutes were rounded
    // up (Math.ceil) or padded out to a 60-minute floor, the two would be
    // computing their percentage against slightly different spans and the
    // timestamp label and its line would visibly drift apart, worse the
    // shorter the actual planning window is. Only fall back to the
    // floor/rounding when there's no explicit window to derive exact
    // bounds from (the timeline is instead sized to whatever schedule data
    // happens to exist, padded with a 30-minute margin).
    const totalMinutes = (planningStartTimestamp !== null && planningEndTimestamp !== null)
      ? Math.max(1, (endTimestamp - baseTimestamp) / 60000)
      : Math.max(60, Math.ceil((endTimestamp - baseTimestamp) / 60000))
    const baseDate = new Date(baseTimestamp)

    const mapToTimelineItem = (item) => ({
      ...item,
      startMinutes: (item.startTimestamp - baseTimestamp) / 60000,
      durationMinutes: Math.max(1 / 60, (item.endTimestamp - item.startTimestamp) / 60000),
    })

    const layerVisible = (layer) => timelineLayers[layer] !== false
    const visibleLinkItems = clampedLinkItems.filter((item) => layerVisible(item.layer))
    const visibleActivityItems = clampedCurrentItems.filter(() => layerVisible('current'))

    const satelliteNames = [...new Set([
      ...rows.map((row) => row.satId),
      ...clampedCurrentItems
        .filter((item) => selectedSatellites.includes(item.assetName))
        .map((item) => item.assetName),
    ].filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))

    const groundStationNames = [...new Set([
      ...rows.map((row) => row.gsId),
      ...clampedCurrentItems
        .filter((item) => selectedGroundStations.includes(item.assetName))
        .map((item) => item.assetName),
    ].filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))

    const buildAssetGroup = (kind, assetName) => {
      const ownLinkItems = visibleLinkItems.filter(
        (item) => (kind === 'satellite' ? item.satId : item.gsId) === assetName,
      )
      const counterpartOf = (item) => (kind === 'satellite' ? item.gsId : item.satId)

      // Q15: a sub-row exists only for counterparts with at least one overpass
      // in the planning window -- a full cross product of every selected
      // satellite against every selected ground station would be mostly blank.
      const counterpartNames = [...new Set(ownLinkItems.map(counterpartOf).filter(Boolean))]
        .sort((left, right) => String(left).localeCompare(String(right)))

      const headerSource = [
        ...visibleActivityItems.filter((item) => item.assetName === assetName),
        // Q7/Q11: the header aggregates what is actually scheduled for this
        // asset, so a collapsed group still tells the truth.
        ...ownLinkItems.filter((item) => item.layer === 'proposed'),
      ]
      const headerLayout = layoutTimelineItems(headerSource.map(mapToTimelineItem))

      const assetRows = counterpartNames.map((counterpartName) => {
        const rowItems = ownLinkItems.filter((item) => counterpartOf(item) === counterpartName)
        const layout = layoutTimelineItems(rowItems.map(mapToTimelineItem))

        return {
          id: `${kind}:${assetName}|${counterpartName}`,
          counterpartName,
          label: `${assetName} – ${counterpartName}`,
          laneCount: layout.laneCount,
          items: layout.items.map((item) => ({
            ...item,
            id: `${kind}:${assetName}|${counterpartName}|${item.linkId}`,
          })),
          containsSelected: rowItems.some((item) => item.variant === 'selected'),
        }
      })

      return {
        id: `${kind}:${assetName}`,
        kind,
        name: assetName,
        label: assetName,
        laneCount: headerLayout.laneCount,
        items: headerLayout.items.map((item) => ({
          ...item,
          id: `${kind}:${assetName}|header|${item.linkId ?? item.id}`,
        })),
        rows: assetRows,
        linkCount: assetRows.length,
      }
    }

    const satelliteGroups = satelliteNames.map((name) => buildAssetGroup('satellite', name))
    const groundStationGroups = groundStationNames.map((name) => buildAssetGroup('ground_station', name))

    const ticks = Array.from({ length: Math.floor(totalMinutes / 60) + 2 }, (_, index) => {
      const offsetMinutes = index * 60
      const tickDate = new Date(baseDate.getTime() + offsetMinutes * 60000)
      return {
        offsetMinutes,
        date: tickDate,
        label: formatTimelineHour(tickDate, timeMode),
      }
    }).filter((tick) => tick.offsetMinutes <= totalMinutes)

    return {
      baseDate,
      endDate: new Date(baseDate.getTime() + totalMinutes * 60000),
      totalMinutes,
      widthPx: Math.max(980, totalMinutes * 2.2),
      ticks,
      dayBands: buildDayBands(baseDate, totalMinutes, timeMode),
      sections: [
        timelineAssetVisibility.satellites
          ? { id: 'satellites', label: 'Satellites', groups: satelliteGroups }
          : null,
        timelineAssetVisibility.groundStations
          ? { id: 'groundStations', label: 'Ground Stations', groups: groundStationGroups }
          : null,
      ].filter(Boolean),
      hasVisibleItems: visibleLinkItems.length > 0 || visibleActivityItems.length > 0,
    }
  }

  const normalizeAssetClassification = (asset) => {
    if (asset.classification === 'satellite') {
      return 'satellite'
    }

    if (asset.classification === 'groundstation' || asset.classification === 'ground_station') {
      return 'ground_station'
    }

    if (asset.classification === 'ineligible' || asset.eligible === false) {
      return 'ineligible'
    }

    return asset.classification ?? 'unknown'
  }

  const resetWorkspaceState = () => {
    const planningWindowPreset = buildPlanningWindowPreset()

    setSelectedSatellites([])
    setSelectedGroundStations([])
    setMinimumLinkElevationFilterDeg('')
    setMinimumPeakElevationFilterDeg('')
    setPlanningTimeMode(DEFAULT_PLANNING_TIME_MODE)
    setPlanningWindowStartDate(planningWindowPreset.startDate)
    setPlanningWindowStartTime(planningWindowPreset.startTime)
    setPlanningWindowEndDate(planningWindowPreset.endDate)
    setPlanningWindowEndTime(planningWindowPreset.endTime)
    setPlanningWindowResetPreset({
      startIso: planningWindowPreset.startIso,
      endIso: planningWindowPreset.endIso,
    })
    setActiveTimeMenu(null)
    setSidebarCollapsed(false)
    setLaunchingScheduler(false)
    setSchedulerLaunched(false)
    setOverviewRows([])
    setShowUnavailableOverviewRows(true)
    setSatelliteTracks({})
    setOrbitEngineRunId(null)
    setPropagationResult(null)
    setPropagationRequestKey(null)
    setFilterRunId(null)
    setFilteredLinks([])
    setSessionId(null)
    setSessionPlan(null)
    setExtractionStatus('Not started')
    setExtractionProgress(0)
    setExtractionMessages([])
    setCalculatingTradeOffs(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption({})
    setActiveMapAssetId(null)
    setActivePlanningWindow(null)
    setTimelineNow(Date.now())
    setTimelinePlayheadTime(Date.now())
    setTimelineLive(true)
    setTimelinePlaying(false)
    setTimelinePlaybackSpeed(1)
    setTimelineZoomLevel(TIMELINE_DEFAULT_ZOOM_LEVEL)
    setExpandedTimelineGroups({})
    setExpandedTimelineSections({ satellites: true, groundStations: true })
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    setTimelineLayers({
      current: true,
      potential: true,
      proposed: true,
    })
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
      tradeOff: true,
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
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setCreatedActivitiesCount(0)
    setOverridingLinkId(null)
  }

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
    const presetDate = new Date(presetValue)

    if (target === 'start') {
      setPlanningStartFromDate(presetDate)
    } else {
      setPlanningEndFromDate(presetDate)
    }
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

  const fetchAssets = async () => {
    setLoading(true)
    setError(null)
    setAssets([])
    setAssetSchedules([])
    resetWorkspaceState()
    try {
      const data = await initializeAssets()
      if (data && Array.isArray(data.assets)) {
        setSatosAlive(true)
        setAssets(data.assets)
        setAssetSchedules(Array.isArray(data.schedules) ? data.schedules : [])
      } else {
        throw new Error("Invalid response format from server")
      }
    } catch (err) {
      console.error(err)
      setSatosAlive(false)
      setError(err.message || 'Failed to fetch assets. Verify your backend or SatOS credentials.')
    } finally {
      setLoading(false)
    }
  }

  const appendTaskStatus = (taskStatus, stageLabel, progressStart = 0, progressSpan = 100) => {
    setExtractionStatus(`${stageLabel}: ${formatTaskStatusLabel(taskStatus.status)}`)
    const taskProgress = Number.isFinite(taskStatus.progress) ? taskStatus.progress : 0
    setExtractionProgress(Math.round(progressStart + (taskProgress / 100) * progressSpan))

    if (taskStatus.message) {
      setExtractionMessages((current) => {
        const text = `${stageLabel}: ${taskStatus.message}`
        if (current[current.length - 1]?.text === text) {
          return current
        }
        return [
          ...current,
          {
            id: `${stageLabel}-${taskStatus.status}-${taskStatus.progress ?? 0}-${current.length}`,
            text,
          },
        ]
      })
    }
  }

  const formatFilteredRows = (links) => buildRowsFromFilteredLinks(links).map((row) => ({
    ...row,
    duration: formatDurationFromSeconds(row.durationSeconds),
    maxElevation: formatElevation(row.maxElevationDeg),
    tradeOffColorIndex: null,
  }))

  const handleLaunchScheduler = async () => {
    if (!launchRequirementsMet) return false

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

    setLaunchingScheduler(true)
    setError(null)
    setExtractionStatus('Queued')
    setExtractionProgress(0)
    setExtractionMessages([
      {
        id: `queued-${timelineNow}`,
        text: 'Task queued. Waiting for backend processing to start.',
      },
    ])
    setOverviewRows([])
    if (!canReusePropagation) {
      setSatelliteTracks({})
      setOrbitEngineRunId(null)
      setPropagationResult(null)
      setPropagationRequestKey(null)
    }
    setFilterRunId(null)
    setFilteredLinks([])
    setSessionId(null)
    setSessionPlan(null)
    setSchedulerLaunched(true)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption({})
    setExpandedTimelineGroups({})
    setExpandedTimelineSections({ satellites: true, groundStations: true })
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setCreatedActivitiesCount(0)
    const schedulerLaunchTime = timelineNow
    setTimelineNow(schedulerLaunchTime)
    setTimelinePlayheadTime(schedulerLaunchTime)
    setTimelineLive(true)
    setTimelinePlaying(false)
    setSidebarCollapsed(true)

    setActivePlanningWindow(planningWindow)

    const abortController = new AbortController()
    schedulerAbortControllerRef.current = abortController

    try {
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
        setExtractionStatus('Filtering: Queued')
        setExtractionProgress(65)
        setExtractionMessages([
          { id: `propagation-reused-${nextOrbitEngineRunId}`, text: 'Propagation: Reusing the current orbit-engine result.' },
        ])
      }

      activeBackendStage = 'Filtering'
      setExtractionMessages((current) => [
        ...current,
        { id: `filter-queued-${nextOrbitEngineRunId}`, text: 'Filtering: Task queued.' },
      ])

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
      setExtractionStatus('Completed')
      setExtractionProgress(100)
      return true
    } catch (err) {
      const wasTerminated = err?.name === 'AbortError'
      if (!wasTerminated) {
        console.error(err)
      }
      setOverviewRows([])
      setFilterRunId(null)
      setFilteredLinks([])
      setSessionId(null)
      setSessionPlan(null)
      setActivePlanningWindow(null)
      setSchedulerLaunched(false)
      setSidebarCollapsed(false)
      setExtractionStatus(wasTerminated ? 'Stopped waiting' : 'Failed')
      if (!completedPropagationResult) {
        setSatelliteTracks({})
        setOrbitEngineRunId(null)
        setPropagationResult(null)
        setPropagationRequestKey(null)
      }
      setError(wasTerminated ? null : (err.message || `${activeBackendStage} failed in the backend.`))
      return false
    } finally {
      schedulerAbortControllerRef.current = null
      setLaunchingScheduler(false)
    }
  }

  const handleLoadScope = async () => {
    if (loadScopeDisabled) {
      return
    }

    setError(null)
    const schedulerStarted = await handleLaunchScheduler()

    if (schedulerStarted) {
      setSchedulerLaunched(true)
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

    setSessionPlan(plan)
    setSessionId(plan.session_id)
    setFilterRunId(plan.filter_run_id)
    setOverviewRows(nextRows)
    setTradeOffCards(nextCards)
    setSelectedTradeOffOption(buildSelectedOptionsFromPlan(plan))
    setActiveTradeOffCardIndex(0)
    setTradeOffsCalculated(true)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setCreatedActivitiesCount(0)
    if (focusTimeline) {
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

    setCalculatingTradeOffs(true)
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
      setError(err.message || 'Failed to create the backend scheduling session.')
    } finally {
      setCalculatingTradeOffs(false)
    }
  }

  const handleConfirmSchedule = async () => {
    if (!sessionId || finalScheduleRows.length === 0 || confirmingSchedule) {
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
      const result = await commitSession(sessionId)
      setConfirmationProgress(100)
      setConfirmationStep('Communication schedule confirmed.')
      setConfirmationSuccess(true)
      setConfirmedScheduleCount(result.committed_links_count ?? 0)
      setCreatedActivitiesCount(result.created_activities_count ?? 0)

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
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-title">SCOPE</div>
        <div className="app-header-subtitle">Satellite Communication Optimizer and Planning Engine</div>
      </div>
      <div className="app-header-controls">
        {showStatus && (
          <div className="app-header-status">
            <div className="app-status-stack">
              <div className={`app-status app-status--${backendStatusClass}`}>
                <span className="app-status-dot" aria-hidden="true"></span>
                <span className="app-status-label">{backendStatusLabel}</span>
              </div>
              <div className={`app-status app-status--${satosStatusClass}`}>
                <span className="app-status-dot" aria-hidden="true"></span>
                <span className="app-status-label">{satosStatusLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )

  const satelliteAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'satellite'),
    [assets],
  )
  const groundStationAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'ground_station'),
    [assets],
  )
  const unavailableAssets = useMemo(
    () => assets.filter((asset) => normalizeAssetClassification(asset) === 'ineligible'),
    [assets],
  )
  const missionAssetsLoaded = assets.length > 0
  const parseOptionalDegreeInput = (value) => {
    if (value.trim() === '') {
      return null
    }

    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  const minimumLinkElevationFilterValue = parseOptionalDegreeInput(minimumLinkElevationFilterDeg)
  const minimumPeakElevationFilterValue = parseOptionalDegreeInput(minimumPeakElevationFilterDeg)
  const linkFiltersValid = [minimumLinkElevationFilterValue, minimumPeakElevationFilterValue].every((value) => (
    value === null || (!Number.isNaN(value) && value >= 0 && value <= 90)
  ))
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
  const planningWindowComplete =
    planningWindowStartDate !== ''
    && planningWindowStartTime !== ''
    && planningWindowEndDate !== ''
    && planningWindowEndTime !== ''
  const planningWindowValid =
    planningWindowComplete
    && planningDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime)
    && planningDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime)
    && new Date(planningDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime)) > new Date(planningDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime))
  const launchRequirementsMet =
    planningWindowValid
    && selectedSatellites.length >= 1
    && selectedGroundStations.length >= 1
    && linkFiltersValid
    && bufferConfigValid
    && tradeOffConfigValid
  const loadMissionAssetsDisabled = loading || launchingScheduler || backendAlive !== true
  const loadScopeDisabled =
    loading
    || launchingScheduler
    || !missionAssetsLoaded
    || !launchRequirementsMet
  const loadScopeDisabledReason =
    loading
      ? 'Wait until the current request is finished.'
      : launchingScheduler
        ? 'SCOPE is currently starting.'
        : !missionAssetsLoaded
          ? 'Load SatOS mission data first to enable filtering.'
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
  const timelinePlayheadTimestamp = clampToPlanningWindow(
    timelineLive ? timelineNow : timelinePlayheadTime,
  )

  const getSatelliteTrackCoordinates = useCallback((assetName) => (
    interpolateTrackPosition(preparedSatelliteTracks[assetName], timelinePlayheadTimestamp)
  ), [preparedSatelliteTracks, timelinePlayheadTimestamp])

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
  }, [])

  const currentScheduleItems = useMemo(() => buildCurrentScheduleItems(
    assetSchedules,
    [...selectedSatellites, ...selectedGroundStations],
  // The builder is declared in App because the existing SatOS parsing helpers
  // are scoped here; its data dependencies are fully listed below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const getOverviewControlTooltip = (state) => {
    if (state === 'auto') {
      return 'Auto: keep the backend scheduling decision.'
    }

    if (state === 'pinned') {
      return 'Pinned: force this link to stay scheduled.'
    }

    return 'Excluded: force this link to stay unscheduled.'
  }
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
  const finalScheduleRows = getScheduledRows(overviewRows)
  const confirmScheduleAvailable =
    Boolean(sessionId)
    && schedulerLaunched
    && tradeOffsCalculated
    && finalScheduleRows.length > 0
  const timelineModel = useMemo(() => buildTimelineModel(
    overviewRows,
    tradeOffCards,
    currentScheduleItems,
    activePlanningWindow,
  // buildTimelineModel closes over the UI filters listed in the dependency
  // array; keeping the builder scoped to App avoids duplicating formatters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [
    activePlanningWindow,
    currentScheduleItems,
    overviewRows,
    selectedGroundStations,
    selectedSatellites,
    timelineAssetVisibility,
    selectedTradeOffOption,
    timelineLayers,
    tradeOffCards,
    tradeOffsCalculated,
  ])
  const timelineZoomMultiplier = timelineCustomZoomMultiplier ?? 1
  const timelineFitWidthPx = timelineViewportWidthPx > 0
    ? timelineViewportWidthPx
    : timelineModel?.widthPx ?? 0
  const timelineWidthPx = timelineModel
    ? Math.max(1, Math.round(timelineFitWidthPx * timelineZoomMultiplier))
    : 0
  const timelineIsFit = timelineZoomMultiplier <= TIMELINE_MIN_ZOOM_MULTIPLIER
  const focusedTimelineTradeOffId = useMemo(() => {
    if (!markedTimelineLinkId) {
      return null
    }

    return tradeOffCards.find((card) => (
      card.options.some((option) => option.linkId === markedTimelineLinkId)
    ))?.id ?? null
  }, [markedTimelineLinkId, tradeOffCards])
  const timelineSections = useMemo(
    () => (timelineModel?.sections ?? []).filter((section) => section.groups.length > 0),
    [timelineModel],
  )
  // A single flat row list drives BOTH the label column and the scrollable
  // canvas, so the two halves of the grid cannot drift apart vertically.
  const baseTimelineRenderRows = useMemo(() => timelineSections.flatMap((section) => {
    const sectionRenderRow = {
      type: 'section',
      key: `section-${section.id}`,
      section,
      label: section.label,
    }

    if (!expandedTimelineSections[section.id]) {
      return [sectionRenderRow]
    }

    return [
      sectionRenderRow,
      ...section.groups.flatMap((group) => {
        const groupRenderRow = { type: 'group', key: `group-${group.id}`, group }

        if (!expandedTimelineGroups[group.id]) {
          return [groupRenderRow]
        }

        return [
          groupRenderRow,
          ...group.rows.map((row) => ({ type: 'link', key: `link-${row.id}`, group, row })),
        ]
      }),
    ]
  }), [expandedTimelineGroups, expandedTimelineSections, timelineSections])

  // --- Data Volume -----------------------------------------------------
  // Curves and KPIs are rendered from the authoritative backend session
  // profiles. The frontend only converts units and positions returned points.
  const dataVolumeModel = useMemo(() => {
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
  }, [
    expandedTimelineGroups,
    expandedTimelineSections.satellites,
    finalScheduleRows,
    sessionPlan,
    timelineModel,
  ])

  const dataVolumeSeriesByGroupId = useMemo(
    () => new Map((dataVolumeModel?.series ?? []).map((series) => [series.id, series])),
    [dataVolumeModel],
  )

  // Expanded satellites render their data budget immediately below the main
  // asset/schedule row and before the counterpart link rows. Ground stations
  // do not get a synthetic data row because the backend profiles are owned by
  // satellites.
  const timelineRenderRows = useMemo(() => baseTimelineRenderRows.flatMap((renderRow) => {
    if (
      renderRow.type !== 'group'
      || renderRow.group.kind !== 'satellite'
      || !expandedTimelineGroups[renderRow.group.id]
    ) {
      return [renderRow]
    }

    return [
      renderRow,
      {
        type: 'dataVolume',
        key: `data-volume-${renderRow.group.id}`,
        group: renderRow.group,
        series: dataVolumeSeriesByGroupId.get(renderRow.group.id) ?? null,
      },
    ]
  }), [baseTimelineRenderRows, dataVolumeSeriesByGroupId, expandedTimelineGroups])

  // Expanding a group changes the row count but nothing about the horizontal
  // scale, so scroll recentering keys off whether any rows exist at all.
  const timelineHasRows = timelineRenderRows.length > 0

  useLayoutEffect(() => {
    const frame = timelineScrollFrameRef.current
    if (!frame || !expandedSections.timeline || !timelineHasRows) {
      return undefined
    }

    const updateViewportWidth = () => {
      const nextWidth = Math.floor(frame.clientWidth)
      if (nextWidth > 0) {
        setTimelineViewportWidthPx((current) => (current === nextWidth ? current : nextWidth))
      }
    }

    updateViewportWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportWidth)
      return () => window.removeEventListener('resize', updateViewportWidth)
    }

    const observer = new ResizeObserver(updateViewportWidth)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [expandedSections.timeline, timelineHasRows, view])

  const getTimelineRowHeight = (renderRow) => {
    if (renderRow.type === 'section') {
      return '1.85rem'
    }

    if (renderRow.type === 'dataVolume') {
      return '7.2rem'
    }

    const laneCount = renderRow.type === 'group'
      ? renderRow.group.laneCount
      : renderRow.row.laneCount

    if (renderRow.type === 'group') {
      return `${Math.max(4.3, (laneCount ?? 1) * 3.1 + 0.82)}rem`
    }

    return `${Math.max(3.0, (laneCount ?? 1) * 2.36 + 0.42)}rem`
  }

  const dataVolumeYMaxGb = (dataVolumeModel?.capacityGb ?? 1) * 1.06

  const buildDataVolumePolyline = (points) => {
    if (!dataVolumeModel || points.length === 0) {
      return ''
    }

    return points
      .map((point) => {
        const x = ((point.timestamp - dataVolumeModel.startTimestamp) / dataVolumeModel.durationMs) * 1000
        const y = 100 - ((point.level / dataVolumeYMaxGb) * 100)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
  }

  const timelineBaseTimestamp = timelineModel?.baseDate.getTime() ?? null
  const timelineDurationMs = timelineModel ? timelineModel.totalMinutes * 60000 : 0
  const timelinePlayheadOffsetMinutes = timelineBaseTimestamp !== null
    ? (timelinePlayheadTimestamp - timelineBaseTimestamp) / 60000
    : null
  const timelinePlayheadWindowRatio = (
    planningWindowStartTimestamp !== null
    && planningWindowEndTimestamp !== null
    && planningWindowEndTimestamp > planningWindowStartTimestamp
  )
    ? Math.max(0, Math.min(1, (
      (timelinePlayheadTimestamp - planningWindowStartTimestamp)
      / (planningWindowEndTimestamp - planningWindowStartTimestamp)
    )))
    : null

  const refreshTimelinePlaybackDom = () => {
    const root = splitPanelsRef.current
    if (!root) {
      timelinePlaybackDomRef.current = { markers: [], bars: [], thumb: null, label: null }
      return
    }

    timelinePlaybackDomRef.current = {
      markers: [...root.querySelectorAll('[data-timeline-playhead]')],
      bars: [...root.querySelectorAll('[data-playback-start][data-playback-end]')],
      thumb: root.querySelector('[data-playback-thumb]'),
      label: root.querySelector('[data-playback-label]'),
    }
  }

  const syncTimelinePlaybackDom = (timestamp, syncText = false) => {
    if (!Number.isFinite(timestamp)) {
      return
    }

    const { markers, bars, thumb, label } = timelinePlaybackDomRef.current
    const timelineRatio = (
      timelineBaseTimestamp !== null
      && timelineDurationMs > 0
    )
      ? (timestamp - timelineBaseTimestamp) / timelineDurationMs
      : null
    const windowRatio = (
      planningWindowStartTimestamp !== null
      && planningWindowEndTimestamp !== null
      && planningWindowEndTimestamp > planningWindowStartTimestamp
    )
      ? (timestamp - planningWindowStartTimestamp)
        / (planningWindowEndTimestamp - planningWindowStartTimestamp)
      : null

    markers.forEach((marker) => {
      const visible = timelineRatio !== null && timelineRatio >= 0 && timelineRatio <= 1
      marker.hidden = !visible
      if (visible) {
        marker.style.left = `${timelineRatio * 100}%`
      }
    })

    if (thumb && windowRatio !== null) {
      thumb.style.left = `${Math.max(0, Math.min(1, windowRatio)) * 100}%`
      const slider = timelinePlayheadSliderRef.current
      slider?.setAttribute('aria-valuenow', String(Math.round(timestamp)))
    }

    bars.forEach((bar) => {
      const startTimestamp = Number(bar.dataset.playbackStart)
      const endTimestamp = Number(bar.dataset.playbackEnd)
      bar.classList.toggle(
        'timeline-bar--playhead-active',
        Number.isFinite(startTimestamp)
          && Number.isFinite(endTimestamp)
          && timestamp >= startTimestamp
          && timestamp <= endTimestamp,
      )
    })

    if (syncText && label) {
      const formatted = formatTimelinePlayheadDateTime(timestamp)
      label.textContent = formatted
      timelinePlayheadSliderRef.current?.setAttribute('aria-valuetext', formatted)
    }

    missionMapRef.current?.setPlayheadTime(timestamp)
  }

  // `.timeline-time-canvas` (the scrollable/zoomable element holding the
  // day bands, ticks, schedule blocks and the playhead marker line) is
  // deliberately given `padding-inline: 50%` -- half a viewport's width of
  // blank space on each side -- so the very first/last moments of the
  // window can still be scrolled into the center of the viewport instead
  // of being stuck against the hard edge. That padding shifts where a
  // percentage-based `left` on its children actually lands on screen: a
  // child at `left: r*100%` renders at
  //   (canvas's own left edge, post-scroll) + halfViewportWidth + r*timelineWidthPx
  // The separate playhead slider/thumb above (see the CSS comment on
  // .timeline-playhead-slider) has no such padding -- it renders at
  // `frameLeft + r*viewportWidth`. Setting scrollLeft to just
  // `r*timelineWidthPx` (pinning the target pixel to the viewport's left
  // edge) ignores that half-viewport padding entirely, so the line and the
  // thumb would land up to a whole extra half-viewport-width apart. Adding
  // that same halfViewportWidth term back into scrollLeft, and scaling the
  // rest by (timelineWidthPx - viewportWidth) so scrollLeft still reaches
  // exactly its native [0, canvas scroll max] range, is what makes the two
  // line up at any ratio, zoom level, or viewport size -- not just at the
  // very start of the window.
  const getTimelineScrollLeftForRatio = (ratio) => {
    const viewportWidthPx = timelineScrollRef.current?.clientWidth ?? 0
    return ratio * Math.max(0, timelineWidthPx - viewportWidthPx)
  }

  const getTimelineScrollLeftForTimestamp = (timestamp) => {
    if (timelineBaseTimestamp === null || timelineDurationMs <= 0 || timelineWidthPx <= 0) {
      return 0
    }

    const ratio = Math.max(
      0,
      Math.min(1, (timestamp - timelineBaseTimestamp) / timelineDurationMs),
    )
    return getTimelineScrollLeftForRatio(ratio)
  }

  const scrollTimelineToTimestamp = (timestamp, behavior = 'auto') => {
    timelineProgrammaticScrollRef.current = true
    timelineScrollRef.current?.scrollTo({
      left: getTimelineScrollLeftForTimestamp(timestamp),
      behavior,
    })
    window.requestAnimationFrame(() => {
      timelineProgrammaticScrollRef.current = false
    })
  }

  const syncTimelinePlaybackViewport = (timestamp) => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer) {
      return
    }

    scrollContainer.scrollLeft = getTimelineScrollLeftForTimestamp(timestamp)
  }

  const pauseTimelineLiveMode = (event) => {
    if (!event?.target?.closest?.('button')) {
      setTimelineLive(false)
    }
  }

  // Punkt 5: moving to a trade-off card opens every asset group involved in
  // it -- including the ground stations of the options that were NOT chosen,
  // because that comparison is the whole point of the card -- and scrolls the
  // timeline to the relevant time. It never auto-collapses (that would hide
  // bars the user is mid-comparison on) and never touches the zoom, which is
  // user-owned. Expanding overrides a manual collapse on purpose: the card is
  // asking you to look at exactly these assets.
  const focusTimelineOnTradeOffCard = (card) => {
    if (!card) {
      return
    }

    setExpandedTimelineSections((current) => (
      (current.satellites && current.groundStations)
        ? current
        : { satellites: true, groundStations: true }
    ))

    setExpandedTimelineGroups((current) => {
      let changed = false
      const next = { ...current }

      card.options.forEach((option) => {
        const groupIds = [
          option.satId ? `satellite:${option.satId}` : null,
          option.gsId ? `ground_station:${option.gsId}` : null,
        ].filter(Boolean)

        groupIds.forEach((groupId) => {
          if (!next[groupId]) {
            next[groupId] = true
            changed = true
          }
        })
      })

      return changed ? next : current
    })

    const startTimestamps = card.options
      .map((option) => toTimestamp(option.startTime))
      .filter((value) => value !== null)

    if (startTimestamps.length === 0) {
      return
    }

    const targetTimestamp = Math.min(...startTimestamps)
    // The rows above/below only change height after the expansion renders, and
    // the scroll container has to exist first when this runs straight after
    // the trade-off calculation.
    window.requestAnimationFrame(() => scrollTimelineToTimestamp(targetTimestamp, 'smooth'))
  }

  const showTradeOffCard = (index) => {
    setActiveTradeOffCardIndex(index)
    focusTimelineOnTradeOffCard(tradeOffCards[index])
  }

  // All cards now sit side by side in a horizontal band, so activating one
  // from outside (Overview pill, timeline click) has to bring it into view --
  // the card is the scroll target, the marked option inside it the fallback.
  useEffect(() => {
    const cardList = tradeOffCardListRef.current

    if (!cardList) {
      return
    }

    const optionNode = markedTradeOffOptionId
      ? cardList.querySelector(`[data-option-id="${markedTradeOffOptionId}"]`)
      : null
    const cardNode = cardList.querySelector(`[data-card-index="${activeTradeOffCardIndex}"]`)
    const target = optionNode ?? cardNode

    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [markedTradeOffOptionId, activeTradeOffCardIndex])

  // The datetime thumb above used to be positioned as a fraction of the
  // playhead SLIDER's own (fixed, always-full-window-width) box -- a
  // completely different physical scale than the marker line inside the
  // scrollable/zoomable canvas below, which is positioned as a fraction of
  // the much wider (at any zoom > 1x) canvas, then cropped/panned by the
  // canvas's own scroll position. Those two only ever lined up right after
  // something explicitly re-synced the scroll position to match the ratio
  // (a slider drag, a marker-line drag, or the live-follow effect) -- the
  // moment a person freely panned/scrolled the canvas by hand (scrollbar,
  // trackpad) without touching the playhead, the thumb stayed put at its
  // window-ratio position while the line drifted wherever the pan left it,
  // which is exactly the "why is it still disconnected" symptom.
  //
  // Fixing this properly means the thumb can no longer be positioned purely
  // from React state/CSS percentages: it has to track the canvas's actual,
  // possibly-manually-scrolled scrollLeft on every scroll, not just when
  // the playhead itself changes. So instead this reads the DOM directly and
  // imperatively sets the thumb's pixel offset -- mirroring the exact
  // formula the marker line's own on-screen position resolves to (see the
  // getTimelineScrollLeftForRatio comment above): canvas-relative pixel
  // position of the playhead, minus however far the canvas is currently
  // scrolled. Since the slider sits at the same left edge and width as the
  // scroll frame, that difference is directly usable as the thumb's `left`
  // in pixels. This guarantees the thumb and the line are always the same
  // screen X, regardless of *how* the view got there.
  // The thumb is positioned on exactly the scale its drag handler reads from:
  // a fraction of the SLIDER's own width across the planning window
  // (timelinePlayheadWindowRatio), set as a percentage in the JSX below.
  //
  // It used to be positioned from the CANVAS instead -- canvas-relative pixels
  // minus scrollLeft -- which is a different scale entirely, since the canvas
  // is zoomed and scrolled. Input and output disagreeing is what forced the
  // drag handlers to scroll the canvas along to paper over the mismatch, and
  // that is the coupling being removed here.

  // The playhead slider is a separate control from the scrollable timeline
  // below it: scrolling/panning the timeline (`.timeline-scroll`) never
  // changes the current time value, and clicking the timeline background no
  // longer does either. Only grabbing and dragging this slider's thumb (or
  // using the keyboard while it's focused) moves the current time.
  const computeTimelineTimestampFromSliderClientX = (clientX) => {
    const slider = timelinePlayheadSliderRef.current
    if (
      !slider
      || planningWindowStartTimestamp === null
      || planningWindowEndTimestamp === null
    ) {
      return null
    }

    const rect = slider.getBoundingClientRect()
    if (rect.width <= 0) {
      return null
    }

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return planningWindowStartTimestamp
      + (ratio * (planningWindowEndTimestamp - planningWindowStartTimestamp))
  }

  // Playhead and canvas are deliberately independent: moving the playhead
  // never scrolls the timeline, and scrolling the timeline never moves the
  // playhead. The slider spans the full planning window while the canvas shows
  // whatever slice is scrolled into view, so the dashed marker line simply
  // leaves the viewport when you drag the thumb past the visible range -- that
  // is the honest depiction of two independent positions, not a glitch. Live
  // mode is the one exception, and it is an opt-in follow mode.
  const previewTimelinePlayheadTime = (timestamp, syncText = true) => {
    const clampedTimestamp = clampToPlanningWindow(timestamp)
    timelinePlayheadTimeRef.current = clampedTimestamp
    syncTimelinePlaybackDom(clampedTimestamp, syncText)
    return clampedTimestamp
  }

  const commitTimelinePlayheadTime = () => {
    if (Number.isFinite(timelinePlayheadTimeRef.current)) {
      setTimelinePlayheadTime(timelinePlayheadTimeRef.current)
    }
  }

  const handleTimelinePlayheadPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setTimelineLive(false)
    setTimelinePlaying(false)

    const nextTimestamp = computeTimelineTimestampFromSliderClientX(event.clientX)
    if (nextTimestamp !== null) {
      setTimelinePlayheadTime(previewTimelinePlayheadTime(nextTimestamp))
    }
  }

  const handleTimelinePlayheadPointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      return
    }

    const nextTimestamp = computeTimelineTimestampFromSliderClientX(event.clientX)
    if (nextTimestamp !== null) {
      previewTimelinePlayheadTime(nextTimestamp)
    }
  }

  const handleTimelinePlayheadPointerUp = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commitTimelinePlayheadTime()
  }

  // The playhead marker line(s) and the datetime label live inside
  // `.timeline-time-canvas` -- the scrollable/zoomable region -- rather than
  // the fixed, always-full-width playhead slider above it, so a screen X
  // position has to be translated back through the canvas's own current
  // scroll offset and its padding-inline:50% buffer (see the big comment
  // above getTimelineScrollLeftForRatio) to land on the right ratio.
  const computeTimelineRatioFromCanvasClientX = (clientX) => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer || timelineWidthPx <= 0) {
      return null
    }

    const rect = scrollContainer.getBoundingClientRect()
    const canvasPositionPx = (
      scrollContainer.scrollLeft
      + (clientX - rect.left)
    )
    return Math.max(0, Math.min(1, canvasPositionPx / timelineWidthPx))
  }

  const computeTimelineTimestampFromCanvasClientX = (clientX) => {
    if (timelineBaseTimestamp === null || timelineDurationMs <= 0) {
      return null
    }

    const ratio = computeTimelineRatioFromCanvasClientX(clientX)
    if (ratio === null) {
      return null
    }

    return timelineBaseTimestamp + (ratio * timelineDurationMs)
  }

  // Lets a person click-and-drag the shared playhead marker line itself to
  // move the current time, not just the small slider thumb above. Mirrors
  // handleTimelinePlayheadPointerDown/Move/Up, just reading position from
  // the scrollable canvas instead of the fixed slider.
  const handleTimelineMarkerLinePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setTimelineLive(false)
    setTimelinePlaying(false)

    const nextTimestamp = computeTimelineTimestampFromCanvasClientX(event.clientX)
    if (nextTimestamp !== null) {
      setTimelinePlayheadTime(previewTimelinePlayheadTime(nextTimestamp))
    }
  }

  const handleTimelineMarkerLinePointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      return
    }

    const nextTimestamp = computeTimelineTimestampFromCanvasClientX(event.clientX)
    if (nextTimestamp !== null) {
      previewTimelinePlayheadTime(nextTimestamp)
    }
  }

  const handleTimelineMarkerLinePointerUp = (event) => {
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commitTimelinePlayheadTime()
  }

  // Mirrors the map's Ctrl/⌘ + scroll-to-zoom gesture: a plain wheel event
  // still just pans the timeline (via the browser's native scroll) and
  // pauses live mode as before, while holding Ctrl/⌘ zooms in/out instead.
  // The existing "layout changed" effect below already re-centers the
  // scroll position on the current playhead time whenever timelineWidthPx
  // changes (the same effect the Fit/Detail preset buttons already drive),
  // so continuous wheel-zoom gets that same recentering for free.
  const handleTimelineWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      pauseTimelineLiveMode(event)
      if (timelineWheelHintRef.current) {
        timelineWheelHintRef.current.classList.add('timeline-wheel-hint--visible')
        window.clearTimeout(timelineWheelHintTimeoutRef.current)
        timelineWheelHintTimeoutRef.current = window.setTimeout(() => {
          timelineWheelHintRef.current?.classList.remove('timeline-wheel-hint--visible')
        }, 1400)
      }
      return
    }

    event.preventDefault()
    const direction = event.deltaY > 0 ? -1 : 1
    setTimelineCustomZoomMultiplier((current) => {
      const base = current ?? timelineZoomMultiplier
      const next = base + (direction * TIMELINE_WHEEL_ZOOM_STEP)
      return Math.max(
        TIMELINE_MIN_ZOOM_MULTIPLIER,
        Math.min(TIMELINE_MAX_ZOOM_MULTIPLIER, next),
      )
    })
  }

  // React's synthetic onWheel is attached as a passive listener by default,
  // so event.preventDefault() inside handleTimelineWheel would silently
  // fail there (Ctrl+wheel would zoom AND still scroll the page) -- same
  // reasoning as MissionMap's handleWheel, which registers a native
  // { passive: false } listener instead of using JSX onWheel. A ref keeps the
  // native listener stable while still giving it the latest React state.
  useLayoutEffect(() => {
    timelineWheelHandlerRef.current = handleTimelineWheel
  })

  useEffect(() => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer) {
      return undefined
    }

    const onWheel = (event) => timelineWheelHandlerRef.current?.(event)
    scrollContainer.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollContainer.removeEventListener('wheel', onWheel)
  }, [expandedSections.timeline, view])

  const handleTimelinePlayheadKeyDown = (event) => {
    if (planningWindowStartTimestamp === null || planningWindowEndTimestamp === null) {
      return
    }

    let nextTimestamp
    const currentTimestamp = timelinePlayheadTimeRef.current ?? timelinePlayheadTimestamp
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const stepMilliseconds = event.shiftKey ? 60000 : 10000
      nextTimestamp = currentTimestamp + (direction * stepMilliseconds)
    } else if (event.key === 'Home') {
      nextTimestamp = planningWindowStartTimestamp
    } else if (event.key === 'End') {
      nextTimestamp = planningWindowEndTimestamp
    } else {
      return
    }

    event.preventDefault()
    setTimelineLive(false)
    setTimelinePlaying(false)
    setTimelinePlayheadTime(clampToPlanningWindow(nextTimestamp))
  }

  const handleTimelineKeyDown = (event) => {
    if (
      event.target.closest('button')
      || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    ) {
      return
    }

    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const stepMilliseconds = event.shiftKey ? 60000 : 10000
    const nextTimestamp = clampToPlanningWindow(
      (timelinePlayheadTimeRef.current ?? timelinePlayheadTimestamp)
        + (direction * stepMilliseconds),
    )
    setTimelineLive(false)
    setTimelinePlaying(false)
    setTimelinePlayheadTime(nextTimestamp)
  }

  // Plays the timeline forward from wherever the playhead currently sits, at
  // `timelinePlaybackSpeed`x real time -- independent of the actual wall-clock
  // "now" (unlike Live/"Now" mode, which breaks/stalls when the planning
  // window doesn't contain the real current time). See the playback useEffect
  // below for the actual per-frame stepping.
  // Back to the whole planning window at 1x.
  const handleResetTimelineView = () => {
    setTimelineZoomLevel(TIMELINE_DEFAULT_ZOOM_LEVEL)
    setTimelineCustomZoomMultiplier(null)
  }

  const handleTimelinePlaybackToggle = () => {
    if (timelinePlaying) {
      commitTimelinePlayheadTime()
      setTimelinePlaying(false)
      return
    }

    if (planningWindowStartTimestamp === null || planningWindowEndTimestamp === null) {
      return
    }

    setTimelineLive(false)
    timelinePlaybackFrameTimestampRef.current = null
    timelinePlaybackLastTextSyncRef.current = 0
    const currentPlayheadTimestamp = timelinePlayheadTimeRef.current ?? timelinePlayheadTimestamp
    if (currentPlayheadTimestamp >= planningWindowEndTimestamp) {
      timelinePlayheadTimeRef.current = planningWindowStartTimestamp
      setTimelinePlayheadTime(planningWindowStartTimestamp)
    }
    setTimelinePlaying(true)
  }

  const isTimelineItemAtPlayhead = (item) => {
    const startTimestamp = toTimestamp(item.startTime)
    const endTimestamp = toTimestamp(item.endTime)
    return (
      startTimestamp !== null
      && endTimestamp !== null
      && timelinePlayheadTimestamp >= startTimestamp
      && timelinePlayheadTimestamp <= endTimestamp
    )
  }

  useEffect(() => {
    if (
      !timelineLive
      || !expandedSections.timeline
      || timelineBaseTimestamp === null
      || timelineDurationMs <= 0
      || !timelineHasRows
    ) {
      return undefined
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const scrollContainer = timelineScrollRef.current
      if (!scrollContainer || timelineWidthPx <= 0) {
        return
      }

      const ratio = Math.max(
        0,
        Math.min(
          1,
          (timelinePlayheadTimestamp - timelineBaseTimestamp) / timelineDurationMs,
        ),
      )
      const scrollableWidthPx = Math.max(0, timelineWidthPx - scrollContainer.clientWidth)
      scrollContainer.scrollTo({
        left: ratio * scrollableWidthPx,
        behavior: 'auto',
      })
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [
    expandedSections.timeline,
    timelineBaseTimestamp,
    timelineDurationMs,
    timelineLive,
    timelinePlayheadTimestamp,
    timelineWidthPx,
    timelineHasRows,
  ])

  useEffect(() => {
    const layoutKey = [
      expandedSections.timeline,
      timelineWidthPx,
      timelineHasRows,
    ].join('|')

    if (layoutKey === timelineLayoutKeyRef.current) {
      return undefined
    }
    timelineLayoutKeyRef.current = layoutKey

    if (
      !expandedSections.timeline
      || timelineBaseTimestamp === null
      || timelineDurationMs <= 0
      || !timelineHasRows
    ) {
      return undefined
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const ratio = Math.max(
        0,
        Math.min(
          1,
          (timelinePlayheadTimestamp - timelineBaseTimestamp) / timelineDurationMs,
        ),
      )
      timelineProgrammaticScrollRef.current = true
      const viewportWidthPx = timelineScrollRef.current?.clientWidth ?? 0
      const scrollableWidthPx = Math.max(0, timelineWidthPx - viewportWidthPx)
      timelineScrollRef.current?.scrollTo({
        left: ratio * scrollableWidthPx,
        behavior: 'auto',
      })
      window.requestAnimationFrame(() => {
        timelineProgrammaticScrollRef.current = false
      })
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [
    expandedSections.timeline,
    timelineBaseTimestamp,
    timelineDurationMs,
    timelinePlayheadTimestamp,
    timelineWidthPx,
    timelineHasRows,
  ])

  // React owns the committed playhead value, while playback and pointer drags
  // update the small set of animated DOM nodes through this ref. Refresh the
  // node cache after commits so an unrelated render cannot leave those nodes
  // displaying the older committed timestamp.
  useLayoutEffect(() => {
    if (!timelinePlaying) {
      timelinePlayheadTimeRef.current = timelinePlayheadTimestamp
    }
    refreshTimelinePlaybackDom()
    syncTimelinePlaybackDom(
      timelinePlayheadTimeRef.current ?? timelinePlayheadTimestamp,
      true,
    )
  // The DOM synchronizer closes over the timeline bounds represented below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataVolumeModel,
    timelinePlayheadTimestamp,
    timelinePlaying,
    timelineRenderRows,
    timelineWidthPx,
  ])

  // Drives the "Play" button: advances the playhead forward at
  // `timelinePlaybackSpeed`x real elapsed time, starting from wherever the
  // playhead currently is. Unlike Live/"Now" mode this never depends on the
  // actual wall-clock time, so it keeps animating smoothly even when the
  // planning window doesn't contain the real current time.
  useEffect(() => {
    if (!timelinePlaying) {
      timelinePlaybackFrameTimestampRef.current = null
      return undefined
    }

    const step = (frameTimestamp) => {
      if (timelinePlaybackFrameTimestampRef.current === null) {
        timelinePlaybackFrameTimestampRef.current = frameTimestamp
      }

      const elapsedMs = frameTimestamp - timelinePlaybackFrameTimestampRef.current
      timelinePlaybackFrameTimestampRef.current = frameTimestamp

      const rawNextTimestamp =
        (timelinePlayheadTimeRef.current ?? planningWindowStartTimestamp ?? 0)
        + (elapsedMs * timelinePlaybackSpeed)
      // Inlined clampToPlanningWindow: only planningWindow{Start,End}Timestamp
      // (already in the dependency list below) are needed here, so the loop
      // doesn't have to restart every render to satisfy exhaustive-deps.
      const clampedNextTimestamp =
        (planningWindowStartTimestamp === null || planningWindowEndTimestamp === null)
          ? rawNextTimestamp
          : Math.max(planningWindowStartTimestamp, Math.min(planningWindowEndTimestamp, rawNextTimestamp))

      timelinePlayheadTimeRef.current = clampedNextTimestamp
      const syncText = (
        frameTimestamp - timelinePlaybackLastTextSyncRef.current >= 100
      )
      if (syncText) {
        timelinePlaybackLastTextSyncRef.current = frameTimestamp
      }
      syncTimelinePlaybackDom(clampedNextTimestamp, syncText)
      syncTimelinePlaybackViewport(clampedNextTimestamp)

      if (planningWindowEndTimestamp !== null && rawNextTimestamp >= planningWindowEndTimestamp) {
        setTimelinePlayheadTime(clampedNextTimestamp)
        setTimelinePlaying(false)
        return
      }

      timelinePlaybackRafRef.current = window.requestAnimationFrame(step)
    }

    timelinePlaybackRafRef.current = window.requestAnimationFrame(step)

    return () => {
      if (timelinePlaybackRafRef.current !== null) {
        window.cancelAnimationFrame(timelinePlaybackRafRef.current)
        timelinePlaybackRafRef.current = null
      }
      timelinePlaybackFrameTimestampRef.current = null
    }
  // Playback intentionally uses the synchronizer captured for these bounds;
  // ordinary playback frames do not create React renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timelinePlaying,
    timelinePlaybackSpeed,
    planningWindowStartTimestamp,
    planningWindowEndTimestamp,
  ])

  const formatGb = (value) => `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`

  const clearTimelineTooltipHideTimeout = () => {
    if (timelineTooltipHideTimeoutRef.current !== null) {
      window.clearTimeout(timelineTooltipHideTimeoutRef.current)
      timelineTooltipHideTimeoutRef.current = null
    }
  }

  const showWarningTooltip = (message, event) => {
    if (!message) return

    setWarningTooltip({
      visible: true,
      message,
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
    })
  }

  const moveWarningTooltip = (event) => {
    setWarningTooltip((current) => (
      current.visible
        ? { ...current, x: event?.clientX ?? current.x, y: event?.clientY ?? current.y }
        : current
    ))
  }

  const hideWarningTooltip = () => {
    setWarningTooltip((current) => (
      current.visible
        ? { ...current, visible: false }
        : current
    ))
  }

  const showTimelineTooltip = (item, event, pinned = false) => {
    if (!item) {
      return
    }

    clearTimelineTooltipHideTimeout()

    setTimelineTooltip((current) => {
      // Once opened by click, hover/focus events caused by content moving
      // under the pointer while the workspace scrolls must not turn the
      // dialog back into a cursor-following tooltip.
      if (current.pinned && !pinned) {
        return current
      }

      return {
        visible: true,
        pinned,
        item,
        x: event?.clientX ?? current.x,
        y: event?.clientY ?? current.y,
      }
    })
  }

  const moveTimelineTooltip = (event) => {
    setTimelineTooltip((current) => (
      current.visible && !current.pinned
        ? {
            ...current,
            x: event?.clientX ?? current.x,
            y: event?.clientY ?? current.y,
          }
        : current
    ))
  }

  const scheduleTimelineTooltipHide = () => {
    clearTimelineTooltipHideTimeout()

    timelineTooltipHideTimeoutRef.current = window.setTimeout(() => {
      setTimelineTooltip((current) => (
        current.pinned
          ? current
          : {
              visible: false,
              pinned: false,
              item: null,
              x: current.x,
              y: current.y,
            }
      ))
      timelineTooltipHideTimeoutRef.current = null
    }, 120)
  }

  const hideTimelineTooltip = (force = false) => {
    clearTimelineTooltipHideTimeout()

    setTimelineTooltip((current) => {
      if (!current.visible) {
        return current
      }

      if (current.pinned && !force) {
        return current
      }

      return {
        visible: false,
        pinned: false,
        item: null,
        x: current.x,
        y: current.y,
      }
    })
  }

  const toggleTimelineTooltipPin = (item, event) => {
    if (!item) {
      return
    }

    clearTimelineTooltipHideTimeout()

    setTimelineTooltip((current) => {
      const sameItemPinned = current.pinned && current.item?.id === item.id

      if (sameItemPinned) {
        return {
          visible: false,
          pinned: false,
          item: null,
          x: current.x,
          y: current.y,
        }
      }

      return {
        visible: true,
        pinned: true,
        item,
        x: event?.clientX ?? current.x,
        y: event?.clientY ?? current.y,
      }
    })
  }

  const renderTimelineTooltipContent = (item, pinned = false) => (
    <>
      <div className="timeline-hover-tooltip-header">
        <strong>{item.kind === 'link' ? `Link ID: ${item.linkId}` : item.label}</strong>
        {item.tradeOffId ? (
          <span className="timeline-hover-tooltip-pill">{item.tradeOffId}</span>
        ) : item.kind === 'activity' ? (
          <span className="timeline-hover-tooltip-pill timeline-hover-tooltip-pill--activity">
            Priority
          </span>
        ) : null}
      </div>
      <span>{item.detail}</span>
      <span>Start: {formatTimelineDateTime(item.startTime)}</span>
      <span>End: {formatTimelineDateTime(item.endTime)}</span>
      <span>Duration: {formatTimelineDuration(item.startTime, item.endTime)}</span>
      {item.recommended && <span>Auto-scheduled by the backend</span>}
      {item.overrideState && item.overrideState !== 'auto' && <span>Override: {item.overrideState}</span>}
      {Number.isFinite(item.usefulDataOffloadedMb) && item.usefulDataOffloadedMb > 0 && (
        <span>Useful data offloaded: {(item.usefulDataOffloadedMb / 1000).toFixed(2)} GB</span>
      )}
      {Number.isFinite(item.score) && <span>Backend score: {item.score.toFixed(2)}</span>}
      {item.rejectionReason && !item.blockMessage && <span>{item.rejectionReason}</span>}
      {item.blockMessage && <span>{item.blockMessage}</span>}
      {item.kind === 'link' && item.tradeOffId && (
        <span>Trade-Off relation: {item.tradeOffId}</span>
      )}
      {pinned && item.kind === 'link' && (
        <div className="timeline-link-popup-actions">
          <div className="timeline-link-popup-status-row">
            <span>Schedule controls</span>
          </div>
          {sessionId && tradeOffsCalculated && item.isSchedulable ? (
            <div
              className="timeline-link-popup-controls"
              role="group"
              aria-label={`Schedule controls for ${item.linkId}`}
            >
              {[
                { state: 'auto', label: 'A' },
                { state: 'pinned', label: 'P' },
                { state: 'excluded', label: 'X' },
              ].map((control) => (
                <button
                  key={control.state}
                  type="button"
                  className={`timeline-link-popup-control timeline-link-popup-control--${control.state} ${item.overrideState === control.state ? 'timeline-link-popup-control--active' : ''}`}
                  onClick={() => handleLinkOverride({
                    ...item,
                    optionId: item.optionId ?? item.linkId,
                    tradeOffGroupId: item.tradeOffGroupId ?? item.tradeOffId,
                  }, control.state)}
                  disabled={Boolean(overridingLinkId)}
                  aria-pressed={item.overrideState === control.state}
                  title={getOverviewControlTooltip(control.state)}
                >
                  {control.label}
                </button>
              ))}
              <button
                type="button"
                className={`timeline-link-popup-control timeline-link-popup-schedule-toggle ${item.isScheduled ? 'timeline-link-popup-schedule-toggle--scheduled' : 'timeline-link-popup-schedule-toggle--unscheduled'}`}
                onClick={() => handleLinkOverride({
                  ...item,
                  optionId: item.optionId ?? item.linkId,
                  tradeOffGroupId: item.tradeOffGroupId ?? item.tradeOffId,
                }, item.isScheduled ? 'excluded' : 'pinned')}
                disabled={Boolean(overridingLinkId)}
                aria-pressed={item.isScheduled}
                aria-label={item.isScheduled
                  ? `Scheduled. Click to unschedule ${item.linkId}`
                  : `Unscheduled. Click to schedule ${item.linkId}`}
                title={item.isScheduled
                  ? 'Scheduled: click to force this link to stay unscheduled.'
                  : 'Unscheduled: click to force this link to stay scheduled.'}
              >
                {item.isScheduled ? 'Scheduled' : 'Unscheduled'}
              </button>
            </div>
          ) : (
            <span className="timeline-link-popup-unavailable">
              {!item.isSchedulable
                ? 'This link is blocked or ineligible and cannot be scheduled.'
                : 'Calculate Trade-Offs to enable schedule controls.'}
            </span>
          )}
          {overridingLinkId === item.linkId && (
            <span className="timeline-link-popup-saving" role="status">Updating backend schedule…</span>
          )}
        </div>
      )}
      <span className="timeline-hover-tooltip-note">
        {pinned
          ? 'Click the bar again or close this popup.'
          : 'Click the bar to open schedule controls.'}
      </span>
    </>
  )

  const renderAssetWarning = (message) => (
    <span
      className="asset-warning"
      aria-label={message}
      onMouseEnter={(event) => showWarningTooltip(message, event)}
      onMouseMove={moveWarningTooltip}
      onMouseLeave={hideWarningTooltip}
      onFocus={(event) => showWarningTooltip(message, event)}
      onBlur={hideWarningTooltip}
    >
      <svg
        className="asset-warning-icon"
        viewBox="0 0 24 24"
        focusable="false"
        aria-hidden="true"
      >
        <path
          d="M12 3 1.8 20.5c-.4.7.1 1.5.9 1.5h18.6c.8 0 1.3-.8.9-1.5L12 3Z"
          fill="currentColor"
        />
        <path
          d="M12 8.2c.5 0 .9.4.9.9v5.7a.9.9 0 1 1-1.8 0V9.1c0-.5.4-.9.9-.9Zm0 10a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z"
          fill="#fff"
        />
      </svg>
    </span>
  )

  const getTradeOffAccentColor = (colorIndex) =>
    TRADE_OFF_ACCENT_COLORS[(colorIndex ?? 0) % TRADE_OFF_ACCENT_COLORS.length]

  const clampOverviewPanelWidth = (value) => Math.min(72, Math.max(38, value))

  const updateOverviewPanelWidthFromClientX = (clientX) => {
    if (!splitPanelsRef.current) {
      return
    }

    const rect = splitPanelsRef.current.getBoundingClientRect()
    if (rect.width <= 0) {
      return
    }

    const relativeX = clientX - rect.left
    const nextWidth = (relativeX / rect.width) * 100
    const clampedWidth = clampOverviewPanelWidth(nextWidth)
    if (panelSlotAssignment.topRight) {
      splitPanelsRef.current.style.gridTemplateColumns = `minmax(0, ${clampedWidth}%) 0.9rem minmax(0, calc(${100 - clampedWidth}% - 0.9rem))`
    }
    return clampedWidth
  }

  const handlePanelResizeStart = (event) => {
    event.preventDefault()
    let nextWidth = overviewPanelWidth

    const handlePointerMove = (moveEvent) => {
      nextWidth = updateOverviewPanelWidthFromClientX(moveEvent.clientX) ?? nextWidth
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      splitDragCleanupRef.current = null
      setOverviewPanelWidth(nextWidth)
    }

    splitDragCleanupRef.current = stopResize

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    nextWidth = updateOverviewPanelWidthFromClientX(event.clientX) ?? nextWidth
  }

  const handlePanelResizeKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setOverviewPanelWidth((current) => clampOverviewPanelWidth(current - 4))
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setOverviewPanelWidth((current) => clampOverviewPanelWidth(current + 4))
    }
  }

  // The upper bound used to be a tight 640px, which capped the Map View
  // panel well before the sidebar's Visible Assets list could fully unroll
  // for missions with more than a handful of assets (the sidebar tracks this
  // height via `maxHeight: mapViewHeightPx` and `overflow-y: auto`, so
  // raising this cap is what lets a taller drag actually show the whole list
  // without internal scrolling). Raised generously rather than computed
  // exactly from asset count, since the panel is a manual, user-driven
  // resize -- the drag simply has more room to go as far as they need.
  const clampBottomTopHeightPx = (value) => Math.min(2400, Math.max(140, value))

  const updatePlanningGridRows = (topHeight) => {
    const planningRow = splitPanelsRef.current?.querySelector('.planning-views-row')
    if (!planningRow) {
      return
    }
    planningRow.style.gridTemplateRows = [
      expandedSections[panelSlotAssignment.bottomTop] ? `${topHeight}px` : 'auto',
      '0.9rem',
      'auto',
    ].join(' ')

    const liveMapSlotHeight = panelSlotAssignment.bottomTop === 'mapView'
      ? topHeight
      : null
    if (liveMapSlotHeight !== null) {
      const liveMapHeight = Math.max(40, liveMapSlotHeight - MAP_PANEL_CHROME_OVERHEAD_PX)
      missionMapRef.current?.setHeight(liveMapHeight)
      const mapSidebar = splitPanelsRef.current?.querySelector('.map-sidebar')
      if (mapSidebar) {
        mapSidebar.style.maxHeight = `${liveMapHeight}px`
      }
    }
  }

  const handlePlanningRowResizeStart = (event) => {
    event.preventDefault()

    const startClientY = event.clientY
    const startHeight = bottomTopHeightPx
    let nextHeight = startHeight

    const handlePointerMove = (moveEvent) => {
      nextHeight = clampBottomTopHeightPx(startHeight + (moveEvent.clientY - startClientY))
      updatePlanningGridRows(nextHeight)
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      planningRowResizeDragCleanupRef.current = null
      setBottomTopHeightPx(nextHeight)
    }

    planningRowResizeDragCleanupRef.current = stopResize

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handlePlanningRowResizeKeyDown = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setBottomTopHeightPx((current) => clampBottomTopHeightPx(current - 16))
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setBottomTopHeightPx((current) => clampBottomTopHeightPx(current + 16))
    }
  }

  const clampTopPanelsHeightPx = (value) => Math.min(960, Math.max(220, value))

  const handleTopPanelsResizeStart = (event) => {
    event.preventDefault()

    const startClientY = event.clientY
    const startHeight = topPanelsHeightPx
    let nextHeight = startHeight

    const handlePointerMove = (moveEvent) => {
      nextHeight = clampTopPanelsHeightPx(startHeight + (moveEvent.clientY - startClientY))
      splitPanelsRef.current?.style.setProperty('--top-panels-height', `${nextHeight}px`)
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      topPanelsResizeDragCleanupRef.current = null
      setTopPanelsHeightPx(nextHeight)
    }

    topPanelsResizeDragCleanupRef.current = stopResize

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handleTopPanelsResizeKeyDown = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setTopPanelsHeightPx((current) => clampTopPanelsHeightPx(current - 16))
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setTopPanelsHeightPx((current) => clampTopPanelsHeightPx(current + 16))
    }
  }

  // bottomTopHeightPx is the whole panel row (heading + padding included);
  // the map canvas itself only gets what's left after that chrome, so it
  // needs to subtract the same overhead the panel heading/padding takes up.
  // Map View defaults to a tall, comfortable height whenever it isn't the
  // panel occupying the resizable bottomTop slot, since there's no divider
  // controlling its size in those positions.
  const mapViewSlotHeightPx = panelSlotAssignment.bottomTop === 'mapView'
    ? bottomTopHeightPx
    : null
  const mapViewHeightPx = mapViewSlotHeightPx !== null
    ? Math.max(40, mapViewSlotHeightPx - MAP_PANEL_CHROME_OVERHEAD_PX)
    : 380

  const handlePanelDragStart = (panelId) => (event) => {
    setDraggedPanelId(panelId)
    event.dataTransfer.effectAllowed = 'move'
    try {
      event.dataTransfer.setData('text/plain', panelId)
    } catch {
      // Some browsers restrict dataTransfer access mid-drag; draggedPanelId
      // state is already the source of truth for the drop handler below.
    }
  }

  const handlePanelDragEnd = () => {
    setDraggedPanelId(null)
    setDragOverPanelId(null)
  }

  const handlePanelDragOver = (panelId) => (event) => {
    if (!draggedPanelId || draggedPanelId === panelId) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverPanelId((current) => (current === panelId ? current : panelId))
  }

  const handlePanelDragLeave = (panelId) => () => {
    setDragOverPanelId((current) => (current === panelId ? null : current))
  }

  const handlePanelDrop = (targetPanelId) => (event) => {
    event.preventDefault()
    const sourcePanelId = draggedPanelId
    setDraggedPanelId(null)
    setDragOverPanelId(null)

    if (!sourcePanelId || sourcePanelId === targetPanelId) {
      return
    }

    setPanelSlotAssignment((current) => {
      const sourceSlot = Object.keys(current).find((slot) => current[slot] === sourcePanelId)
      const targetSlot = Object.keys(current).find((slot) => current[slot] === targetPanelId)

      if (!sourceSlot || !targetSlot) {
        return current
      }

      return {
        ...current,
        [sourceSlot]: targetPanelId,
        [targetSlot]: sourcePanelId,
      }
    })
  }

  const getPanelDropZoneProps = (panelId) => ({
    onDragOver: handlePanelDragOver(panelId),
    onDragLeave: handlePanelDragLeave(panelId),
    onDrop: handlePanelDrop(panelId),
  })

  const getPanelDragClassName = (panelId) => (
    `${draggedPanelId === panelId ? ' panel--dragging' : ''}`
    + `${dragOverPanelId === panelId && draggedPanelId && draggedPanelId !== panelId ? ' panel--drag-over' : ''}`
  )

  const renderPanelDragHandle = (panelId) => (
    <button
      type="button"
      className="panel-drag-handle"
      draggable="true"
      onDragStart={handlePanelDragStart(panelId)}
      onDragEnd={handlePanelDragEnd}
      aria-label={`Drag to move the ${PANEL_LABELS[panelId]} panel`}
      title="Drag to move panel"
    >
      <span className="panel-drag-handle-icon" aria-hidden="true"></span>
    </button>
  )

  // The small handle icon above is still the clearest visual affordance,
  // but requiring a precise grab on that ~27px icon made panels feel only
  // partly movable. Spreading this onto the whole heading row lets a
  // person pick the panel up from anywhere across its title/status area
  // too, the way dragging a browser tab or an OS window by its title bar
  // works -- nested buttons (collapse toggle, badges) keep working
  // normally since a plain click never crosses HTML5's drag-start
  // threshold.
  const getPanelHeadingDragProps = (panelId) => ({
    draggable: true,
    onDragStart: handlePanelDragStart(panelId),
    onDragEnd: handlePanelDragEnd,
  })

  const renderTradeOffPill = (tradeOffId) => (
    <span className="tradeoff-id-pill">
      {tradeOffId}
    </span>
  )

  const handleLinkOverride = async (option, overrideState) => {
    if (!sessionId || !option?.linkId || overridingLinkId) {
      return
    }

    setOverridingLinkId(option.linkId)
    setError(null)

    try {
      let updatedPlan = sessionPlan
      if (overrideState === 'pinned') {
        const group = tradeOffCards.find((card) => card.id === option.tradeOffGroupId)
        const previousPinned = group?.options.find(
          (candidate) => candidate.linkId !== option.linkId && candidate.overrideState === 'pinned',
        )
        if (previousPinned) {
          updatedPlan = await applySessionOverride(sessionId, {
            link_id: previousPinned.linkId,
            override_state: 'auto',
          })
        }
      }

      updatedPlan = await applySessionOverride(updatedPlan.session_id, {
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

  const toggleTimelineSection = (sectionId) => {
    setExpandedTimelineSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }))
  }

  const toggleTimelineGroup = (groupId) => {
    setExpandedTimelineGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }))
  }

  const toggleTimelineAssetVisibility = (sectionId) => {
    setTimelineAssetVisibility((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }))
  }

  // Navigation only, shared by the timeline bars and the Overview trade-off
  // pill: marking a link marks both of its timeline instances, activates the
  // card holding its option and marks the option there.
  // selectedTradeOffOption is deliberately NOT touched, so nothing is decided
  // or un-confirmed by navigating. Marking the same link again is the way back.
  const markLinkForNavigation = (linkId, optionId) => {
    if (!linkId) {
      return
    }

    if (markedTimelineLinkId === linkId) {
      setMarkedTimelineLinkId(null)
      setMarkedTradeOffOptionId(null)
      return
    }

    setMarkedTimelineLinkId(linkId)

    if (!optionId) {
      setMarkedTradeOffOptionId(null)
      return
    }

    const cardIndex = tradeOffCards.findIndex(
      (card) => card.options.some((option) => option.optionId === optionId),
    )

    if (cardIndex !== -1) {
      showTradeOffCard(cardIndex)
    }

    setMarkedTradeOffOptionId(optionId)
  }

  const handleTimelineItemClick = (item, event) => {
    if (item.kind === 'link') {
      markLinkForNavigation(item.linkId, item.optionId)
    }

    toggleTimelineTooltipPin(item, event)
  }

  const getOptionForOverpassId = (overpassId) => tradeOffCards
    .flatMap((card) => card.options)
    .find((option) => option.overpassId === overpassId) ?? null

  const handleOverviewTradeOffClick = (row) => {
    const option = getOptionForOverpassId(row.overpassId)
    markLinkForNavigation(
      row.backendLinkId ?? row.linkId,
      option?.optionId ?? row.backendLinkId ?? row.linkId ?? null,
    )
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
          outsideFocusedTradeOff ? 'timeline-bar--context-dimmed' : '',
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
        data-playback-start={item.startTimestamp}
        data-playback-end={item.endTimestamp}
        onClick={(event) => handleTimelineItemClick(item, event)}
        onMouseEnter={(event) => showTimelineTooltip(item, event)}
        onMouseMove={moveTimelineTooltip}
        onMouseLeave={scheduleTimelineTooltipHide}
        onFocus={(event) => showTimelineTooltip(item, event)}
        onBlur={scheduleTimelineTooltipHide}
        aria-pressed={isLink ? marked : undefined}
        aria-haspopup={isLink ? 'dialog' : undefined}
        aria-expanded={isLink ? pinned : undefined}
        aria-label={`${item.label}. ${item.detail}. Start ${formatTimelineDateTime(item.startTime)}. End ${formatTimelineDateTime(item.endTime)}. Duration ${formatTimelineDuration(item.startTime, item.endTime)}.`}
      ></button>
    )
  }

  const renderSectionChevron = (expanded) => (
    <svg
      className={`section-toggle-chevron ${expanded ? 'section-toggle-chevron--expanded' : ''}`}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.25 4.25 6 8l3.75-3.75" />
    </svg>
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

  const renderTimeInput = (menuKey, value, setValue, disabled = false) => (
    <div
      className={`time-window-dropdown ${activeTimeMenu === menuKey ? 'time-window-dropdown--open' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActiveTimeMenu(null)
        }
      }}
    >
      <div className="time-window-input-shell">
        <input
          type="text"
          inputMode="numeric"
          placeholder="HH:MM"
          value={value}
          maxLength={5}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) {
              setActiveTimeMenu(menuKey)
            }
          }}
          onChange={(event) => setValue(formatTimeTextInput(event.target.value, value))}
          className="time-window-input time-window-input--combo"
        />
        <button
          type="button"
          className="time-window-input-toggle"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!disabled) {
              setActiveTimeMenu((current) => (current === menuKey ? null : menuKey))
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={activeTimeMenu === menuKey}
          aria-label={`Toggle ${menuKey} time suggestions`}
        >
          <span className="time-window-select-arrow" aria-hidden="true">▾</span>
        </button>
      </div>
      {activeTimeMenu === menuKey && !disabled && (
        <div className="time-window-select-menu" role="listbox" aria-label={`${menuKey} time`}>
          {timeOptions.map((timeValue) => (
            <button
              key={`${menuKey}-${timeValue}`}
              type="button"
              role="option"
              aria-selected={value === timeValue}
              className={`time-window-select-option ${value === timeValue ? 'time-window-select-option--selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setValue(timeValue)
                setActiveTimeMenu(null)
              }}
            >
              {timeValue}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const renderPlanningTimeActions = (target, disabled = false) => {
    const targetLabel = target === 'start' ? 'Start' : 'End'

    return (
      <div className="time-window-quick-actions" role="group" aria-label={`${targetLabel} time presets`}>
        <div className="time-window-quick-primary">
          <button
            type="button"
            className="time-window-quick-button time-window-quick-button--current"
            disabled={disabled}
            onClick={() => handleSetCurrentPlanningTime(target)}
          >
            Set current time
          </button>
          <button
            type="button"
            className="time-window-quick-button time-window-quick-button--reset"
            disabled={disabled}
            onClick={() => handleResetPlanningTime(target)}
          >
            Reset
          </button>
        </div>
        <div className="time-window-adjustment-row">
          <span className="time-window-adjustment-label">Hours</span>
          <div className="time-window-stepper" role="group" aria-label={`${targetLabel} hour adjustments`}>
            <button
              type="button"
              className="time-window-quick-button"
              disabled={disabled}
              onClick={() => handleShiftPlanningTime(target, -60)}
            >
              -1h
            </button>
            <button
              type="button"
              className="time-window-quick-button"
              disabled={disabled}
              onClick={() => handleShiftPlanningTime(target, 60)}
            >
              +1h
            </button>
          </div>
        </div>
        <div className="time-window-adjustment-row">
          <span className="time-window-adjustment-label">Days</span>
          <div className="time-window-stepper" role="group" aria-label={`${targetLabel} day adjustments`}>
            <button
              type="button"
              className="time-window-quick-button"
              disabled={disabled}
              onClick={() => handleShiftPlanningTime(target, -24 * 60)}
            >
              -1 day
            </button>
            <button
              type="button"
              className="time-window-quick-button"
              disabled={disabled}
              onClick={() => handleShiftPlanningTime(target, 24 * 60)}
            >
              +1 day
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderExtractionProgressPanel = () => (
    <div className="overview-progress">
      <div className="overview-progress-body">
        <div className="overview-progress-heading">
          <span className="overview-progress-title">Processing Log</span>
          <span className="overview-progress-percent">{extractionProgress}%</span>
        </div>
        <div className="overview-progress-log" role="log" aria-live="polite">
          {extractionMessages.length === 0 ? (
            <div className="overview-progress-entry overview-progress-entry--placeholder">
              Waiting for backend status updates.
            </div>
          ) : (
            extractionMessages.map((entry) => (
              <div key={entry.id} className="overview-progress-entry">
                {entry.text}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="overview-progress-footer">
        <div
          className="overview-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={extractionProgress}
          aria-label="Overpass extraction progress"
        >
          <div
            className="overview-progress-bar-fill"
            style={{ width: `${Math.max(0, Math.min(100, extractionProgress))}%` }}
          ></div>
        </div>
      </div>
    </div>
  )

  const renderPlanningWindowContent = (disabled = false) => (
    <div className={`time-window-panel ${disabled ? 'time-window-panel--disabled' : ''}`}>
      <div className="time-window-header">
        <div className="time-window-zone-toggle" role="group" aria-label="Planning interval time zone">
          <button
            type="button"
            className={`time-window-zone-button ${planningTimeMode === 'utc' ? 'time-window-zone-button--active' : ''}`}
            onClick={() => handlePlanningTimeModeChange('utc')}
            aria-pressed={planningTimeMode === 'utc'}
            disabled={disabled}
          >
            UTC
          </button>
          <button
            type="button"
            className={`time-window-zone-button ${planningTimeMode === 'local' ? 'time-window-zone-button--active' : ''}`}
            onClick={() => handlePlanningTimeModeChange('local')}
            aria-pressed={planningTimeMode === 'local'}
            disabled={disabled}
          >
            Local
          </button>
        </div>
      </div>
      <div className="time-window-row">
        <label className="time-window-field">
          <span>Start Date</span>
          <input
            type="date"
            value={planningWindowStartDate}
            disabled={disabled}
            onChange={(event) => {
              setPlanningWindowStartDate(event.target.value)
              event.target.blur()
            }}
            className="time-window-input"
          />
        </label>
        <label className="time-window-field time-window-field--time">
          <span>Start Time</span>
          {renderTimeInput('start', planningWindowStartTime, setPlanningWindowStartTime, disabled)}
        </label>
      </div>
      {renderPlanningTimeActions('start', disabled)}
      <div className="time-window-row">
        <label className="time-window-field">
          <span>End Date</span>
          <input
            type="date"
            value={planningWindowEndDate}
            disabled={disabled}
            onChange={(event) => {
              setPlanningWindowEndDate(event.target.value)
              event.target.blur()
            }}
            className="time-window-input"
          />
        </label>
        <label className="time-window-field time-window-field--time">
          <span>End Time</span>
          {renderTimeInput('end', planningWindowEndTime, setPlanningWindowEndTime, disabled)}
        </label>
      </div>
      {renderPlanningTimeActions('end', disabled)}
      {planningWindowComplete && !planningWindowValid && (
        <p className="time-window-error">
          Enter a valid time window with an end time after the start time.
        </p>
      )}
    </div>
  )

  const renderLinkFiltersContent = (disabled = false) => (
    <div className="filter-grid">
      <label className="filter-field">
        <span>Minimum Link Elevation</span>
        <div className="filter-input-shell">
          <input
            type="number"
            min="0"
            max="90"
            step="0.1"
            inputMode="decimal"
            placeholder="Optional"
            value={minimumLinkElevationFilterDeg}
            disabled={disabled}
            onChange={(event) => setMinimumLinkElevationFilterDeg(event.target.value)}
            className="filter-input"
          />
          <span className="filter-input-unit">°</span>
        </div>
      </label>
      <label className="filter-field">
        <span>Minimum Peak Elevation</span>
        <div className="filter-input-shell">
          <input
            type="number"
            min="0"
            max="90"
            step="0.1"
            inputMode="decimal"
            placeholder="Optional"
            value={minimumPeakElevationFilterDeg}
            disabled={disabled}
            onChange={(event) => setMinimumPeakElevationFilterDeg(event.target.value)}
            className="filter-input"
          />
          <span className="filter-input-unit">°</span>
        </div>
      </label>
      {!linkFiltersValid && (
        <p className="filter-error">
          Optional filter values must stay between 0° and 90°.
        </p>
      )}
    </div>
  )

  const renderBufferConfigContent = (disabled = false) => (
    <div className={`scheduling-config ${disabled ? 'scheduling-config--disabled' : ''}`}>
      <div className="scheduling-config-grid">
        <label className="filter-field">
          <span>Capacity</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0.001"
              step="10"
              inputMode="decimal"
              value={dataCapacityGb}
              disabled={disabled}
              aria-invalid={!bufferConfigValid}
              onChange={(event) => setDataCapacityGb(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">GB</span>
          </div>
        </label>
        <label className="filter-field">
          <span>Initial Fill</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0"
              step="10"
              inputMode="decimal"
              value={dataStartFillGb}
              disabled={disabled}
              aria-invalid={!bufferConfigValid}
              onChange={(event) => setDataStartFillGb(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">GB</span>
          </div>
        </label>
        <label className="filter-field">
          <span>Payload Generation</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={dataGenerationMbps}
              disabled={disabled}
              aria-invalid={!bufferConfigValid}
              onChange={(event) => setDataGenerationMbps(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">MB/s</span>
          </div>
        </label>
        <label className="filter-field">
          <span>Downlink Rate</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0.001"
              step="0.1"
              inputMode="decimal"
              value={dataDownlinkRateMbps}
              disabled={disabled}
              aria-invalid={!bufferConfigValid}
              onChange={(event) => setDataDownlinkRateMbps(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">MB/s</span>
          </div>
        </label>
      </div>
      <p className="scheduling-config-note">
        Backend defaults for selected satellites. The downlink rate is also used when filtering links.
      </p>
      {!bufferConfigValid && (
        <p className="filter-error">
          Capacity and downlink rate must be positive; initial fill must be between zero and capacity.
        </p>
      )}
    </div>
  )

  const renderTradeOffConfigContent = (disabled = false) => (
    <div className={`scheduling-config ${disabled ? 'scheduling-config--disabled' : ''}`}>
      <label className="filter-field">
        <span>Scoring Strategy</span>
        <select
          value={tradeOffStrategy}
          disabled={disabled}
          onChange={(event) => setTradeOffStrategy(event.target.value)}
          className="filter-input scheduling-config-select"
        >
          {TRADE_OFF_STRATEGIES.map((strategy) => (
            <option key={strategy.value} value={strategy.value}>{strategy.label}</option>
          ))}
        </select>
      </label>
      {tradeOffStrategy === 'buffer_overflow_avoidance' && (
        <div className="scheduling-config-grid scheduling-config-grid--parameters">
          <label className="filter-field">
            <span>Urgency Alpha</span>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={scoringAlpha}
              disabled={disabled}
              aria-invalid={!tradeOffConfigValid}
              onChange={(event) => setScoringAlpha(event.target.value)}
              className="filter-input"
            />
          </label>
          <label className="filter-field">
            <span>Urgency Exponent</span>
            <input
              type="number"
              min="0.001"
              step="0.1"
              inputMode="decimal"
              value={scoringExponent}
              disabled={disabled}
              aria-invalid={!tradeOffConfigValid}
              onChange={(event) => setScoringExponent(event.target.value)}
              className="filter-input"
            />
          </label>
        </div>
      )}
      <p className="scheduling-config-note">
        Applied by the backend the next time Calculate Trade-Offs runs.
      </p>
      {!tradeOffConfigValid && (
        <p className="filter-error">Alpha must be zero or greater and exponent must be positive.</p>
      )}
    </div>
  )

  const renderSatelliteOptionsContent = (configDisabled = false) => (
    <div className="checkbox-list">
      {satelliteAssets.map((asset) => (
        <label
          key={asset.name}
          className={`checkbox-row ${asset.eligible && !configDisabled ? '' : 'checkbox-row--disabled'}`}
        >
          <input
            type="checkbox"
            checked={selectedSatellites.includes(asset.name)}
            onChange={() => toggleSatellite(asset.name)}
            disabled={!asset.eligible || configDisabled}
          />
          <span className="asset-name">{asset.name}</span>
          {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
        </label>
      ))}
      {satelliteAssets.length === 0 && (
        !configDisabled ? <p>No satellite assets available.</p> : null
      )}
    </div>
  )

  const renderGroundStationOptionsContent = (configDisabled = false) => (
    <div className="checkbox-list">
      {groundStationAssets.map((asset) => (
        <label
          key={asset.name}
          className={`checkbox-row ${asset.eligible && !configDisabled ? '' : 'checkbox-row--disabled'}`}
        >
          <input
            type="checkbox"
            checked={selectedGroundStations.includes(asset.name)}
            onChange={() => toggleGroundStation(asset.name)}
            disabled={!asset.eligible || configDisabled}
          />
          <span className="asset-name">{asset.name}</span>
          {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
        </label>
      ))}
      {groundStationAssets.length === 0 && (
        !configDisabled ? <p>No ground-station assets available.</p> : null
      )}
    </div>
  )

  const renderUnavailableAssetsContent = (configDisabled = false) => (
    <div className="checkbox-list">
      {unavailableAssets.map((asset) => (
        <div
          key={asset.name}
          className="checkbox-row checkbox-row--disabled checkbox-row--static"
        >
          <span className="asset-name">{asset.name}</span>
          {asset.error && renderAssetWarning(asset.error)}
        </div>
      ))}
      {unavailableAssets.length === 0 && (
        <p>{configDisabled ? 'Unavailable assets will appear here after the mission asset load.' : 'No unclassified assets.'}</p>
      )}
    </div>
  )

  const renderAssetsLandingContent = (configDisabled = false) => (
    <div className="landing-assets-panel">
      <div className="landing-assets-group">
        <button
          type="button"
          className="section-toggle"
          onClick={() => toggleSection('satellites')}
          disabled={configDisabled}
        >
          <span>Satellites</span>
          <span className="section-toggle-icon" aria-hidden="true">
            {renderSectionChevron(expandedSections.satellites)}
          </span>
        </button>
        {expandedSections.satellites && renderSatelliteOptionsContent(configDisabled)}
      </div>
      <div className="landing-assets-group">
        <button
          type="button"
          className="section-toggle"
          onClick={() => toggleSection('groundStations')}
          disabled={configDisabled}
        >
          <span>Ground Stations</span>
          <span className="section-toggle-icon" aria-hidden="true">
            {renderSectionChevron(expandedSections.groundStations)}
          </span>
        </button>
        {expandedSections.groundStations && renderGroundStationOptionsContent(configDisabled)}
      </div>
      <div className="landing-assets-group">
        <button
          type="button"
          className="section-toggle"
          onClick={() => toggleSection('unavailableAssets')}
          disabled={configDisabled}
        >
          <span>Unavailable Assets</span>
          <span className="section-toggle-icon" aria-hidden="true">
            {renderSectionChevron(expandedSections.unavailableAssets)}
          </span>
        </button>
        {expandedSections.unavailableAssets && renderUnavailableAssetsContent(configDisabled)}
      </div>
    </div>
  )

  if (view === 'landing') {
    const filterTooltip = 'Load SatOS mission data first to enable filtering.'

    return (
      <div className="app-shell">
        {appHeader(true)}
        <div className="app-content app-content--landing">
          <div className="landing-shell">
            <div className="landing-content">
              <div className={`landing-config-shell ${missionAssetsLoaded ? '' : 'landing-config-shell--disabled'}`}>
                <div className="landing-config-header landing-config-header--primary">
                  <button
                    className="btn-fetch landing-action-button"
                    onClick={fetchAssets}
                    disabled={loadMissionAssetsDisabled}
                  >
                    {loading ? (
                      <>
                        <span className="loading-spinner"></span>
                        Fetching...
                      </>
                    ) : (
                      'Load Mission Assets'
                    )}
                  </button>
                </div>

                <div className="landing-config-divider"></div>

                <div className="landing-config-body landing-config-body--landing">
                  <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                    <div className="landing-config-panel-header">
                      <span className="landing-config-step">Time Window</span>
                    </div>
                    {renderPlanningWindowContent(!missionAssetsLoaded)}
                    {!missionAssetsLoaded && (
                      <span className="landing-panel-tooltip">{filterTooltip}</span>
                    )}
                  </section>

                  <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                    <div className="landing-config-panel-header">
                      <span className="landing-config-step">Assets</span>
                    </div>
                    {renderAssetsLandingContent(!missionAssetsLoaded)}
                    {!missionAssetsLoaded && (
                      <span className="landing-panel-tooltip">{filterTooltip}</span>
                    )}
                  </section>

                  <section className={`landing-config-panel ${missionAssetsLoaded ? '' : 'landing-config-panel--disabled'}`}>
                    <div className="landing-config-panel-header">
                      <span className="landing-config-step">Link Filters</span>
                    </div>
                    {renderLinkFiltersContent(!missionAssetsLoaded)}
                    {!missionAssetsLoaded && (
                      <span className="landing-panel-tooltip">{filterTooltip}</span>
                    )}
                  </section>

                  <section className="landing-config-panel">
                    <div className="landing-config-panel-header">
                      <span className="landing-config-step">Buffer Configuration</span>
                    </div>
                    {renderBufferConfigContent()}
                  </section>

                  <section className="landing-config-panel">
                    <div className="landing-config-panel-header">
                      <span className="landing-config-step">Trade-Off Configuration</span>
                    </div>
                    {renderTradeOffConfigContent()}
                  </section>
                </div>

                {showOverviewProgress && (
                  <div className="landing-progress-shell">
                    {renderExtractionProgressPanel()}
                  </div>
                )}

                <div className="landing-config-footer">
                  <div className="landing-action-wrapper">
                    {launchingScheduler ? (
                      <button
                        className="btn-fetch btn-terminate landing-action-button"
                        onClick={handleTerminateScheduler}
                      >
                          Stop waiting
                      </button>
                    ) : (
                      <button
                        className="btn-fetch landing-action-button"
                        onClick={handleLoadScope}
                        disabled={loadScopeDisabled}
                      >
                        Load SCOPE
                      </button>
                    )}
                    {!launchingScheduler && loadScopeDisabled && (
                      <span className="landing-action-tooltip">
                        {loadScopeDisabledReason}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="error-message">
                  <strong>Error:</strong> {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const overviewPanelNode = (
          <section
            className={`panel overview-panel ${expandedSections.overview ? '' : 'panel--collapsed'}${getPanelDragClassName('overview')}`}
            {...getPanelDropZoneProps('overview')}
          >
            <div
              className={`panel-heading ${expandedSections.overview ? '' : 'panel-heading--collapsed'}`}
              {...getPanelHeadingDragProps('overview')}
            >
              <div className="panel-heading-lead">
                {renderPanelDragHandle('overview')}
              <div className="panel-heading-title">
                <h2>Overview</h2>
              </div>
              </div>
              <div className="panel-heading-actions">
                <div className="overview-inline-status">
                  {schedulerLaunched && (
                    <div className="overview-count-inline" title={`Orbit run: ${orbitEngineRunId ?? '—'} (${propagationResult?.overpass_blocks?.length ?? 0} propagated) · Filter run: ${filterRunId ?? '—'} (${filteredLinks.length} links) · Session: ${sessionId ?? '—'}`}>
                      <span className="overview-status-label">Overpasses</span>
                      <span className="overview-count-value">{overviewRows.length}</span>
                    </div>
                  )}
                  {schedulerLaunched && (
                    <div className="overview-count-inline">
                      <span className="overview-status-label">Available Links</span>
                      <span className="overview-count-value">{schedulableOverviewRows.length}</span>
                    </div>
                  )}
                </div>
                {schedulerLaunched && (
                  <div className="overview-table-visibility-toggle" role="group" aria-label="Overview visibility filter">
                    <button
                      type="button"
                      className={`overview-table-toggle-button ${showUnavailableOverviewRows ? 'overview-table-toggle-button--active' : ''}`}
                      onClick={() => setShowUnavailableOverviewRows(true)}
                      aria-pressed={showUnavailableOverviewRows}
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      className={`overview-table-toggle-button ${!showUnavailableOverviewRows ? 'overview-table-toggle-button--active' : ''}`}
                      onClick={() => setShowUnavailableOverviewRows(false)}
                      aria-pressed={!showUnavailableOverviewRows}
                    >
                      Show available
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="panel-collapse-toggle"
                  onClick={() => toggleSection('overview')}
                  aria-expanded={expandedSections.overview}
                  aria-controls="overview-panel-content"
                  aria-label={expandedSections.overview ? 'Collapse overview view' : 'Expand overview view'}
                >
                  <span className="section-toggle-icon" aria-hidden="true">
                    {renderSectionChevron(expandedSections.overview)}
                  </span>
                </button>
              </div>
            </div>

            {expandedSections.overview && (
              <div id="overview-panel-content" className="panel-collapsible-content">
              <div className="overview-list">
              {showOverviewProgress ? (
                renderExtractionProgressPanel()
              ) : (
                <div className="overview-table-scroll">
                  <div className={`overview-list-header overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                    <span>Link ID</span>
                    <span>Status</span>
                    <span>Overpass ID</span>
                    <span>Sat ID</span>
                    <span>GS ID</span>
                    <span>Start</span>
                    <span>End</span>
                    <span>Duration</span>
                    <span>Max Elev.</span>
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--tradeoff">
                        <span>Trade-Off ID</span>
                      </span>
                    )}
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--score">
                        <span>Score</span>
                      </span>
                    )}
                    {tradeOffsCalculated && <span>Offloaded</span>}
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--controls">
                        <span>Controls</span>
                      </span>
                    )}
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--schedule">
                        <span>Schedule</span>
                      </span>
                    )}
                  </div>
                  {visibleOverviewRows.length === 0 ? (
                    <>
                      <div className={`overview-list-row overview-list-row--placeholder overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                        <span>{showUnavailableOverviewRows ? 'L-001' : '—'}</span>
                        <span>—</span>
                        <span>{showUnavailableOverviewRows ? 'OP-001' : 'No available overpasses'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        <span>{showUnavailableOverviewRows ? 'Pending' : '—'}</span>
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      {visibleOverviewRows.map((row) => {
                        const rowOption = getOptionForOverpassId(row.overpassId)
                        const rowStatus = getOverviewRowStatus(row)
                        const rowUnavailable = isOverviewRowUnavailable(row)
                        const rowAvailabilityLabel = getOverviewAvailabilityLabel(row)
                        const rowRejectionReason = row.rejectionReason ?? getScheduleBlockMessage(row)
                        const isRecommendedRow = tradeOffsCalculated && row.isScheduled && row.overrideState === 'auto'
                        const isSelectableRow = tradeOffsCalculated
                          && !rowUnavailable
                          && Boolean(sessionId)
                        const isSelectedRow = isSelectableRow && row.isScheduled
                        const overrideOption = rowOption ?? {
                          tradeOffGroupId: row.backendTradeOffId,
                          optionId: row.backendLinkId,
                          linkId: row.backendLinkId,
                          overpassId: row.overpassId,
                          satId: row.satId,
                          gsId: row.gsId,
                          startTime: row.startTime,
                        }
                        const rowTradeOffBandClass = overviewTradeOffBandByOverpassId.get(row.overpassId) ?? ''

                        return (
                          <div
                            key={row.overpassId}
                            className={`overview-list-row ${rowUnavailable ? 'overview-list-row--blocked' : ''} ${isRecommendedRow ? 'overview-list-row--recommended' : ''} ${isSelectedRow ? 'overview-list-row--selected' : ''} ${rowTradeOffBandClass} ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''} overview-list-grid`}
                          >
                            <span className="overview-linkid-cell">{getOverviewDisplayLinkId(row)}</span>
                            <span
                              className="overview-status-cell"
                              onMouseEnter={rowRejectionReason ? (event) => showWarningTooltip(rowRejectionReason, event) : undefined}
                              onMouseMove={rowRejectionReason ? moveWarningTooltip : undefined}
                              onMouseLeave={rowRejectionReason ? hideWarningTooltip : undefined}
                              onFocus={rowRejectionReason ? (event) => showWarningTooltip(rowRejectionReason, event) : undefined}
                              onBlur={rowRejectionReason ? hideWarningTooltip : undefined}
                            >
                              {isRecommendedRow ? (
                                <span className="overview-row-note overview-row-note--recommended">
                                  Recommended
                                </span>
                              ) : rowStatus === 'blocked' || rowStatus === 'ineligible' ? (
                                <span className="overview-row-note">
                                  {rowAvailabilityLabel}
                                </span>
                              ) : (
                                <span className="overview-status-empty">Eligible</span>
                              )}
                            </span>
                            <span className="overview-overpass-cell">
                              <span>{row.overpassId}</span>
                            </span>
                            <span>{row.satId}</span>
                            <span>{row.gsId}</span>
                            <span>{formatOverviewStartDateTime(row.startTime)}</span>
                            <span>{formatOverviewEndDateTime(row.startTime, row.endTime)}</span>
                            <span>{row.duration}</span>
                            <span>{row.maxElevation ?? '—'}</span>
                            {tradeOffsCalculated && (
                              rowUnavailable
                                ? <span className="overview-tradeoff-cell">—</span>
                                : row.tradeOffId !== '—'
                                ? (
                                  <span className="overview-tradeoff-cell">
                                    <button
                                      type="button"
                                      className={`overview-tradeoff-button ${markedTimelineLinkId === (row.backendLinkId ?? row.linkId) ? 'overview-tradeoff-button--marked' : ''}`}
                                      onClick={() => handleOverviewTradeOffClick(row)}
                                      aria-pressed={markedTimelineLinkId === (row.backendLinkId ?? row.linkId)}
                                      title={`Show ${row.tradeOffId} and mark link ${row.backendLinkId ?? row.linkId}`}
                                    >
                                      {renderTradeOffPill(row.tradeOffId)}
                                    </button>
                                  </span>
                                )
                                : <span className="overview-tradeoff-cell">—</span>
                            )}
                            {tradeOffsCalculated && (
                              <span className="overview-score-cell">
                                {Number.isFinite(row.score) ? row.score.toFixed(2) : '—'}
                              </span>
                            )}
                            {tradeOffsCalculated && (
                              <span className="overview-offloaded-cell">
                                {row.usefulDataOffloadedMb > 0 ? formatGb(row.usefulDataOffloadedMb / 1000) : '—'}
                              </span>
                            )}
                            {tradeOffsCalculated && (
                              <span className="overview-select-cell">
                                {isSelectableRow ? (
                                  <span className="overview-override-controls" role="group" aria-label={`Override ${getOverviewDisplayLinkId(row)}`}>
                                    {['auto', 'pinned', 'excluded'].map((state) => (
                                      <button
                                        key={state}
                                        type="button"
                                        className={`overview-override-button ${row.overrideState === state ? 'overview-override-button--active' : ''}`}
                                        onClick={() => handleLinkOverride(overrideOption, state)}
                                        disabled={Boolean(overridingLinkId)}
                                        aria-pressed={row.overrideState === state}
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
                                ) : (
                                  <span className="overview-select-empty">—</span>
                                )}
                              </span>
                            )}
                            {tradeOffsCalculated && (
                              <span className="overview-schedule-state-cell">
                                <span className={`overview-schedule-state ${row.isScheduled ? 'overview-schedule-state--scheduled' : 'overview-schedule-state--unscheduled'}`}>
                                  {row.isScheduled ? 'Scheduled' : 'Unscheduled'}
                                </span>
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}
              </div>

              <div className="panel-action-wrapper">
                <button
                  className="panel-action"
                  disabled={!schedulerLaunched || calculatingTradeOffs || !tradeOffAvailable}
                  onClick={handleCalculateTradeOffs}
                >
                  {calculatingTradeOffs ? 'Calculating Trade-Offs...' : 'Calculate Trade-Offs'}
                </button>
                {!calculatingTradeOffs && (
                  <span className="panel-action-tooltip">
                    {!schedulerLaunched
                      ? 'Finish loading SCOPE and wait for extraction to complete.'
                      : !tradeOffAvailable
                        ? !bufferConfigValid
                          ? 'Enter a valid buffer configuration; initial fill cannot exceed capacity.'
                          : !tradeOffConfigValid
                            ? 'Enter a valid trade-off scoring configuration.'
                          : overviewRows.length > 0
                          ? 'All backend-filtered links are ineligible.'
                          : 'No filtered links are available.'
                        : 'Create a backend scheduling session for the filtered links.'}
                  </span>
                )}
              </div>
              </div>
            )}
          </section>
  )

  const tradeOffPanelNode = TRADE_OFF_PANEL_ENABLED ? (
          <section
            className={`panel tradeoff-panel ${expandedSections.tradeOff ? '' : 'panel--collapsed'}${getPanelDragClassName('tradeOff')}`}
            {...getPanelDropZoneProps('tradeOff')}
          >
            <div
              className={`panel-heading ${expandedSections.tradeOff ? '' : 'panel-heading--collapsed'}`}
              {...getPanelHeadingDragProps('tradeOff')}
            >
              <div className="panel-heading-lead">
                {renderPanelDragHandle('tradeOff')}
              <div className="panel-heading-title">
                <h2>Trade-Off</h2>
              </div>
              </div>
              <button
                type="button"
                className="panel-collapse-toggle"
                onClick={() => toggleSection('tradeOff')}
                aria-expanded={expandedSections.tradeOff}
                aria-controls="tradeoff-panel-content"
                aria-label={expandedSections.tradeOff ? 'Collapse trade-off view' : 'Expand trade-off view'}
              >
                <span className="section-toggle-icon" aria-hidden="true">
                  {renderSectionChevron(expandedSections.tradeOff)}
                </span>
              </button>
            </div>
            {expandedSections.tradeOff && (
              <div id="tradeoff-panel-content" className="panel-collapsible-content">
                {!tradeOffsCalculated && (
                  <p>Calculate trade-offs to create a backend scheduling session.</p>
                )}
                {tradeOffsCalculated && tradeOffCards.length === 0 && (
                  <p>No trade-off groups were identified for the current selection.</p>
                )}
                {tradeOffsCalculated && tradeOffCards.length > 0 && (
                  <div className="tradeoff-card-list" ref={tradeOffCardListRef}>
                {tradeOffCards.map((card, index) => (
                  <article
                    key={card.id}
                    data-card-index={index}
                    className={`tradeoff-card ${index === activeTradeOffCardIndex ? 'tradeoff-card--active' : ''}`}
                    style={{ '--tradeoff-accent': getTradeOffAccentColor(card.colorIndex) }}
                    onClick={() => {
                      if (index !== activeTradeOffCardIndex) {
                        showTradeOffCard(index)
                      }
                    }}
                  >
                    <div className="tradeoff-card-header">
                      <div className="tradeoff-card-titleblock">
                        <h3>{renderTradeOffPill(card.title, card.colorIndex)}</h3>
                        <p className="tradeoff-card-resource">{card.resourceLabel}</p>
                      </div>
                    </div>
                    <p className="tradeoff-reason">
                      <span className="tradeoff-reason-label">Reason:</span> {card.reason}
                    </p>

                    <div className="tradeoff-option-list">
                      {card.options.map((option) => (
                          <div
                            key={option.optionId}
                            data-option-id={option.optionId}
                            className={[
                              'tradeoff-option',
                              selectedTradeOffOption[option.tradeOffGroupId] === option.optionId ? 'tradeoff-option--selected' : '',
                              markedTradeOffOptionId === option.optionId ? 'tradeoff-option--marked' : '',
                            ].filter(Boolean).join(' ')}
                            style={{ '--tradeoff-accent': getTradeOffAccentColor(option.colorIndex) }}
                          >
                            <div className="tradeoff-option-header">
                              <span className="tradeoff-option-id">{option.overpassId}</span>
                              <div className="tradeoff-meta tradeoff-meta--option">
                                {markedTradeOffOptionId === option.optionId && (
                                  <span className="tradeoff-marked-flag">Marked</span>
                                )}
                                {option.recommended && <span className="tradeoff-recommended">Recommended</span>}
                                <span className="tradeoff-score">Score {Number(option.score ?? 0).toFixed(2)}</span>
                              </div>
                            </div>

                            <dl className="tradeoff-option-facts">
                              <div className="tradeoff-option-fact">
                                <dt>Ground Station</dt>
                                <dd>{option.gsId ?? '—'}</dd>
                              </div>
                              <div className="tradeoff-option-fact">
                                <dt>Duration</dt>
                                <dd>{option.duration ?? '—'}</dd>
                              </div>
                              <div className="tradeoff-option-fact">
                                <dt>Data</dt>
                                <dd>{option.usefulDataOffloadedMb > 0 ? formatGb(option.usefulDataOffloadedMb / 1000) : '—'}</dd>
                              </div>
                              <div className="tradeoff-option-fact">
                                <dt>Max Elev.</dt>
                                <dd>{option.maxElevation ?? '—'}</dd>
                              </div>
                            </dl>

                            <button
                              type="button"
                              className="tradeoff-select-button"
                              onClick={() => handleLinkOverride(option, option.overrideState === 'pinned' ? 'auto' : 'pinned')}
                              disabled={Boolean(overridingLinkId)}
                            >
                              {option.overrideState === 'pinned' ? 'Return to Auto' : 'Pin'}
                            </button>
                          </div>
                      ))}
                    </div>
                  </article>
                ))}
                  </div>
                )}
              </div>
            )}
          </section>
  ) : null

  const mapViewPanelNode = (
          <section
            className={`panel map-panel${getPanelDragClassName('mapView')}`}
            {...getPanelDropZoneProps('mapView')}
          >
            <div
              className="panel-heading panel-heading--map"
              {...getPanelHeadingDragProps('mapView')}
            >
              <div className="panel-heading-lead">
                {renderPanelDragHandle('mapView')}
              <div className="panel-heading-title">
                <h2>Map View</h2>
              </div>
              </div>
              <div className="map-panel-controls">
                <button
                  type="button"
                  className="map-panel-toggle"
                  onClick={() => toggleSection('mapView')}
                  aria-expanded={expandedSections.mapView}
                  aria-controls="map-panel-content"
                  aria-label={expandedSections.mapView ? 'Collapse map view' : 'Expand map view'}
                >
                  <span className="section-toggle-icon" aria-hidden="true">
                    {renderSectionChevron(expandedSections.mapView)}
                  </span>
                </button>
              </div>
            </div>

            {expandedSections.mapView && (
              <div id="map-panel-content" className="map-layout">
                <div className="map-canvas-shell">
                  <MapErrorBoundary>
                    <Suspense
                      fallback={(
                        <div className="mission-map-shell">
                          <div className="mission-map-state" role="status">Loading map...</div>
                        </div>
                      )}
                    >
                      <MissionMap
                        ref={missionMapRef}
                        heightPx={mapViewHeightPx}
                        assets={visibleMapAssets}
                        satelliteTracks={preparedSatelliteTracks}
                        activeAssetId={activeMapAsset?.id ?? null}
                        onSelectAsset={handleSelectMapAsset}
                        timeMode={activePlanningWindow?.timeMode ?? planningTimeMode}
                        showGroundStationVisibility={showGroundStationVisibilityCircles}
                        showSatelliteVisibility={showSatelliteVisibilityCircles}
                        showGroundTracks={showGroundTracks}
                        groundTrackWindowHours={groundTrackWindowHours}
                      />
                    </Suspense>
                  </MapErrorBoundary>
                </div>

                <aside className="map-sidebar" style={{ maxHeight: `${mapViewHeightPx}px` }}>
                  <div className="map-sidebar-section">
                    <h3>Map Layers</h3>
                    <div
                      className={`map-layer-controls-wrapper${
                        schedulerLaunched ? '' : ' map-layer-controls-wrapper--disabled'
                      }`}
                    >
                      <div className="map-layer-toggle-list">
                        <div className="map-layer-toggle">
                          <span className="map-layer-toggle-label">
                            <span
                              className="map-layer-toggle-swatch map-layer-toggle-swatch--ground-station"
                              aria-hidden="true"
                            ></span>
                            Ground station visibility circles
                          </span>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={showGroundStationVisibilityCircles}
                              disabled={!schedulerLaunched}
                              onChange={() => setShowGroundStationVisibilityCircles((current) => !current)}
                            />
                            <span className="toggle-switch-track" aria-hidden="true">
                              <span className="toggle-switch-thumb"></span>
                            </span>
                          </label>
                        </div>
                        <div className="map-layer-toggle">
                          <span className="map-layer-toggle-label">
                            <span
                              className="map-layer-toggle-swatch map-layer-toggle-swatch--satellite"
                              aria-hidden="true"
                            ></span>
                            Satellite visibility circles
                          </span>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={showSatelliteVisibilityCircles}
                              disabled={!schedulerLaunched}
                              onChange={() => setShowSatelliteVisibilityCircles((current) => !current)}
                            />
                            <span className="toggle-switch-track" aria-hidden="true">
                              <span className="toggle-switch-thumb"></span>
                            </span>
                          </label>
                        </div>
                        <div className="map-layer-toggle">
                          <span className="map-layer-toggle-label">
                            <span
                              className="map-layer-toggle-swatch map-layer-toggle-swatch--ground-track"
                              aria-hidden="true"
                            ></span>
                            Ground tracks
                          </span>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={showGroundTracks}
                              disabled={!schedulerLaunched}
                              onChange={() => setShowGroundTracks((current) => !current)}
                            />
                            <span className="toggle-switch-track" aria-hidden="true">
                              <span className="toggle-switch-thumb"></span>
                            </span>
                          </label>
                        </div>
                        <label className="time-window-field map-layer-window-field">
                          <span>Ground track window (hours)</span>
                          <input
                            className="time-window-input"
                            type="number"
                            min="0"
                            step="0.5"
                            value={groundTrackWindowHours}
                            disabled={!schedulerLaunched || !showGroundTracks}
                            onChange={(event) => {
                              const parsed = Number(event.target.value)
                              setGroundTrackWindowHours(Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
                            }}
                          />
                        </label>
                      </div>
                      {!schedulerLaunched && (
                        <span className="map-layer-controls-tooltip">
                          Launch the communication scheduler to unlock map layer settings.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="map-sidebar-section">
                    <h3>Visible Assets</h3>
                    {visibleMapAssets.length > 0 ? (
                      <div ref={visibleMapAssetListRef} className="map-asset-card-list">
                        {visibleMapAssets.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            data-map-asset-id={asset.id}
                            aria-pressed={activeMapAsset?.id === asset.id}
                            className={`map-asset-card ${
                              activeMapAsset?.id === asset.id ? 'map-asset-card--active' : ''
                            }`}
                            onClick={() => setActiveMapAssetId((current) => (
                              current === asset.id ? null : asset.id
                            ))}
                          >
                            <div className="map-asset-card-header">
                              <span className={`map-asset-dot map-asset-dot--${asset.markerType}`}></span>
                              <span className="map-asset-card-name">{asset.name.toUpperCase()}</span>
                            </div>
                            <div className="map-asset-card-type">{asset.type}</div>
                            <dl className="map-asset-card-grid">
                              <dt>Latitude</dt>
                              <dd>{formatCoordinate(asset.latitude, 'N', 'S')}</dd>
                              <dt>Longitude</dt>
                              <dd>{formatCoordinate(asset.longitude, 'E', 'W')}</dd>
                              {asset.markerType === 'ground-station' && (
                                <>
                                  <dt>Min. Elevation</dt>
                                  <dd>
                                    {Number.isFinite(asset.minLinkElevation)
                                      ? `${asset.minLinkElevation.toFixed(1)}°`
                                      : '—'}
                                  </dd>
                                </>
                              )}
                              {asset.markerType === 'satellite' && (
                                <>
                                  <dt>Altitude</dt>
                                  <dd>{formatAltitude(asset.altitude)}</dd>
                                  <dt>Track Time</dt>
                                  <dd>{formatTimelinePlayheadDateTime(asset.timestamp)}</dd>
                                </>
                              )}
                            </dl>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p>No selected assets with usable map coordinates yet.</p>
                    )}
                  </div>

                  {selectedAssetsWithoutLocation.length > 0 && (
                    <div className="map-sidebar-section">
                      <h3>Selected Without Location</h3>
                      <div className="map-missing-location-list">
                        {selectedAssetsWithoutLocation.map((asset) => (
                          <div key={asset.id} className="map-missing-location-card">
                            <span className="map-missing-location-name">{asset.name.toUpperCase()}</span>
                            <span className="map-missing-location-type">{asset.type}</span>
                            <span className="map-missing-location-copy">{asset.locationMessage}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </section>
  )

  const timelinePanelNode = (
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
                <div className="timeline-toolbar">
                  <div className="timeline-toolbar-groups">
                    <div className="timeline-toolbar-row">
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
                      <div className="timeline-toggle-group" role="group" aria-label="Timeline playback">
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
                      </div>
                      <div className="timeline-toggle-group" role="group" aria-label="Timeline zoom">
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

                {timelineRenderRows.length === 0 ? (
                  <p className="timeline-empty-copy">Enable at least one timeline layer and one asset section to display the schedule view.</p>
                ) : (
                  <div className="timeline-layout">
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

                    <div ref={timelineScrollFrameRef} className="timeline-scroll-frame">
                      <span
                        ref={timelineWheelHintRef}
                        className="timeline-wheel-hint"
                        aria-hidden="true"
                      >
                        Hold Ctrl (⌘ on Mac) + scroll to zoom the timeline
                      </span>
                      <div
                      ref={timelinePlayheadSliderRef}
                      className="timeline-playhead-slider"
                      aria-hidden={timelinePlayheadWindowRatio === null}
                      role={timelinePlayheadWindowRatio !== null ? 'slider' : undefined}
                      tabIndex={timelinePlayheadWindowRatio !== null ? 0 : -1}
                      aria-label="Current time shown on the map"
                      aria-valuemin={planningWindowStartTimestamp ?? undefined}
                      aria-valuemax={planningWindowEndTimestamp ?? undefined}
                      aria-valuenow={timelinePlayheadWindowRatio !== null ? timelinePlayheadTimestamp : undefined}
                      aria-valuetext={timelinePlayheadWindowRatio !== null ? formatTimelinePlayheadDateTime(timelinePlayheadTimestamp) : undefined}
                      onPointerDown={handleTimelinePlayheadPointerDown}
                      onPointerMove={handleTimelinePlayheadPointerMove}
                      onPointerUp={handleTimelinePlayheadPointerUp}
                      onPointerCancel={handleTimelinePlayheadPointerUp}
                      onKeyDown={handleTimelinePlayheadKeyDown}
                    >
                        {timelinePlayheadWindowRatio !== null && (
                          <div
                            className="timeline-playhead-thumb"
                            data-playback-thumb
                            style={{ left: `${timelinePlayheadWindowRatio * 100}%` }}
                            aria-hidden="true"
                          >
                            <span className="timeline-playhead-handle" aria-hidden="true"></span>
                            <span className="timeline-playhead-label">
                              {timelineLive && <span className="timeline-playhead-live">Live</span>}
                              <span data-playback-label>
                                {formatTimelinePlayheadDateTime(timelinePlayheadTimestamp)}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
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
                          className="timeline-time-canvas"
                          style={{
                            width: `${timelineWidthPx}px`,
                            '--timeline-hour-width': `${(60 / timelineModel.totalMinutes) * 100}%`,
                            '--timeline-major-width': `${(120 / timelineModel.totalMinutes) * 100}%`,
                          }}
                        >
                      <div className="timeline-content-plane">
                      <div className="timeline-day-row">
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
                        {timelineModel.ticks.map((tick) => (
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
                              {series ? (
                                <>
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
                                    <button
                                      key={`${series.id}-${step.id}`}
                                      type="button"
                                      className="data-volume-step"
                                      style={{
                                        left: `${((step.startTimestamp - dataVolumeModel.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                        width: `${((step.endTimestamp - step.startTimestamp) / dataVolumeModel.durationMs) * 100}%`,
                                      }}
                                      aria-label={`${step.label}: ${step.downlinkMbps} megabytes per second, ${formatGb(step.transferredGb)} downlinked.`}
                                    >
                                      <span className="timeline-bar-tooltip" role="tooltip">
                                        <span className="timeline-bar-tooltip-inner">
                                          <strong>{step.label}</strong>
                                          <span>{series.name} → {step.gsId}</span>
                                          <span>Rate: {step.downlinkMbps} MB/s</span>
                                          <span>Downlinked: {formatGb(step.transferredGb)}</span>
                                          <span>Buffer: {formatGb(step.levelBefore)} → {formatGb(step.levelAfter)}</span>
                                          {step.maxElevation && <span>Max elevation: {step.maxElevation}</span>}
                                        </span>
                                      </span>
                                    </button>
                                  ))}
                                </>
                              ) : (
                                <span className="data-volume-inline-empty">
                                  Calculate Trade-Offs to load the backend buffer profile.
                                </span>
                              )}
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
                      {timelinePlayheadOffsetMinutes !== null
                        && timelinePlayheadOffsetMinutes >= 0
                        && timelinePlayheadOffsetMinutes <= timelineModel.totalMinutes && (
                        <div
                          className="timeline-playhead-marker-line timeline-playhead-marker-line--full"
                          data-timeline-playhead
                          aria-hidden="true"
                          style={{ left: `${(timelinePlayheadOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                          onPointerDown={handleTimelineMarkerLinePointerDown}
                          onPointerMove={handleTimelineMarkerLinePointerMove}
                          onPointerUp={handleTimelineMarkerLinePointerUp}
                          onPointerCancel={handleTimelineMarkerLinePointerUp}
                        ></div>
                      )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                )}

                <div className="timeline-confirmation">
                  <div className="timeline-confirmation-copy">
                    <div className="timeline-confirmation-heading">
                      <span className="timeline-confirmation-title">Confirm Communication Schedule</span>
                    </div>
                    <span className="timeline-confirmation-text">
                      Commit the backend session's currently scheduled links to SatOS.
                    </span>
                  </div>
                  <div className="timeline-confirmation-actions">
                    <button
                      type="button"
                      className="btn-fetch timeline-confirm-button"
                      disabled={!confirmScheduleAvailable || confirmingSchedule}
                      onClick={handleConfirmSchedule}
                    >
                      {confirmingSchedule ? 'Confirming...' : 'Confirm Communication Schedule'}
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

                {confirmationSuccess && (
                  <div className="confirmation-success" role="status" aria-live="polite">
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

  const panelNodesById = {
    overview: overviewPanelNode,
    tradeOff: tradeOffPanelNode,
    mapView: mapViewPanelNode,
    timeline: timelinePanelNode,
  }

  const pageContent = (
    <div className={`workspace-shell ${sidebarCollapsed ? 'workspace-shell--collapsed' : ''}`}>
        <aside className={`workspace-sidebar ${sidebarCollapsed ? 'workspace-sidebar--collapsed' : ''}`}>
          <div className="workspace-sidebar-header">
            {!sidebarCollapsed && <h2>Configuration</h2>}
            <button
              type="button"
              className="sidebar-collapse-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? 'Expand configuration sidebar' : 'Collapse configuration sidebar'}
            >
              <svg
                className="sidebar-collapse-icon"
                viewBox="0 0 12 12"
                aria-hidden="true"
                focusable="false"
              >
                {sidebarCollapsed ? (
                  <path d="M4 2.25 7.75 6 4 9.75" />
                ) : (
                  <path d="M8 2.25 4.25 6 8 9.75" />
                )}
              </svg>
            </button>
          </div>

          {sidebarCollapsed ? (
            <div className="sidebar-collapsed-content">
              <span className="sidebar-collapsed-label">Configuration</span>
              {launchingScheduler && (
                <button
                  type="button"
                  className="sidebar-collapsed-terminate"
                  onClick={handleTerminateScheduler}
                  aria-label="Terminate the communication scheduler launch"
                  title="Terminate"
                >
                  <svg
                    className="sidebar-collapsed-terminate-icon"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M3 3 9 9 M9 3 3 9" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="workspace-sidebar-content">
                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('timeWindow')}
                  >
                    <span>Time Window</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.timeWindow)}
                    </span>
                  </button>
                  {expandedSections.timeWindow && renderPlanningWindowContent()}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('satellites')}
                  >
                    <span>Satellites</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.satellites)}
                    </span>
                  </button>
                  {expandedSections.satellites && (
                    <div className="checkbox-list">
                      {satelliteAssets.map((asset) => (
                        <label
                          key={asset.name}
                          className={`checkbox-row ${asset.eligible ? '' : 'checkbox-row--disabled'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSatellites.includes(asset.name)}
                            onChange={() => toggleSatellite(asset.name)}
                            disabled={!asset.eligible}
                          />
                          <span className="asset-name">{asset.name}</span>
                          {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
                        </label>
                      ))}
                      {satelliteAssets.length === 0 && <p>No satellite assets available.</p>}
                    </div>
                  )}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('groundStations')}
                  >
                    <span>Ground Stations</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.groundStations)}
                    </span>
                  </button>
                  {expandedSections.groundStations && (
                    <div className="checkbox-list">
                      {groundStationAssets.map((asset) => (
                        <label
                          key={asset.name}
                          className={`checkbox-row ${asset.eligible ? '' : 'checkbox-row--disabled'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedGroundStations.includes(asset.name)}
                            onChange={() => toggleGroundStation(asset.name)}
                            disabled={!asset.eligible}
                          />
                          <span className="asset-name">{asset.name}</span>
                          {!asset.eligible && asset.error && renderAssetWarning(asset.error)}
                        </label>
                      ))}
                      {groundStationAssets.length === 0 && <p>No ground-station assets available.</p>}
                    </div>
                  )}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('unavailableAssets')}
                  >
                    <span>Unavailable Assets</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.unavailableAssets)}
                    </span>
                  </button>
                  {expandedSections.unavailableAssets && (
                    <div className="checkbox-list">
                      {unavailableAssets.map((asset) => (
                        <div
                          key={asset.name}
                          className="checkbox-row checkbox-row--disabled checkbox-row--static"
                        >
                          <span className="asset-name">{asset.name}</span>
                          {asset.error && renderAssetWarning(asset.error)}
                        </div>
                      ))}
                      {unavailableAssets.length === 0 && <p>No unclassified assets.</p>}
                    </div>
                  )}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('linkFilters')}
                  >
                    <span>Link Filters</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.linkFilters)}
                    </span>
                  </button>
                  {expandedSections.linkFilters && renderLinkFiltersContent()}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('bufferConfig')}
                  >
                    <span>Buffer Configuration</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.bufferConfig)}
                    </span>
                  </button>
                  {expandedSections.bufferConfig && renderBufferConfigContent()}
                </div>

                <div className="sidebar-block">
                  <button
                    type="button"
                    className="section-toggle"
                    onClick={() => toggleSection('tradeOffConfig')}
                  >
                    <span>Trade-Off Configuration</span>
                    <span className="section-toggle-icon" aria-hidden="true">
                      {renderSectionChevron(expandedSections.tradeOffConfig)}
                    </span>
                  </button>
                  {expandedSections.tradeOffConfig && renderTradeOffConfigContent()}
                </div>
              </div>

              <div className="sidebar-action-wrapper">
                {launchingScheduler ? (
                  <button
                    type="button"
                    className="btn-fetch btn-terminate"
                    onClick={handleTerminateScheduler}
                  >
                    Stop waiting
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-fetch"
                    disabled={!launchRequirementsMet}
                    onClick={handleLaunchScheduler}
                  >
                    Launch Communication Scheduler
                  </button>
                )}
                {!launchRequirementsMet && !launchingScheduler && (
                  <span className="sidebar-action-tooltip">
                    Enter a valid time window and select at least 1 satellite and 1 ground station first.
                  </span>
                )}
              </div>
            </>
          )}
        </aside>

        <main className="workspace-main">
          <div
            ref={splitPanelsRef}
            className="workspace-panels-split"
            style={{
              // Without a second panel in the top row there is nothing to
              // split, so the remaining panel takes the full width and the
              // vertical resizer disappears with it.
              gridTemplateColumns: panelSlotAssignment.topRight
                ? `minmax(0, ${overviewPanelWidth}%) 0.9rem minmax(0, calc(${100 - overviewPanelWidth}% - 0.9rem))`
                : 'minmax(0, 1fr)',
              '--top-panels-height': `${topPanelsHeightPx}px`,
            }}
          >
          {panelNodesById[panelSlotAssignment.topLeft]}

          {panelSlotAssignment.topRight && (
            <>
              <div
                className={`panel-resizer ${!expandedSections[panelSlotAssignment.topLeft] && !expandedSections[panelSlotAssignment.topRight] ? 'panel-resizer--collapsed' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the top-row panels"
                tabIndex={0}
                onPointerDown={handlePanelResizeStart}
                onKeyDown={handlePanelResizeKeyDown}
              >
                <span className="panel-resizer-line" aria-hidden="true"></span>
                <span className="panel-resizer-grip" aria-hidden="true"></span>
              </div>

              {panelNodesById[panelSlotAssignment.topRight]}
            </>
          )}
          </div>

          <div
            className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.topLeft] && !(panelSlotAssignment.topRight && expandedSections[panelSlotAssignment.topRight]) ? 'panel-resizer--collapsed' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the height of the top row"
            tabIndex={0}
            onPointerDown={handleTopPanelsResizeStart}
            onKeyDown={handleTopPanelsResizeKeyDown}
          >
            <span className="panel-resizer-line panel-resizer-line--horizontal" aria-hidden="true"></span>
            <span className="panel-resizer-grip panel-resizer-grip--horizontal" aria-hidden="true"></span>
          </div>

          <div
            className="planning-views-row"
            style={{
              // A collapsed panel falls back to `auto` -- holding a fixed
              // height open for a collapsed panel would just leave a gap.
              gridTemplateRows: [
                expandedSections[panelSlotAssignment.bottomTop] ? `${bottomTopHeightPx}px` : 'auto',
                '0.9rem',
                'auto',
              ].join(' '),
            }}
          >
          {panelNodesById[panelSlotAssignment.bottomTop]}

          <div
            className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.bottomTop] && !expandedSections[panelSlotAssignment.bottomMiddle] ? 'panel-resizer--collapsed' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize the ${PANEL_LABELS[panelSlotAssignment.bottomTop]} panel`}
            tabIndex={0}
            onPointerDown={handlePlanningRowResizeStart}
            onKeyDown={handlePlanningRowResizeKeyDown}
          >
            <span className="panel-resizer-line panel-resizer-line--horizontal" aria-hidden="true"></span>
            <span className="panel-resizer-grip panel-resizer-grip--horizontal" aria-hidden="true"></span>
          </div>

          {panelNodesById[panelSlotAssignment.bottomMiddle]}
          </div>
        </main>
      </div>
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
            left: `${Math.max(16, Math.min(timelineTooltip.x + 18, window.innerWidth - 392))}px`,
            top: `${Math.max(16, Math.min(timelineTooltip.y + 22, window.innerHeight - 380))}px`,
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
