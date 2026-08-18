import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  computeMeanTrackAltitudeMeters,
  interpolateTrackPosition,
} from './components/mapGeometry.js'

const BACKEND_BASE_URL = 'http://localhost:8000'
const MissionMap = lazy(() => import('./components/MissionMap.jsx'))
const TRADE_OFF_ACCENT_COLORS = ['#c56b2d', '#5b7cfa', '#2a9d8f', '#9b5de5']
const TIMELINE_ZOOM_LEVELS = [
  { id: 'fit', label: 'Fit', multiplier: 1 },
  { id: 'detail', label: 'Detail', multiplier: 5.2 },
]
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
// Panel identity is separate from panel position: PANEL_LABELS/panelSlotAssignment
// let every panel (Overview, Trade-Off, Map View, Timeline, Data Volume) be
// dragged into any of the 5 layout slots, while collapse state etc. stays keyed
// to the panel itself.
const PANEL_LABELS = {
  overview: 'Overview',
  tradeOff: 'Trade-Off',
  mapView: 'Map View',
  timeline: 'Timeline',
  dataVolume: 'Data Volume',
}

// Demo assumptions for the on-board data budget. Nothing in the backend
// supplies these yet, so they are user-editable in the Data Volume toolbar and
// shared by every satellite.
const DEFAULT_DATA_START_FILL_GB = 40
const DEFAULT_DATA_GENERATION_MBPS = 100
const DEFAULT_DATA_CAPACITY_GB = 100
// Downlink rate model: rate falls off with the square of the slant range, so a
// high-elevation (short range) pass downlinks faster. Normalised so that a
// zenith pass from a 550 km orbit hits DEMO_PEAK_DOWNLINK_MBPS.
const DEMO_PEAK_DOWNLINK_MBPS = 640
const DEMO_REFERENCE_ALTITUDE_M = 550000
const EARTH_RADIUS_M = 6371008.8
// Decimal gigabytes: 1 GB = 8000 Mbit, so Mbit/s -> GB/ms is /8000/1000.
const MBPS_TO_GB_PER_MS = 1 / 8000 / 1000

// Slant range to a satellite seen at `elevationDegrees` above the horizon.
const computeSlantRangeMeters = (elevationDegrees, altitudeMeters) => {
  const elevationRadians = (Math.max(0, Math.min(90, elevationDegrees)) * Math.PI) / 180
  const orbitRadius = EARTH_RADIUS_M + Math.max(1, altitudeMeters)
  const horizontal = EARTH_RADIUS_M * Math.cos(elevationRadians)

  return Math.sqrt((orbitRadius * orbitRadius) - (horizontal * horizontal))
    - (EARTH_RADIUS_M * Math.sin(elevationRadians))
}

// Demo downlink rate: free-space loss goes with the square of the distance, so
// a high-elevation pass (short slant range) downlinks faster. Normalised so a
// zenith pass from the reference altitude reaches the peak rate. This is a
// stand-in until the backend supplies real link budgets.
const getDemoDownlinkMbps = (maxElevationDeg, altitudeMeters) => {
  const elevation = Number.isFinite(maxElevationDeg) ? maxElevationDeg : 30
  const altitude = Number.isFinite(altitudeMeters) && altitudeMeters > 0
    ? altitudeMeters
    : DEMO_REFERENCE_ALTITUDE_M
  const slantRange = computeSlantRangeMeters(elevation, altitude)

  if (!Number.isFinite(slantRange) || slantRange <= 0) {
    return DEMO_PEAK_DOWNLINK_MBPS / 4
  }

  const rate = DEMO_PEAK_DOWNLINK_MBPS
    * ((DEMO_REFERENCE_ALTITUDE_M / slantRange) ** 2)

  return Math.max(4, Math.min(DEMO_PEAK_DOWNLINK_MBPS, rate))
}

// Walks the planning window once, filling at the generation rate and draining
// during each pass, clamping at both 0 and the capacity. Returns the polyline
// plus flags for the two interesting failure modes: the buffer ran full (data
// would have been lost) or ran dry mid-pass (the link went unused).
const buildDataLevelSeries = ({
  startTimestamp,
  endTimestamp,
  startLevelGb,
  capacityGb,
  generationGbPerMs,
  passes,
}) => {
  const points = []
  let level = Math.max(0, Math.min(capacityGb, startLevelGb))
  let cursor = startTimestamp
  let overflowed = false
  let starved = false

  points.push({ timestamp: cursor, level })

  const advanceTo = (targetTimestamp, ratePerMs) => {
    if (targetTimestamp <= cursor) {
      return
    }

    const projected = level + (ratePerMs * (targetTimestamp - cursor))

    if (ratePerMs > 0 && projected > capacityGb) {
      const crossTimestamp = cursor + ((capacityGb - level) / ratePerMs)
      points.push({ timestamp: crossTimestamp, level: capacityGb })
      points.push({ timestamp: targetTimestamp, level: capacityGb })
      level = capacityGb
      overflowed = true
    } else if (ratePerMs < 0 && projected < 0) {
      const crossTimestamp = cursor + ((0 - level) / ratePerMs)
      points.push({ timestamp: crossTimestamp, level: 0 })
      points.push({ timestamp: targetTimestamp, level: 0 })
      level = 0
      starved = true
    } else {
      level = projected
      points.push({ timestamp: targetTimestamp, level })
    }

    cursor = targetTimestamp
  }

  const steps = []

  passes.forEach((pass) => {
    const passStart = Math.max(cursor, pass.startTimestamp)
    const passEnd = Math.min(endTimestamp, pass.endTimestamp)

    if (passEnd <= passStart) {
      return
    }

    advanceTo(passStart, generationGbPerMs)
    const levelBefore = level
    advanceTo(passEnd, generationGbPerMs - pass.downlinkGbPerMs)

    steps.push({
      ...pass,
      startTimestamp: passStart,
      endTimestamp: passEnd,
      levelBefore,
      levelAfter: level,
      // Generation keeps running during the pass, so the downlinked amount is
      // not simply the drop in level.
      transferredGb: Math.max(
        0,
        levelBefore + (generationGbPerMs * (passEnd - passStart)) - level,
      ),
    })
  })

  advanceTo(endTimestamp, generationGbPerMs)

  return { points, steps, overflowed, starved }
}

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
  const bottomRowResizeDragCleanupRef = useRef(null)
  const topPanelsResizeDragCleanupRef = useRef(null)
  const splitDragCleanupRef = useRef(null)
  const timelineScrollRef = useRef(null)
  const timelineScrollFrameRef = useRef(null)
  const timelineLayoutKeyRef = useRef('')
  const timelineProgrammaticScrollRef = useRef(false)
  const timelinePlayheadSliderRef = useRef(null)
  const timelinePlayheadThumbRef = useRef(null)
  const timelinePlaybackRafRef = useRef(null)
  const timelinePlaybackFrameTimestampRef = useRef(null)
  const timelinePlayheadTimeRef = useRef(null)
  const tradeOffCardListRef = useRef(null)
  const timelinePanelRef = useRef(null)
  const dataVolumeScrollRef = useRef(null)
  // Guards the two-way scroll mirror below from ping-ponging: whichever
  // container the user actually scrolled writes to the other, and the write
  // itself must not bounce back.
  const scrollSyncLockRef = useRef(false)
  const timelineWheelHintRef = useRef(null)
  const timelineWheelHintTimeoutRef = useRef(null)
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
  const [satelliteTracks, setSatelliteTracks] = useState({})
  const [extractionStatus, setExtractionStatus] = useState('Not started')
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionMessages, setExtractionMessages] = useState([])
  const [calculatingTradeOffs, setCalculatingTradeOffs] = useState(false)
  const [useDemoData, setUseDemoData] = useState(false)
  const [tradeOffsCalculated, setTradeOffsCalculated] = useState(false)
  const [tradeOffCards, setTradeOffCards] = useState([])
  const [activeTradeOffCardIndex, setActiveTradeOffCardIndex] = useState(0)
  const [selectedTradeOffOption, setSelectedTradeOffOption] = useState(null)
  const [overviewPanelWidth, setOverviewPanelWidth] = useState(58)
  // Which panel currently occupies which of the 5 layout slots. The top row
  // (topLeft/topRight) sits side by side with a width-resizer between them;
  // the bottom column (bottomTop/bottomMiddle/bottomBottom) is stacked with a
  // height-resizer between each pair. bottomTop and bottomBottom get explicit
  // pixel heights, bottomMiddle takes whatever is left -- the timeline lives
  // there by default and grows with the number of expanded asset groups. Dragging a panel's handle onto another panel swaps their
  // slots, regardless of row — this does not persist across reloads.
  const [panelSlotAssignment, setPanelSlotAssignment] = useState({
    topLeft: 'overview',
    topRight: 'tradeOff',
    bottomTop: 'mapView',
    bottomMiddle: 'timeline',
    bottomBottom: 'dataVolume',
  })
  const [draggedPanelId, setDraggedPanelId] = useState(null)
  const [dragOverPanelId, setDragOverPanelId] = useState(null)
  // Height (px) of the bottomTop slot -- this is the whole panel's grid
  // row (heading + padding + content), not just its content area; the
  // bottomBottom slot always flows naturally beneath it. 540px is 50%
  // taller again on top of the previous 360px default (itself 50% taller
  // than 240px, which was 50% taller than the original 160px default).
  const [bottomTopHeightPx, setBottomTopHeightPx] = useState(540)
  const [bottomBottomHeightPx, setBottomBottomHeightPx] = useState(320)
  // Demo assumptions behind the data-volume curves, editable in that panel.
  const [dataStartFillGb, setDataStartFillGb] = useState(DEFAULT_DATA_START_FILL_GB)
  const [dataGenerationMbps, setDataGenerationMbps] = useState(DEFAULT_DATA_GENERATION_MBPS)
  const [dataCapacityGb, setDataCapacityGb] = useState(DEFAULT_DATA_CAPACITY_GB)
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
  const [timelineZoomLevel, setTimelineZoomLevel] = useState('detail')
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
  // Asset groups start collapsed: the header row already aggregates what is
  // scheduled for the asset, and selecting a trade-off expands exactly the
  // groups that matter (see the auto-expand effect below).
  const [expandedTimelineGroups, setExpandedTimelineGroups] = useState({})
  // Purely navigational: clicking a bar marks a link (both of its instances)
  // and scrolls the Trade-Off panel to the matching option. It never changes
  // selectedTradeOffOption -- the timeline shows and navigates, it does not decide.
  const [markedTimelineLinkId, setMarkedTimelineLinkId] = useState(null)
  const [markedTradeOffOptionId, setMarkedTradeOffOptionId] = useState(null)
  const [expandedSections, setExpandedSections] = useState({
    timeWindow: true,
    satellites: true,
    groundStations: true,
    unavailableAssets: false,
    mapView: true,
    overview: true,
    tradeOff: true,
    timeline: true,
    dataVolume: true,
  })

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

  useEffect(() => {
    if (!schedulerLaunched) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setTimelineNow(Date.now())
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [schedulerLaunched])

  useEffect(() => () => {
    if (splitDragCleanupRef.current) {
      splitDragCleanupRef.current()
    }
    if (planningRowResizeDragCleanupRef.current) {
      planningRowResizeDragCleanupRef.current()
    }
    if (bottomRowResizeDragCleanupRef.current) {
      bottomRowResizeDragCleanupRef.current()
    }
    if (topPanelsResizeDragCleanupRef.current) {
      topPanelsResizeDragCleanupRef.current()
    }
  }, [])

  useEffect(() => {
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
  }, [selectedTradeOffOption, tradeOffsCalculated, useDemoData, schedulerLaunched])

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

  const handleDemoModeToggle = () => {
    setUseDemoData((current) => !current)
    setError(null)
    setOverviewRows((current) =>
      current
        .filter((row) => !row.demoGenerated)
        .map((row) => ({
          ...row,
          tradeOffId: '—',
          tradeOffScore: '—',
          tradeOffColorIndex: null,
        }))
    )
    setCalculatingTradeOffs(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption(null)
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    setConfirmingSchedule(false)
    setConfirmationProgress(0)
    setConfirmationStep('')
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
  }

  const buildDemoTradeOffState = (rows) => {
    const schedulableRows = rows.filter((row) => !row.scheduleBlocked)
    const rowTradeOffMap = new Map()
    const sortedRows = [...schedulableRows].sort((left, right) => {
      const satCompare = String(left.satId).localeCompare(String(right.satId))
      if (satCompare !== 0) {
        return satCompare
      }
      return (toTimestamp(left.startTime) ?? 0) - (toTimestamp(right.startTime) ?? 0)
    })

    const groupedRows = []

    sortedRows.forEach((row) => {
      const startTimestamp = toTimestamp(row.startTime)
      const endTimestamp = toTimestamp(row.endTime)

      if (startTimestamp === null || endTimestamp === null || endTimestamp <= startTimestamp) {
        return
      }

      const overlapsWithGroup = (group) =>
        group.satId === row.satId
        && group.rows.some((groupRow) => {
          const groupStart = toTimestamp(groupRow.startTime)
          const groupEnd = toTimestamp(groupRow.endTime)

          if (groupStart === null || groupEnd === null) {
            return false
          }

          return startTimestamp < groupEnd && endTimestamp > groupStart
        })

      const existingGroup = groupedRows.find(overlapsWithGroup)

      if (existingGroup) {
        existingGroup.rows.push(row)
        return
      }

      groupedRows.push({
        satId: row.satId,
        rows: [row],
      })
    })

    const groups = groupedRows
      .filter((group) => group.rows.length > 1)
      .map((group, groupIndex) => {
        const tradeOffId = `TO-${String(groupIndex + 1).padStart(2, '0')}`
        const colorIndex = groupIndex % TRADE_OFF_ACCENT_COLORS.length

        const options = group.rows
          .map((row) => {
            const durationScore = Math.min(35, (row.durationSeconds ?? 0) / 60 * 3)
            const elevationScore = Math.min(45, Number(row.maxElevationDeg ?? 0) * 0.8)
            const totalScoreValue = Math.round(20 + durationScore + elevationScore)

            return {
              optionId: `${tradeOffId}-${row.overpassId}`,
              overpassId: row.overpassId,
              satId: row.satId,
              gsId: row.gsId,
              duration: row.duration,
              durationSeconds: row.durationSeconds,
              maxElevationDeg: row.maxElevationDeg,
              startTime: row.startTime,
              endTime: row.endTime,
              maxElevation: row.maxElevation,
              scoreValue: totalScoreValue,
              score: `${totalScoreValue}/100`,
              colorIndex,
            }
          })
          .sort((left, right) => right.scoreValue - left.scoreValue)
          .map((option, optionIndex) => ({
            ...option,
            recommended: optionIndex === 0,
          }))

        options.forEach((option) => {
          rowTradeOffMap.set(option.overpassId, {
            tradeOffId,
            score: option.score,
            colorIndex,
          })
        })

        return {
          id: `tradeoff-${tradeOffId}`,
          title: tradeOffId,
          resourceLabel: group.satId,
          reason: `${group.satId} has overlapping downlink opportunities in this planning window and can only serve one of them.`,
          options,
          colorIndex,
        }
      })

    const enrichedRows = rows.map((row) => ({
      ...row,
      tradeOffId: row.scheduleBlocked ? '—' : rowTradeOffMap.get(row.overpassId)?.tradeOffId ?? '—',
      tradeOffScore: row.scheduleBlocked ? '—' : rowTradeOffMap.get(row.overpassId)?.score ?? '—',
      tradeOffColorIndex: row.scheduleBlocked ? null : rowTradeOffMap.get(row.overpassId)?.colorIndex ?? null,
    }))

    return { enrichedRows, groups }
  }

  const buildDemoTradeOffPreviewRows = (
    rows,
    planningWindow,
    selectedSatelliteNames,
    selectedGroundStationNames,
  ) => {
    const startTimestamp = toTimestamp(planningWindow?.startTime)
    const endTimestamp = toTimestamp(planningWindow?.endTime)

    if (
      startTimestamp === null
      || endTimestamp === null
      || endTimestamp <= startTimestamp
    ) {
      return rows
    }

    const demoSatellites =
      selectedSatelliteNames.length > 0
        ? selectedSatelliteNames
        : [...new Set(rows.map((row) => row.satId).filter(Boolean))]
    const demoGroundStations =
      selectedGroundStationNames.length > 1
        ? selectedGroundStationNames
        : [...new Set(rows.map((row) => row.gsId).filter(Boolean))]

    if (demoSatellites.length === 0 || demoGroundStations.length < 2) {
      return rows
    }

    const totalWindowMinutes = Math.max(90, Math.floor((endTimestamp - startTimestamp) / 60000))
    const nextOverpassSequence =
      rows.reduce((highest, row) => {
        const match = String(row.overpassId ?? '').match(/^OP-(\d+)$/)
        if (!match) {
          return highest
        }
        return Math.max(highest, Number.parseInt(match[1], 10))
      }, 0) + 1

    const previewRows = []
    const groupCount = Math.min(2, demoSatellites.length)
    let sequence = nextOverpassSequence

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      const satId = demoSatellites[groupIndex]
      const gsA = demoGroundStations[groupIndex % demoGroundStations.length]
      const gsB = demoGroundStations[(groupIndex + 1) % demoGroundStations.length]

      if (!satId || !gsA || !gsB || gsA === gsB) {
        continue
      }

      const baseOffsetMinutes = Math.min(
        totalWindowMinutes - 22,
        Math.max(12, Math.floor(totalWindowMinutes * (0.26 + groupIndex * 0.22))),
      )

      const firstStart = new Date(startTimestamp + baseOffsetMinutes * 60000)
      const firstEnd = new Date(firstStart.getTime() + 9 * 60000)
      const secondStart = new Date(firstStart.getTime() + 2 * 60000)
      const secondEnd = new Date(secondStart.getTime() + 10 * 60000)

      previewRows.push(
        {
          overpassId: `OP-${String(sequence++).padStart(3, '0')}`,
          satId,
          gsId: gsA,
          duration: '9 min',
          durationSeconds: 9 * 60,
          startTime: firstStart.toISOString(),
          endTime: firstEnd.toISOString(),
          maxElevation: '57.4°',
          maxElevationDeg: 57.4,
          scheduleBlocked: false,
          scheduleBlockLabel: null,
          scheduleBlockAsset: null,
          tradeOffId: '—',
          tradeOffScore: '—',
          tradeOffColorIndex: null,
          demoGenerated: true,
        },
        {
          overpassId: `OP-${String(sequence++).padStart(3, '0')}`,
          satId,
          gsId: gsB,
          duration: '10 min',
          durationSeconds: 10 * 60,
          startTime: secondStart.toISOString(),
          endTime: secondEnd.toISOString(),
          maxElevation: '52.1°',
          maxElevationDeg: 52.1,
          scheduleBlocked: false,
          scheduleBlockLabel: null,
          scheduleBlockAsset: null,
          tradeOffId: '—',
          tradeOffScore: '—',
          tradeOffColorIndex: null,
          demoGenerated: true,
        },
      )
    }

    return previewRows.length > 0 ? [...rows, ...previewRows] : rows
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

  const formatDateTimeCompact = (
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
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...getTimeZoneFormatOptions(timeMode),
    })
  }

  const formatElevation = (value) => {
    if (!Number.isFinite(value)) {
      return '—'
    }

    return `${value.toFixed(1)}°`
  }

  const formatOverpassDisplayId = (index) => `OP-${String(index + 1).padStart(3, '0')}`

  const buildOverviewRowsFromOverpasses = (overpassBlocks) =>
    [...overpassBlocks]
      .sort((left, right) => {
        const leftTimestamp = toTimestamp(left.start_time) ?? 0
        const rightTimestamp = toTimestamp(right.start_time) ?? 0
        return leftTimestamp - rightTimestamp
      })
      .map((block, index) => ({
        overpassId: formatOverpassDisplayId(index),
        backendOverpassId: block.overpass_id,
        satId: block.satellite_name,
        gsId: block.groundstation_name,
        duration: formatDurationFromSeconds(block.duration_seconds),
        durationSeconds: block.duration_seconds,
        startTime: block.start_time,
        endTime: block.end_time,
        maxElevation: formatElevation(block.max_elevation_deg),
        maxElevationDeg: block.max_elevation_deg,
      }))

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

  const hasTimeOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB

  const getBlockingScheduledActivity = (row, scheduleItems) => {
    const rowStartTimestamp = toTimestamp(row.startTime)
    const rowEndTimestamp = toTimestamp(row.endTime)

    if (
      rowStartTimestamp === null
      || rowEndTimestamp === null
      || rowEndTimestamp <= rowStartTimestamp
    ) {
      return null
    }

    return scheduleItems.find((item) => {
      const itemStartTimestamp = toTimestamp(item.startTime)
      const itemEndTimestamp = toTimestamp(item.endTime)
      const scheduleOwner = item.detail ?? ''
      const sameAsset = scheduleOwner === row.satId || scheduleOwner === row.gsId

      if (
        !sameAsset
        || itemStartTimestamp === null
        || itemEndTimestamp === null
        || itemEndTimestamp <= itemStartTimestamp
      ) {
        return false
      }

      return hasTimeOverlap(
        rowStartTimestamp,
        rowEndTimestamp,
        itemStartTimestamp,
        itemEndTimestamp,
      )
    }) ?? null
  }

  const annotateRowsWithSchedulePriority = (rows, scheduleItems) =>
    rows.map((row) => {
      const blockingActivity = getBlockingScheduledActivity(row, scheduleItems)

      return {
        ...row,
        scheduleBlocked: Boolean(blockingActivity),
        scheduleBlockLabel: blockingActivity?.label ?? null,
        scheduleBlockAsset: blockingActivity?.detail ?? null,
      }
    })

  const getDayOfYear = (date, timeMode = DEFAULT_PLANNING_TIME_MODE) => {
    const useUtc = timeMode === 'utc'
    const year = useUtc ? date.getUTCFullYear() : date.getFullYear()
    const month = useUtc ? date.getUTCMonth() : date.getMonth()
    const day = useUtc ? date.getUTCDate() : date.getDate()
    const start = Date.UTC(year, 0, 0)
    const current = Date.UTC(year, month, day)
    return Math.floor((current - start) / 86400000)
  }

  const parseDurationMinutes = (value) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 30
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

  const getSelectedTradeOffForGroup = (group) =>
    group.options.find((option) => option.optionId === selectedTradeOffOption)
    ?? group.options.find((option) => option.recommended)
    ?? group.options[0]

  const getSelectedTradeOffOptions = (groups) => groups.map((group) => getSelectedTradeOffForGroup(group))

  const getFinalScheduleRows = (rows, groups, tradeOffsReady) => {
    const schedulableRows = rows.filter((row) => !row.scheduleBlocked)

    if (!tradeOffsReady) {
      return []
    }

    const selectedOptions = getSelectedTradeOffOptions(groups)
    const selectedOverpassIds = new Set(selectedOptions.map((option) => option.overpassId))

    return schedulableRows.filter(
      (row) => row.tradeOffId === '—' || selectedOverpassIds.has(row.overpassId),
    )
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
  const buildTimelineModel = (rows, groups, currentTimestamp, currentScheduleItems, planningWindow) => {
    const timeMode = planningWindow?.timeMode ?? DEFAULT_PLANNING_TIME_MODE
    const selectedOptions = groups
      .map((group) => getSelectedTradeOffForGroup(group))
      .filter(Boolean)
    const selectedOverpassIds = new Set(selectedOptions.map((option) => option.overpassId))
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
        const partOfProposal = tradeOffsCalculated
          && !row.scheduleBlocked
          && (!hasTradeOff || selectedOverpassIds.has(row.overpassId))
        // Q9/Q12: once trade-offs exist, every option that is not the one
        // actually driving the schedule is damped -- per group, so the
        // recommended option of an untouched group stays legible.
        const dimmed = tradeOffsCalculated
          && hasTradeOff
          && !selectedOverpassIds.has(row.overpassId)

        let variant = 'neutral'
        if (row.scheduleBlocked) {
          variant = 'blocked'
        } else if (hasTradeOff) {
          variant = selectedOverpassIds.has(row.overpassId) ? 'selected' : 'candidate'
        } else if (tradeOffsCalculated) {
          variant = 'fixed'
        }

        return {
          kind: 'link',
          linkId: row.overpassId,
          satId: row.satId,
          gsId: row.gsId,
          label: row.overpassId,
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
            ? `${row.overpassId} is blocked because ${row.scheduleBlockLabel ?? 'a scheduled activity'} on ${row.scheduleBlockAsset ?? 'the current schedule'} has priority.`
            : null,
          tradeOffId: hasTradeOff ? row.tradeOffId : null,
          tradeOffScore: row.tradeOffScore ?? null,
          tradeOffColorIndex: row.tradeOffColorIndex ?? null,
          optionId: linkedOption?.optionId ?? null,
          recommended: linkedOption?.recommended ?? false,
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
          (row) => row.scheduleBlockAsset === item.detail && row.scheduleBlockLabel === item.label,
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

    const allTimestampItems = [...currentSourceItems, ...linkSourceItems]
    const planningStartTimestamp = toTimestamp(planningWindow?.startTime)
    const planningEndTimestamp = toTimestamp(planningWindow?.endTime)

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
      durationMinutes: Math.max(5, (item.endTimestamp - item.startTimestamp) / 60000),
    })

    const layerVisible = (layer) => timelineLayers[layer] !== false
    const visibleLinkItems = linkSourceItems.filter((item) => layerVisible(item.layer))
    const visibleActivityItems = currentSourceItems.filter(() => layerVisible('current'))

    const satelliteNames = [...new Set([
      ...rows.map((row) => row.satId),
      ...currentSourceItems
        .filter((item) => selectedSatellites.includes(item.assetName))
        .map((item) => item.assetName),
    ].filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))

    const groundStationNames = [...new Set([
      ...rows.map((row) => row.gsId),
      ...currentSourceItems
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
      nowOffsetMinutes: (currentTimestamp - baseDate.getTime()) / 60000,
      sections: [
        { id: 'satellites', label: 'Satellites', groups: satelliteGroups },
        { id: 'groundStations', label: 'Ground Stations', groups: groundStationGroups },
      ],
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
    setSatelliteTracks({})
    setExtractionStatus('Not started')
    setExtractionProgress(0)
    setExtractionMessages([])
    setCalculatingTradeOffs(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption(null)
    setActiveMapAssetId(null)
    setActivePlanningWindow(null)
    setTimelineNow(Date.now())
    setTimelinePlayheadTime(Date.now())
    setTimelineLive(true)
    setTimelinePlaying(false)
    setTimelinePlaybackSpeed(1)
    setTimelineZoomLevel('detail')
    setExpandedTimelineGroups({})
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
      mapView: true,
      overview: true,
      tradeOff: true,
      timeline: true,
      dataVolume: true,
    })
    setDataStartFillGb(DEFAULT_DATA_START_FILL_GB)
    setDataGenerationMbps(DEFAULT_DATA_GENERATION_MBPS)
    setDataCapacityGb(DEFAULT_DATA_CAPACITY_GB)
    setConfirmingSchedule(false)
    setConfirmationProgress(0)
    setConfirmationStep('')
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
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

  const makeAbortError = () => {
    const abortError = new Error('Terminated by user.')
    abortError.name = 'AbortError'
    return abortError
  }

  // Signal-aware: lets handleTerminateScheduler interrupt an in-progress
  // wait immediately instead of only taking effect on the next fetch (which
  // could otherwise leave "Terminate" feeling unresponsive for up to the
  // full poll interval).
  const wait = (durationMs, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(makeAbortError())
        return
      }

      const timeoutId = window.setTimeout(resolve, durationMs)
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeoutId)
        reject(makeAbortError())
      }, { once: true })
    })

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

  const pollTaskResult = async (taskId, onStatusUpdate, signal) => {
    while (true) {
      if (signal?.aborted) {
        throw makeAbortError()
      }

      const statusResponse = await fetch(`${BACKEND_BASE_URL}/tasks/status/${taskId}`, { signal })
      if (!statusResponse.ok) {
        throw new Error(`Status polling failed with ${statusResponse.status}`)
      }

      const taskStatus = await statusResponse.json()
      onStatusUpdate?.(taskStatus)

      if (taskStatus.status === 'completed') {
        const resultResponse = await fetch(`${BACKEND_BASE_URL}/tasks/status/${taskId}/result`, { signal })
        if (!resultResponse.ok) {
          throw new Error(`Result request failed with ${resultResponse.status}`)
        }

        return resultResponse.json()
      }

      if (taskStatus.status === 'failed') {
        throw new Error(taskStatus.message || 'Overpass extraction failed.')
      }

      await wait(1200, signal)
    }
  }

  const fetchAssets = async () => {
    setLoading(true)
    setError(null)
    setAssets([])
    setAssetSchedules([])
    resetWorkspaceState()
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/tasks/initialize`)
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`)
      }
      const data = await response.json()
      if (data && Array.isArray(data.assets)) {
        setSatosAlive(true)
        setAssets(data.assets)
        setAssetSchedules(Array.isArray(data.schedules) ? data.schedules : [])
        setView('workspace')
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

  const handleLaunchScheduler = async () => {
    if (!launchRequirementsMet) return

    const planningWindow = {
      startTime: planningDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime),
      endTime: planningDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime),
      timeMode: planningTimeMode,
    }

    if (!planningWindow.startTime || !planningWindow.endTime) {
      setError('Enter a valid planning window before launching the scheduler.')
      return
    }

    if (new Date(planningWindow.endTime) <= new Date(planningWindow.startTime)) {
      setError('The planning window end must be after the start time.')
      return
    }

    setLaunchingScheduler(true)
    setError(null)
    setExtractionStatus('Queued')
    setExtractionProgress(0)
    setExtractionMessages([
      {
        id: `queued-${Date.now()}`,
        text: 'Task queued. Waiting for backend processing to start.',
      },
    ])
    setOverviewRows([])
    setSatelliteTracks({})
    setSchedulerLaunched(true)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption(null)
    setExpandedTimelineGroups({})
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
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
      const response = await fetch(`${BACKEND_BASE_URL}/tasks/extract-overpasses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          satellites: selectedSatellites,
          groundstations: selectedGroundStations,
          start_time: planningWindow.startTime,
          end_time: planningWindow.endTime,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Scheduler launch failed with status ${response.status}`)
      }

      const receipt = await response.json()
      const result = await pollTaskResult(receipt.task_id, (taskStatus) => {
        setExtractionStatus(formatTaskStatusLabel(taskStatus.status))
        setExtractionProgress(
          Number.isFinite(taskStatus.progress) ? taskStatus.progress : 0,
        )

        if (taskStatus.message) {
          setExtractionMessages((current) => {
            if (current[current.length - 1]?.text === taskStatus.message) {
              return current
            }

            return [
              ...current,
              {
                id: `${taskStatus.status}-${taskStatus.progress ?? 0}-${current.length}`,
                text: taskStatus.message,
              },
            ]
          })
        }
      }, abortController.signal)
      const scheduleItems = buildCurrentScheduleItems(
        assetSchedules,
        [...selectedSatellites, ...selectedGroundStations],
      )
      const realRows = annotateRowsWithSchedulePriority(
        buildOverviewRowsFromOverpasses(result?.payload?.overpass_blocks ?? []),
        scheduleItems,
      )

      setSatelliteTracks(result?.payload?.global_tracks ?? {})
      setOverviewRows(realRows)
      setExtractionStatus('Completed')
      setExtractionProgress(100)
    } catch (err) {
      const wasTerminated = err?.name === 'AbortError'
      if (!wasTerminated) {
        console.error(err)
      }
      setOverviewRows([])
      setSatelliteTracks({})
      setActivePlanningWindow(null)
      setSchedulerLaunched(false)
      setSidebarCollapsed(false)
      setExtractionStatus(wasTerminated ? 'Terminated' : 'Failed')
      setError(wasTerminated ? null : (err.message || 'Failed to extract overpasses from the backend.'))
    } finally {
      schedulerAbortControllerRef.current = null
      setLaunchingScheduler(false)
    }
  }

  // Repurposes the Launch Communication Scheduler button into a Terminate
  // button while a launch is in flight (see the JSX below): aborts the
  // in-progress fetch/poll loop via the shared AbortController, which
  // throws an AbortError back in handleLaunchScheduler's catch block --
  // that's what actually resets schedulerLaunched/sidebarCollapsed/etc.,
  // this just requests the cancellation.
  const handleTerminateScheduler = () => {
    schedulerAbortControllerRef.current?.abort()
  }

  const handleCalculateTradeOffs = async () => {
    if (!schedulerLaunched || overviewRows.length === 0 || !useDemoData) return

    setCalculatingTradeOffs(true)

    await new Promise((resolve) => setTimeout(resolve, 1000))

    let demoInputRows = overviewRows
    let tradeOffState = buildDemoTradeOffState(demoInputRows)

    if (tradeOffState.groups.length === 0) {
      demoInputRows = buildDemoTradeOffPreviewRows(
        overviewRows,
        activePlanningWindow,
        selectedSatellites,
        selectedGroundStations,
      )
      tradeOffState = buildDemoTradeOffState(demoInputRows)
    }

    const { enrichedRows, groups } = tradeOffState

    setOverviewRows(enrichedRows)
    setTradeOffCards(groups)
    setActiveTradeOffCardIndex(0)
    focusTimelineOnTradeOffCard(groups[0])
    setSelectedTradeOffOption(groups[0]?.options.find((option) => option.recommended)?.optionId ?? null)
    setTradeOffsCalculated(true)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setCalculatingTradeOffs(false)
  }

  const handleConfirmSchedule = async () => {
    if (!confirmDemoAvailable || confirmingSchedule) {
      return
    }

    const progressStages = [
      { progress: 12, step: 'Locking workspace and freezing the current schedule selection.' },
      { progress: 34, step: 'Collecting the final proposed links and preparing activity payloads.' },
      { progress: 58, step: 'Generating demo SatOS activity objects for the selected planning window.' },
      { progress: 82, step: 'Simulating SatOS write calls for the final communication schedule.' },
      { progress: 100, step: 'Communication schedule confirmed.' },
    ]

    setConfirmingSchedule(true)
    setConfirmationProgress(0)
    setConfirmationStep('Preparing confirmation workflow...')
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)

    try {
      for (const stage of progressStages) {
        await wait(700)
        setConfirmationProgress(stage.progress)
        setConfirmationStep(stage.step)
      }

      setConfirmationSuccess(true)
      setConfirmedScheduleCount(finalScheduleRows.length)
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
        {view !== 'landing' && (
          <div className="app-header-demo">
            <span className="app-header-demo-label">Demo</span>
            <label className="demo-switch">
              <input
                type="checkbox"
                checked={useDemoData}
                onChange={handleDemoModeToggle}
              />
              <span className="demo-switch-track" aria-hidden="true">
                <span className="demo-switch-thumb"></span>
              </span>
            </label>
          </div>
        )}
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

  const satelliteAssets = assets.filter((asset) => normalizeAssetClassification(asset) === 'satellite')
  const groundStationAssets = assets.filter((asset) => normalizeAssetClassification(asset) === 'ground_station')
  const unavailableAssets = assets.filter(
    (asset) => normalizeAssetClassification(asset) === 'ineligible'
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

  const getSatelliteTrackCoordinates = (assetName) => (
    interpolateTrackPosition(satelliteTracks[assetName], timelinePlayheadTimestamp)
  )

  const formatCoordinate = (value, positiveLabel, negativeLabel) => {
    const direction = value >= 0 ? positiveLabel : negativeLabel
    return `${Math.abs(value).toFixed(2)}° ${direction}`
  }

  const formatAltitude = (value) => (
    Number.isFinite(value) ? `${(value / 1000).toFixed(1)} km` : '—'
  )

  const selectedGroundStationAssets = groundStationAssets.filter((asset) =>
    selectedGroundStations.includes(asset.name)
  )

  const selectedSatelliteAssets = satelliteAssets.filter((asset) =>
    selectedSatellites.includes(asset.name)
  )

  const selectedMapAssets = [
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
  ]

  const visibleMapAssets = selectedMapAssets

  const selectedAssetsWithoutLocation = [
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
  ]
  // No fallback to visibleMapAssets[0] here: defaulting to "always something
  // highlighted" would make it impossible to ever reach a genuinely
  // unhighlighted state -- clicking to deselect (or clicking empty map
  // space, see MissionMap's background-click handling) needs an actual
  // "nothing selected" state to land on.
  const activeMapAsset = visibleMapAssets.find((asset) => asset.id === activeMapAssetId) ?? null

  const currentScheduleItems = buildCurrentScheduleItems(
    assetSchedules,
    [...selectedSatellites, ...selectedGroundStations],
  )
  const showOverviewProgress =
    launchingScheduler
    || extractionStatus === 'Queued'
    || extractionStatus === 'Running'
  const schedulableOverviewRows = overviewRows.filter((row) => !row.scheduleBlocked)
  const tradeOffDemoAvailable = useDemoData && schedulerLaunched && schedulableOverviewRows.length > 0
  const finalScheduleRows = getFinalScheduleRows(overviewRows, tradeOffCards, tradeOffsCalculated)
  const confirmDemoAvailable =
    useDemoData
    && schedulerLaunched
    && tradeOffsCalculated
    && finalScheduleRows.length > 0
  const timelineModel = buildTimelineModel(
    overviewRows,
    tradeOffCards,
    timelineNow,
    currentScheduleItems,
    activePlanningWindow,
  )
  const timelineZoomMultiplier = timelineCustomZoomMultiplier
    ?? (TIMELINE_ZOOM_LEVELS.find((level) => level.id === timelineZoomLevel)?.multiplier ?? 1)
  const timelineWidthPx = timelineModel
    ? Math.round(timelineModel.widthPx * timelineZoomMultiplier)
    : 0
  const timelineSections = (timelineModel?.sections ?? [])
    .filter((section) => section.groups.length > 0)
  // A single flat row list drives BOTH the label column and the scrollable
  // canvas, so the two halves of the grid cannot drift apart vertically.
  const timelineRenderRows = timelineSections.flatMap((section) => [
    { type: 'section', key: `section-${section.id}`, label: section.label },
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
  ])

  // Expanding a group changes the ROW COUNT but nothing about the horizontal
  // scale, so the scroll-recentering effects below key off "are there rows at
  // all" rather than how many -- otherwise every expand/collapse would yank
  // the timeline back to the playhead.
  const timelineHasRows = timelineRenderRows.length > 0

  const getTimelineRowHeight = (renderRow) => {
    if (renderRow.type === 'section') {
      return '1.55rem'
    }

    const laneCount = renderRow.type === 'group'
      ? renderRow.group.laneCount
      : renderRow.row.laneCount

    return `${Math.max(2.8, (laneCount ?? 1) * 2.68 + 0.44)}rem`
  }

  // --- Data Volume -----------------------------------------------------
  // The curve answers "how does the chosen schedule drain this satellite's
  // buffer", so it is built from the SELECTED links (finalScheduleRows), not
  // from every extracted window, and it shares the timeline's exact time span
  // so a step always sits under its link.
  const getSatelliteAltitudeMeters = (satelliteName) => {
    const altitude = computeMeanTrackAltitudeMeters(satelliteTracks[satelliteName])
    return Number.isFinite(altitude) && altitude > 0 ? altitude : DEMO_REFERENCE_ALTITUDE_M
  }

  const buildSatellitePasses = (rows, satelliteName) => rows
    .filter((row) => row.satId === satelliteName && !row.scheduleBlocked)
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

      const downlinkMbps = getDemoDownlinkMbps(
        row.maxElevationDeg,
        getSatelliteAltitudeMeters(satelliteName),
      )

      return {
        id: row.overpassId,
        label: row.overpassId,
        gsId: row.gsId,
        maxElevation: row.maxElevation,
        tradeOffId: row.tradeOffId && row.tradeOffId !== '—' ? row.tradeOffId : null,
        startTimestamp,
        endTimestamp,
        downlinkMbps,
        downlinkGbPerMs: downlinkMbps * MBPS_TO_GB_PER_MS,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.startTimestamp - right.startTimestamp)

  // The red comparison curve: the option currently marked in the Trade-Off
  // panel, swapped in for the one that actually drives the schedule. Only one
  // at a time, and only when it genuinely differs from the current selection.
  const markedTradeOffCard = markedTradeOffOptionId
    ? tradeOffCards.find(
      (card) => card.options.some((option) => option.optionId === markedTradeOffOptionId),
    ) ?? null
    : null
  const markedTradeOffOption = markedTradeOffCard?.options
    .find((option) => option.optionId === markedTradeOffOptionId) ?? null
  const effectiveOptionOfMarkedCard = markedTradeOffCard
    ? getSelectedTradeOffForGroup(markedTradeOffCard)
    : null
  const hasDistinctAlternative = Boolean(
    markedTradeOffOption
    && effectiveOptionOfMarkedCard
    && markedTradeOffOption.optionId !== effectiveOptionOfMarkedCard.optionId,
  )
  const alternativeScheduleRows = hasDistinctAlternative
    ? [
      ...finalScheduleRows.filter(
        (row) => row.overpassId !== effectiveOptionOfMarkedCard.overpassId,
      ),
      ...overviewRows.filter((row) => row.overpassId === markedTradeOffOption.overpassId),
    ]
    : []

  const dataVolumeCapacityGb = Math.max(1, Number(dataCapacityGb) || 0)
  const dataVolumeStartLevelGb = Math.max(
    0,
    Math.min(dataVolumeCapacityGb, Number(dataStartFillGb) || 0),
  )
  const dataVolumeGenerationGbPerMs = Math.max(0, Number(dataGenerationMbps) || 0)
    * MBPS_TO_GB_PER_MS

  const dataVolumeModel = (() => {
    if (!timelineModel) {
      return null
    }

    const startTimestamp = timelineModel.baseDate.getTime()
    const endTimestamp = timelineModel.endDate.getTime()

    // Q4/Q9: only satellites whose timeline group is expanded, ground station
    // groups do not count. The auto-expand on trade-off cards therefore pulls
    // exactly the relevant satellite into this view.
    const satelliteGroups = (
      timelineModel.sections.find((section) => section.id === 'satellites')?.groups ?? []
    ).filter((group) => expandedTimelineGroups[group.id])

    const series = satelliteGroups.map((group) => {
      const baseSeries = buildDataLevelSeries({
        startTimestamp,
        endTimestamp,
        startLevelGb: dataVolumeStartLevelGb,
        capacityGb: dataVolumeCapacityGb,
        generationGbPerMs: dataVolumeGenerationGbPerMs,
        passes: buildSatellitePasses(finalScheduleRows, group.name),
      })

      const alternative = (hasDistinctAlternative && markedTradeOffOption.satId === group.name)
        ? buildDataLevelSeries({
          startTimestamp,
          endTimestamp,
          startLevelGb: dataVolumeStartLevelGb,
          capacityGb: dataVolumeCapacityGb,
          generationGbPerMs: dataVolumeGenerationGbPerMs,
          passes: buildSatellitePasses(alternativeScheduleRows, group.name),
        })
        : null

      return {
        id: group.id,
        name: group.name,
        ...baseSeries,
        alternative,
        alternativeLabel: alternative ? markedTradeOffOption.overpassId : null,
      }
    })

    return {
      startTimestamp,
      endTimestamp,
      durationMs: Math.max(1, endTimestamp - startTimestamp),
      capacityGb: dataVolumeCapacityGb,
      series,
      expandedSatelliteCount: satelliteGroups.length,
    }
  })()
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
    const halfViewportWidthPx = viewportWidthPx / 2
    return halfViewportWidthPx + (ratio * Math.max(0, timelineWidthPx - viewportWidthPx))
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
  const syncTimelinePlayheadThumbPosition = () => {
    const scrollContainer = timelineScrollRef.current
    const thumbEl = timelinePlayheadThumbRef.current
    if (
      !scrollContainer
      || !thumbEl
      || timelineBaseTimestamp === null
      || timelineDurationMs <= 0
      || timelineWidthPx <= 0
    ) {
      return
    }

    const ratio = Math.max(
      0,
      Math.min(1, (timelinePlayheadTimestamp - timelineBaseTimestamp) / timelineDurationMs),
    )
    const halfViewportWidthPx = scrollContainer.clientWidth / 2
    const canvasRelativeLeftPx = halfViewportWidthPx + (ratio * timelineWidthPx)
    thumbEl.style.left = `${canvasRelativeLeftPx - scrollContainer.scrollLeft}px`
  }

  // Re-run the imperative sync above whenever anything that feeds its
  // formula changes through React state/props (the playhead time itself,
  // zoom, or a layout change that alters clientWidth). No dependency array:
  // syncTimelinePlayheadThumbPosition is a plain function recreated every
  // render (not memoized), so it always closes over this render's latest
  // values -- same "re-attached every render (cheap)" reasoning as the wheel
  // listener effect below, and it needs to react to enough different inputs
  // (any of which can change independently) that a dependency array would
  // just end up listing nearly all of them anyway.
  useLayoutEffect(() => {
    syncTimelinePlayheadThumbPosition()
  })

  // ...and also on every native scroll of the canvas -- including manual
  // pans that never touch React state at all (dragging the scrollbar,
  // trackpad panning), which is the case the effect above can't see.
  useEffect(() => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer) {
      return undefined
    }

    scrollContainer.addEventListener('scroll', syncTimelinePlayheadThumbPosition, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', syncTimelinePlayheadThumbPosition)
  })

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

  // Dragging this slider thumb moves the playhead across the FULL planning
  // window (the slider is a fixed-width overlay, independent of the
  // timeline canvas's own zoom/scroll below it -- see the comment above
  // getTimelineScrollLeftForRatio). The marker line and "Now"/label inside
  // that canvas, though, only show whatever slice of the window is
  // currently scrolled into view -- so without an explicit scroll here, the
  // thumb (and its datetime label) jumps to the new time immediately while
  // the dashed line inside the canvas stays wherever the view was last
  // scrolled, visually "disconnecting" the two. Calling
  // scrollTimelineToTimestamp keeps the canvas centered on the same instant
  // the thumb now represents, exactly like the keyboard-nudge path
  // (handleTimelinePlayheadKeyDown) and the live-mode follow effect already
  // do.
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
      const clampedTimestamp = clampToPlanningWindow(nextTimestamp)
      setTimelinePlayheadTime(clampedTimestamp)
      scrollTimelineToTimestamp(clampedTimestamp)
    }
  }

  const handleTimelinePlayheadPointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      return
    }

    const nextTimestamp = computeTimelineTimestampFromSliderClientX(event.clientX)
    if (nextTimestamp !== null) {
      const clampedTimestamp = clampToPlanningWindow(nextTimestamp)
      setTimelinePlayheadTime(clampedTimestamp)
      scrollTimelineToTimestamp(clampedTimestamp)
    }
  }

  const handleTimelinePlayheadPointerUp = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
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
      - (rect.width / 2)
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

  // Lets a person click-and-drag the playhead marker line itself (one is
  // rendered per visible track row, all representing the same instant) to
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
      setTimelinePlayheadTime(clampToPlanningWindow(nextTimestamp))
    }
  }

  const handleTimelineMarkerLinePointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      return
    }

    const nextTimestamp = computeTimelineTimestampFromCanvasClientX(event.clientX)
    if (nextTimestamp !== null) {
      setTimelinePlayheadTime(clampToPlanningWindow(nextTimestamp))
    }
  }

  const handleTimelineMarkerLinePointerUp = (event) => {
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
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
  // { passive: false } listener instead of using JSX onWheel. Re-attached on
  // every render (cheap) so it always closes over the latest state.
  useEffect(() => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer) {
      return undefined
    }

    scrollContainer.addEventListener('wheel', handleTimelineWheel, { passive: false })
    return () => scrollContainer.removeEventListener('wheel', handleTimelineWheel)
  })

  // The Data Volume canvas is the same width, the same 50% inline padding and
  // the same time span as the timeline canvas, so a mirrored scrollLeft puts
  // both at the same instant. Zoom needs no mirroring at all -- both read
  // timelineWidthPx, so zooming either one moves both.
  useEffect(() => {
    const timelineContainer = timelineScrollRef.current
    const dataContainer = dataVolumeScrollRef.current

    if (!timelineContainer || !dataContainer) {
      return undefined
    }

    const mirror = (source, target) => () => {
      if (scrollSyncLockRef.current) {
        return
      }

      scrollSyncLockRef.current = true
      target.scrollLeft = source.scrollLeft
      window.requestAnimationFrame(() => {
        scrollSyncLockRef.current = false
      })
    }

    const onTimelineScroll = mirror(timelineContainer, dataContainer)
    const onDataScroll = mirror(dataContainer, timelineContainer)

    timelineContainer.addEventListener('scroll', onTimelineScroll, { passive: true })
    dataContainer.addEventListener('scroll', onDataScroll, { passive: true })
    dataContainer.addEventListener('wheel', handleTimelineWheel, { passive: false })

    // Align once on mount/relayout so the two do not start out offset.
    dataContainer.scrollLeft = timelineContainer.scrollLeft

    return () => {
      timelineContainer.removeEventListener('scroll', onTimelineScroll)
      dataContainer.removeEventListener('scroll', onDataScroll)
      dataContainer.removeEventListener('wheel', handleTimelineWheel)
    }
  })

  const handleTimelinePlayheadKeyDown = (event) => {
    if (planningWindowStartTimestamp === null || planningWindowEndTimestamp === null) {
      return
    }

    let nextTimestamp
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const stepMilliseconds = event.shiftKey ? 60000 : 10000
      nextTimestamp = timelinePlayheadTimestamp + (direction * stepMilliseconds)
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
      timelinePlayheadTimestamp + (direction * stepMilliseconds),
    )
    setTimelineLive(false)
    setTimelinePlaying(false)
    setTimelinePlayheadTime(nextTimestamp)
    scrollTimelineToTimestamp(nextTimestamp)
  }

  // Plays the timeline forward from wherever the playhead currently sits, at
  // `timelinePlaybackSpeed`x real time -- independent of the actual wall-clock
  // "now" (unlike Live/"Now" mode, which breaks/stalls when the planning
  // window doesn't contain the real current time). See the playback useEffect
  // below for the actual per-frame stepping.
  const handleTimelinePlaybackToggle = () => {
    if (timelinePlaying) {
      setTimelinePlaying(false)
      return
    }

    if (planningWindowStartTimestamp === null || planningWindowEndTimestamp === null) {
      return
    }

    setTimelineLive(false)
    if (timelinePlayheadTimestamp >= planningWindowEndTimestamp) {
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
      const halfViewportWidthPx = scrollContainer.clientWidth / 2
      const scrollableWidthPx = Math.max(0, timelineWidthPx - scrollContainer.clientWidth)
      scrollContainer.scrollTo({
        left: halfViewportWidthPx + (ratio * scrollableWidthPx),
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
        left: (viewportWidthPx / 2) + (ratio * scrollableWidthPx),
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

  // Keep a ref mirror of the (clamped) playhead timestamp so the playback
  // loop below can always read the latest value without needing to restart
  // its requestAnimationFrame loop on every tick.
  //
  // This MUST be useLayoutEffect, not useEffect: the playback loop also
  // writes this same ref directly, synchronously, right before scheduling
  // its next animation frame. useEffect's passive-effect flush is
  // deferred/async and isn't guaranteed to run before the next
  // requestAnimationFrame callback fires, so a stale commit's effect could
  // overwrite the ref with an older value AFTER a newer frame already
  // advanced it -- the playback loop would then briefly compute from that
  // stale value before self-correcting on the next tick, which is exactly
  // what showed up as the satellite marker occasionally jumping backward
  // ("vibrating") during fast playback. useLayoutEffect runs synchronously
  // right after each commit, before paint and before any later
  // requestAnimationFrame callback can run, which closes that race.
  useLayoutEffect(() => {
    timelinePlayheadTimeRef.current = timelinePlayheadTimestamp
  }, [timelinePlayheadTimestamp])

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
      setTimelinePlayheadTime(clampedNextTimestamp)

      if (planningWindowEndTimestamp !== null && rawNextTimestamp >= planningWindowEndTimestamp) {
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
  }, [
    timelinePlaying,
    timelinePlaybackSpeed,
    planningWindowStartTimestamp,
    planningWindowEndTimestamp,
  ])

  const formatGb = (value) => `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`
  const renderAssetWarning = (message) => (
    <span className="asset-warning" aria-label={message}>
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
      <span className="asset-warning-tooltip">{message}</span>
    </span>
  )

  const renderDemoBadge = () => (
    <span className="demo-badge">Demo</span>
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
    setOverviewPanelWidth(clampOverviewPanelWidth(nextWidth))
  }

  const handlePanelResizeStart = (event) => {
    event.preventDefault()

    const handlePointerMove = (moveEvent) => {
      updateOverviewPanelWidthFromClientX(moveEvent.clientX)
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      splitDragCleanupRef.current = null
    }

    splitDragCleanupRef.current = stopResize

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    updateOverviewPanelWidthFromClientX(event.clientX)
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
  const clampBottomBottomHeightPx = (value) => Math.min(1600, Math.max(120, value))

  // Drag direction is inverted here: this resizer sits ABOVE the slot it
  // sizes, so pulling it up has to make that slot taller.
  const handleBottomRowResizeStart = (event) => {
    event.preventDefault()

    const startClientY = event.clientY
    const startHeight = bottomBottomHeightPx

    const handlePointerMove = (moveEvent) => {
      setBottomBottomHeightPx(
        clampBottomBottomHeightPx(startHeight - (moveEvent.clientY - startClientY)),
      )
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      bottomRowResizeDragCleanupRef.current = null
    }

    bottomRowResizeDragCleanupRef.current = stopResize

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handleBottomRowResizeKeyDown = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setBottomBottomHeightPx((current) => clampBottomBottomHeightPx(current + 16))
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setBottomBottomHeightPx((current) => clampBottomBottomHeightPx(current - 16))
    }
  }

  const handlePlanningRowResizeStart = (event) => {
    event.preventDefault()

    const startClientY = event.clientY
    const startHeight = bottomTopHeightPx

    const handlePointerMove = (moveEvent) => {
      setBottomTopHeightPx(clampBottomTopHeightPx(startHeight + (moveEvent.clientY - startClientY)))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      planningRowResizeDragCleanupRef.current = null
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

    const handlePointerMove = (moveEvent) => {
      setTopPanelsHeightPx(clampTopPanelsHeightPx(startHeight + (moveEvent.clientY - startClientY)))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      topPanelsResizeDragCleanupRef.current = null
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
  // panel occupying the resizable bottomTop slot (e.g. it got dragged into
  // the top row, or swapped to bottomBottom), since there's no divider
  // controlling its size in those positions.
  const MAP_PANEL_CHROME_OVERHEAD_PX = 88
  const mapViewHeightPx = panelSlotAssignment.bottomTop === 'mapView'
    ? Math.max(40, bottomTopHeightPx - MAP_PANEL_CHROME_OVERHEAD_PX)
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

  const renderTradeOffPill = (tradeOffId, colorIndex) => (
    <span
      className="tradeoff-id-pill"
      style={{ '--tradeoff-accent': getTradeOffAccentColor(colorIndex) }}
    >
      {tradeOffId}
    </span>
  )

  // Selecting is the one action here that actually commits, so it takes you to
  // where the consequence shows: timeline panel open, the involved asset groups
  // expanded, scrolled to the link. The navigational marking is cleared -- its
  // red comparison curve showed an alternative you have just decided about.
  const handleSelectTradeOffOption = (option) => {
    setSelectedTradeOffOption(option.optionId)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)

    setExpandedSections((current) => (
      current.timeline ? current : { ...current, timeline: true }
    ))

    setExpandedTimelineGroups((current) => {
      const next = { ...current }

      if (option.satId) {
        next[`satellite:${option.satId}`] = true
      }

      if (option.gsId) {
        next[`ground_station:${option.gsId}`] = true
      }

      return next
    })

    const startTimestamp = toTimestamp(option.startTime)

    // One frame later: the panel and the asset groups have to be expanded
    // before there is anything to scroll to.
    window.requestAnimationFrame(() => {
      timelinePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

      if (startTimestamp !== null) {
        scrollTimelineToTimestamp(startTimestamp, 'smooth')
      }
    })
  }

  // Q1(a): the link's capacity -- what this pass could downlink at its demo
  // rate for its whole duration, independent of how full the buffer happens to
  // be at that moment.
  const getOptionLinkBudget = (option) => {
    const row = overviewRows.find((entry) => entry.overpassId === option.overpassId) ?? null
    const startTimestamp = toTimestamp(option.startTime)
    const endTimestamp = toTimestamp(option.endTime)
    const durationSeconds = Number.isFinite(option.durationSeconds)
      ? option.durationSeconds
      : (Number.isFinite(row?.durationSeconds)
        ? row.durationSeconds
        : ((startTimestamp !== null && endTimestamp !== null)
          ? (endTimestamp - startTimestamp) / 1000
          : null))

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return null
    }

    const maxElevationDeg = Number.isFinite(option.maxElevationDeg)
      ? option.maxElevationDeg
      : row?.maxElevationDeg
    const rateMbps = getDemoDownlinkMbps(
      maxElevationDeg,
      getSatelliteAltitudeMeters(option.satId),
    )

    return {
      rateMbps,
      volumeGb: (rateMbps * durationSeconds) / 8000,
      maxElevation: option.maxElevation ?? row?.maxElevation ?? null,
    }
  }

  const toggleTimelineGroup = (groupId) => {
    setExpandedTimelineGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
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

  const handleTimelineItemClick = (item) => {
    if (item.kind !== 'link') {
      return
    }

    markLinkForNavigation(item.linkId, item.optionId)
  }

  const getOptionForOverpassId = (overpassId) => tradeOffCards
    .flatMap((card) => card.options)
    .find((option) => option.overpassId === overpassId) ?? null

  const handleOverviewTradeOffClick = (row) => {
    markLinkForNavigation(row.overpassId, getOptionForOverpassId(row.overpassId)?.optionId ?? null)
  }

  const renderTimelineBar = (item) => {
    const itemWidthPx = (item.durationMinutes / timelineModel.totalMinutes) * timelineWidthPx
    const compactBar = itemWidthPx < 120
    const tinyBar = itemWidthPx < 72
    const isLink = item.kind === 'link'
    // Both instances of the same link (satellite side and ground station side)
    // carry the same linkId, so marking one visibly marks the other -- that is
    // the "visuelle Verknuepfung" the asset rows exist for.
    const marked = isLink && markedTimelineLinkId !== null && markedTimelineLinkId === item.linkId

    return (
      <button
        key={item.id}
        type="button"
        className={[
          'timeline-bar',
          `timeline-bar--${item.variant}`,
          item.tradeOffColorIndex !== null && item.tradeOffColorIndex !== undefined ? 'timeline-bar--tradeoff' : '',
          compactBar ? 'timeline-bar--compact' : '',
          tinyBar ? 'timeline-bar--tiny' : '',
          isTimelineItemAtPlayhead(item) ? 'timeline-bar--playhead-active' : '',
          item.dimmed ? 'timeline-bar--dimmed' : '',
          marked ? 'timeline-bar--marked' : '',
          isLink ? '' : 'timeline-bar--static',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${(item.startMinutes / timelineModel.totalMinutes) * 100}%`,
          width: `${(item.durationMinutes / timelineModel.totalMinutes) * 100}%`,
          top: `calc(0.4rem + ${(item.laneIndex ?? 0) * 2.68}rem)`,
          '--tradeoff-accent': (item.tradeOffColorIndex !== null && item.tradeOffColorIndex !== undefined)
            ? getTradeOffAccentColor(item.tradeOffColorIndex)
            : 'transparent',
        }}
        onClick={() => handleTimelineItemClick(item)}
        aria-pressed={isLink ? marked : undefined}
        aria-label={`${item.label}. ${item.detail}. Start ${formatTimelineDateTime(item.startTime)}. End ${formatTimelineDateTime(item.endTime)}. Duration ${formatTimelineDuration(item.startTime, item.endTime)}.`}
      >
        <span className="timeline-bar-content">
          {item.recommended && !tinyBar && (
            <span className="timeline-bar-marker" aria-hidden="true"></span>
          )}
          <span className="timeline-bar-title">
            {tinyBar ? getCompactTimelineLabel(item.label) : item.label}
          </span>
          {!tinyBar && <span className="timeline-bar-copy">{item.detail}</span>}
        </span>
        <span className="timeline-bar-tooltip" role="tooltip">
          <span
            className="timeline-bar-tooltip-inner"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <strong>{item.label}</strong>
            {item.recommended && <span>Recommended option</span>}
            <span>{item.detail}</span>
            <span>Start: {formatTimelineDateTime(item.startTime)}</span>
            <span>End: {formatTimelineDateTime(item.endTime)}</span>
            <span>Duration: {formatTimelineDuration(item.startTime, item.endTime)}</span>
            {item.tradeOffScore && item.tradeOffScore !== '—' && (
              <span>Score: {item.tradeOffScore}</span>
            )}
            {item.blockMessage && <span>{item.blockMessage}</span>}
            {isLink && item.optionId && (
              <span className="timeline-bar-tooltip-hint">
                {marked ? 'Click again to clear the trade-off jump' : 'Click to jump to this trade-off option'}
              </span>
            )}
          </span>
        </span>
      </button>
    )
  }

  const getCompactTimelineLabel = (label) => {
    if (label.length <= 8 || label.startsWith('OP-')) {
      return label
    }

    return label.split(' ')[0]
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

  const renderTimeInput = (menuKey, value, setValue) => (
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
          onFocus={() => setActiveTimeMenu(menuKey)}
          onChange={(event) => setValue(formatTimeTextInput(event.target.value, value))}
          className="time-window-input time-window-input--combo"
        />
        <button
          type="button"
          className="time-window-input-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setActiveTimeMenu((current) => (current === menuKey ? null : menuKey))}
          aria-haspopup="listbox"
          aria-expanded={activeTimeMenu === menuKey}
          aria-label={`Toggle ${menuKey} time suggestions`}
        >
          <span className="time-window-select-arrow" aria-hidden="true">▾</span>
        </button>
      </div>
      {activeTimeMenu === menuKey && (
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

  const renderPlanningTimeActions = (target) => {
    const targetLabel = target === 'start' ? 'Start' : 'End'

    return (
      <div className="time-window-quick-actions" role="group" aria-label={`${targetLabel} time presets`}>
        <div className="time-window-quick-primary">
          <button
            type="button"
            className="time-window-quick-button time-window-quick-button--current"
            onClick={() => handleSetCurrentPlanningTime(target)}
          >
            Set current time
          </button>
          <button
            type="button"
            className="time-window-quick-button time-window-quick-button--reset"
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
              onClick={() => handleShiftPlanningTime(target, -60)}
            >
              -1h
            </button>
            <button
              type="button"
              className="time-window-quick-button"
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
              onClick={() => handleShiftPlanningTime(target, -24 * 60)}
            >
              -1 day
            </button>
            <button
              type="button"
              className="time-window-quick-button"
              onClick={() => handleShiftPlanningTime(target, 24 * 60)}
            >
              +1 day
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'landing') {
    return (
      <div className="app-shell">
        {appHeader(true)}
        <div className="app-content app-content--landing">
          <div className="landing-shell">
            <div className="landing-content">
              <div className="landing-info" role="status" aria-live="polite">
                <span className="landing-info-icon" aria-hidden="true">i</span>
                <p className="landing-info-text">
                  No assets loaded yet. Click the button to request from SatOS.
                </p>
              </div>

              <div className="landing-actions">
                <button
                  className="btn-fetch"
                  onClick={fetchAssets}
                  disabled={loading || backendAlive !== true || satosAlive !== true}
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

                {error && (
                  <div className="error-message">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {backendAlive === false && (
                  <p className="results-warning">
                    Please start your FastAPI server (<code>python run.py</code> in <code>backend/</code>) to test integration.
                  </p>
                )}

                {backendAlive === true && satosAlive === false && (
                  <p className="results-warning">
                    Backend is online, but SatOS access failed. Check credentials or current SatOS availability.
                  </p>
                )}
              </div>
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
                <div
                  className={`overview-inline-status ${
                    extractionStatus === 'Completed'
                      ? 'overview-inline-status--online'
                      : extractionStatus === 'Running' || extractionStatus === 'Queued'
                        ? 'overview-inline-status--checking'
                        : 'overview-inline-status--offline'
                  }`}
                >
                  {schedulerLaunched && (
                    <div className="overview-count-inline">
                      <span className="overview-status-label">Overpasses</span>
                      <span className="overview-count-value">{overviewRows.length}</span>
                    </div>
                  )}
                  <div className="overview-status-block">
                    <span className="overview-status-label">Status</span>
                    <div className="overview-status-value">
                      <span className="app-status-dot" aria-hidden="true"></span>
                      <span className="overview-status-text">{extractionStatus}</span>
                    </div>
                  </div>
                </div>
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
              ) : (
                <div className="overview-table-scroll">
                  <div className={`overview-list-header overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                    <span>Overpass ID</span>
                    <span>Sat ID</span>
                    <span>GS ID</span>
                    <span>Start</span>
                    <span>End</span>
                    <span>Max Elev.</span>
                    <span>Duration</span>
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--tradeoff">
                        <span>Trade-Off ID</span>
                        {useDemoData && schedulerLaunched && <span className="overview-header-note">Demo</span>}
                      </span>
                    )}
                    {tradeOffsCalculated && (
                      <span className="overview-header-cell overview-header-cell--score">
                        <span>Score</span>
                        {useDemoData && schedulerLaunched && <span className="overview-header-note">Demo</span>}
                      </span>
                    )}
                  </div>
                  {overviewRows.length === 0 ? (
                    <>
                      <div className={`overview-list-row overview-list-row--placeholder overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                        <span>OP-001</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                      </div>
                      <div className={`overview-list-row overview-list-row--placeholder overview-list-grid ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''}`}>
                        <span>OP-002</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        <span>Pending</span>
                        {tradeOffsCalculated && <span>—</span>}
                        {tradeOffsCalculated && <span>—</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      {overviewRows.map((row) => {
                        const isRecommendedRow = tradeOffsCalculated
                          && row.tradeOffId !== '—'
                          && row.tradeOffScore !== '—'
                          && tradeOffCards
                            .flatMap((card) => card.options)
                            .find((option) => option.overpassId === row.overpassId)?.recommended

                        return (
                          <div
                            key={row.overpassId}
                            className={`overview-list-row ${row.scheduleBlocked ? 'overview-list-row--blocked' : ''} ${isRecommendedRow ? 'overview-list-row--recommended' : ''} ${tradeOffsCalculated ? 'overview-list-grid--with-tradeoffs' : ''} overview-list-grid`}
                          >
                            <span className="overview-overpass-cell">
                              <span>{row.overpassId}</span>
                              {isRecommendedRow ? (
                                <span className="overview-row-note overview-row-note--recommended">
                                  Recommended
                                </span>
                              ) : null}
                              {row.scheduleBlocked && (
                                <span
                                  className="overview-row-note"
                                  title={getScheduleBlockMessage(row)}
                                >
                                  Blocked
                                </span>
                              )}
                            </span>
                            <span>{row.satId}</span>
                            <span>{row.gsId}</span>
                            <span>{formatDateTimeCompact(row.startTime)}</span>
                            <span>{formatDateTimeCompact(row.endTime)}</span>
                            <span>{row.maxElevation ?? '—'}</span>
                            <span>{row.duration}</span>
                            {tradeOffsCalculated && (
                              row.tradeOffId !== '—'
                                ? (
                                  <span className="overview-tradeoff-cell">
                                    <button
                                      type="button"
                                      className={`overview-tradeoff-button ${markedTimelineLinkId === row.overpassId ? 'overview-tradeoff-button--marked' : ''}`}
                                      onClick={() => handleOverviewTradeOffClick(row)}
                                      aria-pressed={markedTimelineLinkId === row.overpassId}
                                      title={`Show ${row.tradeOffId} and mark ${row.overpassId}`}
                                    >
                                      {renderTradeOffPill(row.tradeOffId, row.tradeOffColorIndex)}
                                    </button>
                                  </span>
                                )
                                : <span className="overview-tradeoff-cell">—</span>
                            )}
                            {tradeOffsCalculated && <span className="overview-score-cell">{row.tradeOffScore}</span>}
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
                  disabled={!schedulerLaunched || calculatingTradeOffs || !tradeOffDemoAvailable}
                  onClick={handleCalculateTradeOffs}
                >
                  {calculatingTradeOffs ? 'Calculating Trade-Offs...' : 'Calculate Trade-Offs'}
                </button>
                {!calculatingTradeOffs && (
                  <span className="panel-action-tooltip">
                    {!schedulerLaunched
                      ? 'Launch Communication Scheduler first and wait for extraction to complete.'
                      : !useDemoData
                        ? 'Trade-off calculation is not connected for real-data mode yet. Enable demo data to preview this workflow.'
                        : !tradeOffDemoAvailable
                          ? overviewRows.length > 0
                            ? 'All extracted overpasses are blocked by existing scheduled activities with higher priority.'
                            : 'Launch the scheduler first so extracted overpasses are available for the simulated trade-off step.'
                          : 'Calculate the simulated trade-off groups for the currently visible extracted overpasses.'}
                  </span>
                )}
              </div>
              </div>
            )}
          </section>
  )

  const tradeOffPanelNode = (
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
                {useDemoData && schedulerLaunched && renderDemoBadge()}
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
                {!tradeOffsCalculated && !useDemoData && (
                  <p>Enable Demo mode to use Trade-Off view.</p>
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
                      {card.options.map((option) => {
                        const budget = getOptionLinkBudget(option)

                        return (
                          <div
                            key={option.optionId}
                            data-option-id={option.optionId}
                            className={[
                              'tradeoff-option',
                              selectedTradeOffOption === option.optionId ? 'tradeoff-option--selected' : '',
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
                                <span className="tradeoff-score">{option.score}</span>
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
                                <dd>{budget ? formatGb(budget.volumeGb) : '—'}</dd>
                              </div>
                              <div className="tradeoff-option-fact">
                                <dt>Max Elev.</dt>
                                <dd>{option.maxElevation ?? budget?.maxElevation ?? '—'}</dd>
                              </div>
                            </dl>

                            <button
                              type="button"
                              className="tradeoff-select-button"
                              onClick={() => handleSelectTradeOffOption(option)}
                            >
                              {selectedTradeOffOption === option.optionId ? 'Selected' : 'Select'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
                  </div>
                )}
              </div>
            )}
          </section>
  )

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
                {useDemoData && renderDemoBadge()}
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
                        heightPx={mapViewHeightPx}
                        assets={visibleMapAssets}
                        satelliteTracks={satelliteTracks}
                        activeAssetId={activeMapAsset?.id ?? null}
                        onSelectAsset={setActiveMapAssetId}
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
                          <label className="demo-switch">
                            <input
                              type="checkbox"
                              checked={showGroundStationVisibilityCircles}
                              disabled={!schedulerLaunched}
                              onChange={() =>
                                setShowGroundStationVisibilityCircles((current) => !current)
                              }
                            />
                            <span className="demo-switch-track" aria-hidden="true">
                              <span className="demo-switch-thumb"></span>
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
                          <label className="demo-switch">
                            <input
                              type="checkbox"
                              checked={showSatelliteVisibilityCircles}
                              disabled={!schedulerLaunched}
                              onChange={() =>
                                setShowSatelliteVisibilityCircles((current) => !current)
                              }
                            />
                            <span className="demo-switch-track" aria-hidden="true">
                              <span className="demo-switch-thumb"></span>
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
                          <label className="demo-switch">
                            <input
                              type="checkbox"
                              checked={showGroundTracks}
                              disabled={!schedulerLaunched}
                              onChange={() => setShowGroundTracks((current) => !current)}
                            />
                            <span className="demo-switch-track" aria-hidden="true">
                              <span className="demo-switch-thumb"></span>
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
                      <div className="map-asset-card-list">
                        {visibleMapAssets.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
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
                    <div className="timeline-toggle-group" role="group" aria-label="Timeline view controls">
                      <div className="timeline-zoom-control" role="group" aria-label="Timeline zoom">
                        {TIMELINE_ZOOM_LEVELS.map((level) => (
                          <button
                            key={level.id}
                            type="button"
                            className={`timeline-zoom-option ${timelineZoomLevel === level.id && timelineCustomZoomMultiplier === null ? 'timeline-zoom-option--active' : ''}`}
                            onClick={() => {
                              setTimelineZoomLevel(level.id)
                              setTimelineCustomZoomMultiplier(null)
                            }}
                          >
                            {level.label}
                          </button>
                        ))}
                      </div>
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
                  </div>
                  {!useDemoData && (
                    <div className="timeline-toolbar-copy">
                      Current schedule activities and extracted overpasses use backend timestamps. Proposed scheduling remains empty until the backend trade-off workflow is connected.
                    </div>
                  )}
                </div>

                {timelineRenderRows.length === 0 ? (
                  <p className="timeline-empty-copy">Enable at least one timeline layer to display the schedule view.</p>
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
                          return (
                            <div
                              key={`${renderRow.key}-label`}
                              className="timeline-label-cell timeline-label-cell--section"
                              style={rowStyle}
                            >
                              <span className="timeline-section-name">{renderRow.label}</span>
                            </div>
                          )
                        }

                        if (renderRow.type === 'group') {
                          const groupExpanded = Boolean(expandedTimelineGroups[renderRow.group.id])

                          return (
                            <div
                              key={`${renderRow.key}-label`}
                              className={`timeline-label-cell timeline-label-cell--group ${groupExpanded ? 'timeline-label-cell--group-open' : ''}`}
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

                        return (
                          <div
                            key={`${renderRow.key}-label`}
                            className="timeline-label-cell timeline-label-cell--link"
                            style={rowStyle}
                          >
                            <span className="timeline-link-name">{renderRow.row.counterpartName}</span>
                            <span className="timeline-link-copy">{renderRow.row.label}</span>
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
                      >
                        {timelinePlayheadWindowRatio !== null && (
                          <div
                            ref={timelinePlayheadThumbRef}
                            className="timeline-playhead-thumb"
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
                              {timelineLive && <span className="timeline-playhead-live">Live</span>}
                              {formatTimelinePlayheadDateTime(timelinePlayheadTimestamp)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div
                        ref={timelineScrollRef}
                        className="timeline-scroll"
                        tabIndex="0"
                        role="region"
                        aria-label="Interactive planning timeline"
                        onPointerDown={pauseTimelineLiveMode}
                        onTouchStart={pauseTimelineLiveMode}
                        onKeyDown={handleTimelineKeyDown}
                      >
                        <div
                          className="timeline-time-canvas"
                          style={{ width: `${timelineWidthPx}px` }}
                        >
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

                        {/* A position:absolute child's percentage `left`
                            resolves against its CONTAINING BLOCK's
                            padding-box -- for a direct child of the padded
                            .timeline-time-canvas that's the canvas's full
                            (padding-inclusive) width, which is NOT what the
                            r*100% values here are computed against. Plain,
                            non-padded rows like this one (and axis-row,
                            track-row below) don't have that problem, so the
                            now-line/marker-line are rendered once per row
                            instead of once for the whole canvas -- see
                            getTimelineScrollLeftForRatio's comment for the
                            full derivation this depends on staying true. */}
                        {timelineModel.nowOffsetMinutes >= 0 && timelineModel.nowOffsetMinutes <= timelineModel.totalMinutes && (
                          <div
                            className="timeline-now-line"
                            style={{ left: `${(timelineModel.nowOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                          >
                            <span className="timeline-now-badge">Now</span>
                          </div>
                        )}

                        {timelinePlayheadOffsetMinutes !== null
                          && timelinePlayheadOffsetMinutes >= 0
                          && timelinePlayheadOffsetMinutes <= timelineModel.totalMinutes && (
                          <div
                            className="timeline-playhead-marker-line"
                            aria-hidden="true"
                            style={{ left: `${(timelinePlayheadOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                            onPointerDown={handleTimelineMarkerLinePointerDown}
                            onPointerMove={handleTimelineMarkerLinePointerMove}
                            onPointerUp={handleTimelineMarkerLinePointerUp}
                            onPointerCancel={handleTimelineMarkerLinePointerUp}
                          ></div>
                        )}
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

                        {timelineModel.nowOffsetMinutes >= 0 && timelineModel.nowOffsetMinutes <= timelineModel.totalMinutes && (
                          <div
                            className="timeline-now-line"
                            style={{ left: `${(timelineModel.nowOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                          ></div>
                        )}

                        {timelinePlayheadOffsetMinutes !== null
                          && timelinePlayheadOffsetMinutes >= 0
                          && timelinePlayheadOffsetMinutes <= timelineModel.totalMinutes && (
                          <div
                            className="timeline-playhead-marker-line"
                            aria-hidden="true"
                            style={{ left: `${(timelinePlayheadOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                            onPointerDown={handleTimelineMarkerLinePointerDown}
                            onPointerMove={handleTimelineMarkerLinePointerMove}
                            onPointerUp={handleTimelineMarkerLinePointerUp}
                            onPointerCancel={handleTimelineMarkerLinePointerUp}
                          ></div>
                        )}
                      </div>

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

                        const rowItems = renderRow.type === 'group'
                          ? renderRow.group.items
                          : renderRow.row.items

                        return (
                          <div
                            key={`${renderRow.key}-row`}
                            className={`timeline-track-row timeline-track-row--${renderRow.type}`}
                            style={rowStyle}
                          >
                            {timelineModel.ticks.map((tick) => (
                              <div
                                key={`${renderRow.key}-tick-${tick.offsetMinutes}`}
                                className={`timeline-grid-line ${tick.offsetMinutes % 120 === 0 ? 'timeline-grid-line--major' : ''}`}
                                style={{ left: `${(tick.offsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                              ></div>
                            ))}

                            {rowItems.map((item) => renderTimelineBar(item))}

                            {timelineModel.nowOffsetMinutes >= 0 && timelineModel.nowOffsetMinutes <= timelineModel.totalMinutes && (
                              <div
                                className="timeline-now-line"
                                style={{ left: `${(timelineModel.nowOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                              ></div>
                            )}

                            {timelinePlayheadOffsetMinutes !== null
                              && timelinePlayheadOffsetMinutes >= 0
                              && timelinePlayheadOffsetMinutes <= timelineModel.totalMinutes && (
                              <div
                                className="timeline-playhead-marker-line"
                                aria-hidden="true"
                                style={{ left: `${(timelinePlayheadOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                                onPointerDown={handleTimelineMarkerLinePointerDown}
                                onPointerMove={handleTimelineMarkerLinePointerMove}
                                onPointerUp={handleTimelineMarkerLinePointerUp}
                                onPointerCancel={handleTimelineMarkerLinePointerUp}
                              ></div>
                            )}
                          </div>
                        )
                      })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="timeline-confirmation">
                  <div className="timeline-confirmation-copy">
                    <div className="timeline-confirmation-heading">
                      <span className="timeline-confirmation-title">Confirm Communication Schedule</span>
                      {useDemoData && renderDemoBadge()}
                    </div>
                    <span className="timeline-confirmation-text">
                      {useDemoData
                        ? 'Demo mode simulates activity generation, SatOS write calls and the final confirmation state.'
                        : 'Confirmation remains unavailable until the backend write workflow is connected.'}
                    </span>
                  </div>
                  <div className="timeline-confirmation-actions">
                    <button
                      type="button"
                      className="btn-fetch timeline-confirm-button"
                      disabled={!confirmDemoAvailable || confirmingSchedule}
                      onClick={handleConfirmSchedule}
                    >
                      {confirmingSchedule ? 'Confirming...' : 'Confirm Communication Schedule'}
                    </button>
                    {!confirmingSchedule && !confirmDemoAvailable && (
                      <span className="timeline-confirmation-tooltip">
                        {!useDemoData
                          ? 'Enable Demo to preview the confirmation workflow.'
                          : !schedulerLaunched
                            ? 'Launch Communication Scheduler first.'
                            : !tradeOffsCalculated
                              ? 'Calculate Trade-Offs first so a final schedule exists.'
                              : finalScheduleRows.length === 0
                                ? 'No schedulable links remain for confirmation.'
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
                        {confirmedScheduleCount} schedule entr{confirmedScheduleCount === 1 ? 'y was' : 'ies were'} confirmed in the demo workflow.
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

  // Same time span, same canvas width, same 50% inline padding as the timeline
  // canvas -- that is what lets a single scrollLeft value be mirrored between
  // the two panels and keeps every step directly under its link.
  const dataVolumeYMaxGb = dataVolumeCapacityGb * 1.06

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

  const dataVolumePanelNode = (
          <section
            className={`panel data-volume-panel ${expandedSections.dataVolume ? '' : 'panel--collapsed'}${getPanelDragClassName('dataVolume')}`}
            {...getPanelDropZoneProps('dataVolume')}
          >
            <div
              className={`panel-heading panel-heading--data-volume ${expandedSections.dataVolume ? '' : 'panel-heading--collapsed'}`}
              {...getPanelHeadingDragProps('dataVolume')}
            >
              <div className="panel-heading-lead">
                {renderPanelDragHandle('dataVolume')}
                <div className="panel-heading-title">
                  <h2>Data Volume</h2>
                </div>
              </div>
              <div className="panel-heading-actions">
                <button
                  type="button"
                  className="panel-collapse-toggle"
                  onClick={() => toggleSection('dataVolume')}
                  aria-expanded={expandedSections.dataVolume}
                  aria-controls="data-volume-panel-content"
                  aria-label={expandedSections.dataVolume ? 'Collapse data volume view' : 'Expand data volume view'}
                >
                  <span className="section-toggle-icon" aria-hidden="true">
                    {renderSectionChevron(expandedSections.dataVolume)}
                  </span>
                </button>
              </div>
            </div>

            {expandedSections.dataVolume && (
              <div id="data-volume-panel-content" className="panel-collapsible-content">
                <div className="data-volume-toolbar">
                  <label className="data-volume-field">
                    <span>Initial fill</span>
                    <span className="data-volume-input-wrap">
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={dataStartFillGb}
                        onChange={(event) => setDataStartFillGb(event.target.value)}
                      />
                      <span className="data-volume-unit">GB</span>
                    </span>
                  </label>
                  <label className="data-volume-field">
                    <span>Generation</span>
                    <span className="data-volume-input-wrap">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={dataGenerationMbps}
                        onChange={(event) => setDataGenerationMbps(event.target.value)}
                      />
                      <span className="data-volume-unit">Mbit/s</span>
                    </span>
                  </label>
                  <label className="data-volume-field">
                    <span>Capacity</span>
                    <span className="data-volume-input-wrap">
                      <input
                        type="number"
                        min="1"
                        step="10"
                        value={dataCapacityGb}
                        onChange={(event) => setDataCapacityGb(event.target.value)}
                      />
                      <span className="data-volume-unit">GB</span>
                    </span>
                  </label>
                  <span className="data-volume-toolbar-copy">
                    Demo model: downlink rate scales with 1/range² from each pass's maximum elevation and the satellite's mean orbit altitude.
                  </span>
                </div>

                {!schedulerLaunched && (
                  <p className="timeline-empty-copy">
                    Launch Communication Scheduler to initialize the data budget view.
                  </p>
                )}

                {schedulerLaunched && !dataVolumeModel && (
                  <p className="timeline-empty-copy">No planning window is active yet.</p>
                )}

                {schedulerLaunched && dataVolumeModel && dataVolumeModel.series.length === 0 && (
                  <p className="timeline-empty-copy">
                    Expand a satellite group in the timeline to show its on-board data budget here.
                  </p>
                )}

                {schedulerLaunched && dataVolumeModel && dataVolumeModel.series.length > 0 && (
                  <div className="timeline-layout">
                    <div className="timeline-label-column">
                      <div className="timeline-label-cell timeline-label-cell--axis"></div>
                      {dataVolumeModel.series.map((series) => (
                        <div
                          key={`${series.id}-label`}
                          className="timeline-label-cell data-volume-label-cell"
                        >
                          <span className="timeline-link-name">{series.name}</span>
                          <span className="data-volume-axis-label">
                            {formatGb(dataVolumeModel.capacityGb)} capacity
                          </span>
                          <span className="data-volume-flags">
                            {series.overflowed && (
                              <span className="data-volume-flag data-volume-flag--overflow">Buffer full</span>
                            )}
                            {series.starved && (
                              <span className="data-volume-flag data-volume-flag--starved">Link idle</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="timeline-scroll-frame data-volume-scroll-frame">
                      <div
                        ref={dataVolumeScrollRef}
                        className="timeline-scroll"
                        tabIndex="0"
                        role="region"
                        aria-label="On-board data volume over the planning window"
                      >
                        <div
                          className="timeline-time-canvas"
                          style={{ width: `${timelineWidthPx}px` }}
                        >
                          <div className="timeline-axis-row">
                            {timelineModel.ticks.map((tick) => (
                              <div
                                key={`data-tick-${tick.offsetMinutes}`}
                                className={`timeline-axis-marker ${tick.offsetMinutes % 120 === 0 ? 'timeline-axis-marker--major' : ''}`}
                                style={{ left: `${(tick.offsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                              >
                                <span>{tick.label}</span>
                              </div>
                            ))}
                          </div>

                          {dataVolumeModel.series.map((series) => (
                            <div key={`${series.id}-row`} className="data-volume-row">
                              {timelineModel.ticks.map((tick) => (
                                <div
                                  key={`${series.id}-grid-${tick.offsetMinutes}`}
                                  className={`timeline-grid-line ${tick.offsetMinutes % 120 === 0 ? 'timeline-grid-line--major' : ''}`}
                                  style={{ left: `${(tick.offsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                                ></div>
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
                                  y1={100 - ((dataVolumeModel.capacityGb / dataVolumeYMaxGb) * 100)}
                                  y2={100 - ((dataVolumeModel.capacityGb / dataVolumeYMaxGb) * 100)}
                                />
                                {series.alternative && (
                                  <polyline
                                    className="data-volume-curve data-volume-curve--alternative"
                                    points={buildDataVolumePolyline(series.alternative.points)}
                                  />
                                )}
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
                                  aria-label={`${step.label}: ${Math.round(step.downlinkMbps)} megabit per second, ${formatGb(step.transferredGb)} downlinked.`}
                                >
                                  <span className="timeline-bar-tooltip" role="tooltip">
                                    <span className="timeline-bar-tooltip-inner">
                                      <strong>{step.label}</strong>
                                      <span>{series.name} → {step.gsId}</span>
                                      <span>Rate: {Math.round(step.downlinkMbps)} Mbit/s</span>
                                      <span>Downlinked: {formatGb(step.transferredGb)}</span>
                                      <span>Buffer: {formatGb(step.levelBefore)} → {formatGb(step.levelAfter)}</span>
                                      {step.maxElevation && <span>Max elevation: {step.maxElevation}</span>}
                                    </span>
                                  </span>
                                </button>
                              ))}

                              {timelineModel.nowOffsetMinutes >= 0 && timelineModel.nowOffsetMinutes <= timelineModel.totalMinutes && (
                                <div
                                  className="timeline-now-line"
                                  style={{ left: `${(timelineModel.nowOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                                ></div>
                              )}

                              {timelinePlayheadOffsetMinutes !== null
                                && timelinePlayheadOffsetMinutes >= 0
                                && timelinePlayheadOffsetMinutes <= timelineModel.totalMinutes && (
                                <div
                                  className="timeline-playhead-marker-line"
                                  aria-hidden="true"
                                  style={{ left: `${(timelinePlayheadOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                                ></div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
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
    dataVolume: dataVolumePanelNode,
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
                  {expandedSections.timeWindow && (
                    <div className="time-window-panel">
                      <div className="time-window-header">
                        <span className="time-window-title">Planning Interval</span>
                        <div className="time-window-zone-toggle" role="group" aria-label="Planning interval time zone">
                          <button
                            type="button"
                            className={`time-window-zone-button ${planningTimeMode === 'utc' ? 'time-window-zone-button--active' : ''}`}
                            onClick={() => handlePlanningTimeModeChange('utc')}
                            aria-pressed={planningTimeMode === 'utc'}
                          >
                            UTC
                          </button>
                          <button
                            type="button"
                            className={`time-window-zone-button ${planningTimeMode === 'local' ? 'time-window-zone-button--active' : ''}`}
                            onClick={() => handlePlanningTimeModeChange('local')}
                            aria-pressed={planningTimeMode === 'local'}
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
                            onChange={(event) => {
                              setPlanningWindowStartDate(event.target.value)
                              event.target.blur()
                            }}
                            className="time-window-input"
                          />
                        </label>
                        <label className="time-window-field time-window-field--time">
                          <span>Start Time</span>
                          {renderTimeInput('start', planningWindowStartTime, setPlanningWindowStartTime)}
                        </label>
                      </div>
                      {renderPlanningTimeActions('start')}
                      <div className="time-window-row">
                        <label className="time-window-field">
                          <span>End Date</span>
                          <input
                            type="date"
                            value={planningWindowEndDate}
                            onChange={(event) => {
                              setPlanningWindowEndDate(event.target.value)
                              event.target.blur()
                            }}
                            className="time-window-input"
                          />
                        </label>
                        <label className="time-window-field time-window-field--time">
                          <span>End Time</span>
                          {renderTimeInput('end', planningWindowEndTime, setPlanningWindowEndTime)}
                        </label>
                      </div>
                      {renderPlanningTimeActions('end')}
                      {planningWindowComplete && !planningWindowValid && (
                        <p className="time-window-error">
                          Enter a valid time window with an end time after the start time.
                        </p>
                      )}
                      <p className="time-window-note">
                        {planningTimeMode === 'utc'
                          ? 'Using UTC standard time. Propagation is limited to this interval.'
                          : 'Using local time. Propagation is limited to this interval.'}
                      </p>
                    </div>
                  )}
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
              </div>

              <div className="sidebar-action-wrapper">
                {launchingScheduler ? (
                  <button
                    type="button"
                    className="btn-fetch btn-terminate"
                    onClick={handleTerminateScheduler}
                  >
                    Terminate
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
              gridTemplateColumns: `minmax(0, ${overviewPanelWidth}%) 0.9rem minmax(0, calc(${100 - overviewPanelWidth}% - 0.9rem))`,
              '--top-panels-height': `${topPanelsHeightPx}px`,
            }}
          >
          {panelNodesById[panelSlotAssignment.topLeft]}

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
          </div>

          <div
            className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.topLeft] && !expandedSections[panelSlotAssignment.topRight] ? 'panel-resizer--collapsed' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the height of the overview and trade-off panels"
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
              gridTemplateRows: `${bottomTopHeightPx}px 0.9rem auto 0.9rem ${bottomBottomHeightPx}px`,
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

          <div
            className={`panel-resizer panel-resizer--horizontal ${!expandedSections[panelSlotAssignment.bottomMiddle] && !expandedSections[panelSlotAssignment.bottomBottom] ? 'panel-resizer--collapsed' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize the ${PANEL_LABELS[panelSlotAssignment.bottomBottom]} panel`}
            tabIndex={0}
            onPointerDown={handleBottomRowResizeStart}
            onKeyDown={handleBottomRowResizeKeyDown}
          >
            <span className="panel-resizer-line panel-resizer-line--horizontal" aria-hidden="true"></span>
            <span className="panel-resizer-grip panel-resizer-grip--horizontal" aria-hidden="true"></span>
          </div>

          {panelNodesById[panelSlotAssignment.bottomBottom]}
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
