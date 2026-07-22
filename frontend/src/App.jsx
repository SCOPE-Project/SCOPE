import { Fragment, useEffect, useRef, useState } from 'react'

const BACKEND_BASE_URL = 'http://localhost:8000'
const TRADE_OFF_ACCENT_COLORS = ['#c56b2d', '#5b7cfa', '#2a9d8f', '#9b5de5']
const TIMELINE_ZOOM_LEVELS = [
  { id: 'fit', label: 'Fit', multiplier: 1 },
  { id: 'detail', label: 'Detail', multiplier: 5.2 },
]
const DEMO_REGION_BOUNDS = {
  minLatitude: 60.947647,
  maxLatitude: 81.270510,
  minLongitude: -44.748194,
  maxLongitude: 79.120215,
}
const MAP_TILE_SIZE = 256
const DEMO_REGION_MAP_ZOOM = 6

export default function App() {
  const splitPanelsRef = useRef(null)
  const splitDragCleanupRef = useRef(null)
  const [assets, setAssets] = useState([])
  const [assetSchedules, setAssetSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [backendAlive, setBackendAlive] = useState(null)
  const [satosAlive, setSatosAlive] = useState(null)
  const [view, setView] = useState('landing')
  const [selectedSatellites, setSelectedSatellites] = useState([])
  const [selectedGroundStations, setSelectedGroundStations] = useState([])
  const [planningWindowStartDate, setPlanningWindowStartDate] = useState('')
  const [planningWindowStartTime, setPlanningWindowStartTime] = useState('00:00')
  const [planningWindowEndDate, setPlanningWindowEndDate] = useState('')
  const [planningWindowEndTime, setPlanningWindowEndTime] = useState('23:59')
  const [activeTimeMenu, setActiveTimeMenu] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [launchingScheduler, setLaunchingScheduler] = useState(false)
  const [schedulerLaunched, setSchedulerLaunched] = useState(false)
  const [overviewRows, setOverviewRows] = useState([])
  const [extractionStatus, setExtractionStatus] = useState('Not started')
  const [calculatingTradeOffs, setCalculatingTradeOffs] = useState(false)
  const [useDemoData, setUseDemoData] = useState(false)
  const [tradeOffsCalculated, setTradeOffsCalculated] = useState(false)
  const [tradeOffCards, setTradeOffCards] = useState([])
  const [activeTradeOffCardIndex, setActiveTradeOffCardIndex] = useState(0)
  const [selectedTradeOffOption, setSelectedTradeOffOption] = useState(null)
  const [overviewPanelWidth, setOverviewPanelWidth] = useState(58)
  const [confirmingSchedule, setConfirmingSchedule] = useState(false)
  const [confirmationProgress, setConfirmationProgress] = useState(0)
  const [confirmationStep, setConfirmationStep] = useState('')
  const [confirmationSuccess, setConfirmationSuccess] = useState(false)
  const [confirmedScheduleCount, setConfirmedScheduleCount] = useState(0)
  const [activeMapAssetId, setActiveMapAssetId] = useState(null)
  const [activePlanningWindow, setActivePlanningWindow] = useState(null)
  const [timelineNow, setTimelineNow] = useState(() => Date.now())
  const [timelineZoomLevel, setTimelineZoomLevel] = useState('detail')
  const [timelineLayers, setTimelineLayers] = useState({
    current: true,
    potential: true,
    proposed: true,
  })
  const [expandedSections, setExpandedSections] = useState({
    timeWindow: true,
    satellites: true,
    groundStations: true,
    unavailableAssets: false,
    mapView: false,
  })

  useEffect(() => {
    let active = true
    let intervalId = null

    const checkConnections = async () => {
      try {
        const backendResponse = await fetch(`${BACKEND_BASE_URL}/status`, {
          cache: 'no-store',
        })
        if (!active) {
          return
        }

        if (backendResponse.ok) {
          setBackendAlive(true)

          try {
            const satosResponse = await fetch(`${BACKEND_BASE_URL}/satos/asset/list`, {
              cache: 'no-store',
            })
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
    }, 60000)

    return () => window.clearInterval(intervalId)
  }, [schedulerLaunched])

  useEffect(() => () => {
    if (splitDragCleanupRef.current) {
      splitDragCleanupRef.current()
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

  const formatDateTimeCompact = (value) => {
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

  const getDayOfYear = (date) => {
    const start = new Date(date.getFullYear(), 0, 0)
    const diff = date - start
    return Math.floor(diff / 86400000)
  }

  const parseDurationMinutes = (value) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 30
  }

  const formatTimelineHour = (date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const formatTimelineDateTime = (value) => {
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
    })
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

  const formatTimelineDay = (date) =>
    `${date.toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: '2-digit',
    })} (DOY ${getDayOfYear(date)})`

  const formatPlanningWindow = (startValue, endValue) => {
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

    const sameDay = start.toDateString() === end.toDateString()

    if (sameDay) {
      return `${start.toLocaleDateString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      })}, ${start.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })} - ${end.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    }

    return `${formatTimelineDateTime(startValue)} - ${formatTimelineDateTime(endValue)}`
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

  const buildDayBands = (baseDate, totalMinutes) => {
    const bands = []
    let cursor = new Date(baseDate)
    cursor.setHours(0, 0, 0, 0)

    while (bands.length === 0 || cursor < new Date(baseDate.getTime() + totalMinutes * 60000)) {
      const nextDay = new Date(cursor)
      nextDay.setDate(cursor.getDate() + 1)

      const startMinutes = Math.max(0, (cursor.getTime() - baseDate.getTime()) / 60000)
      const endMinutes = Math.min(totalMinutes, (nextDay.getTime() - baseDate.getTime()) / 60000)

      if (endMinutes > startMinutes) {
        bands.push({
          startMinutes,
          widthMinutes: endMinutes - startMinutes,
          label: formatTimelineDay(cursor),
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

  const buildTimelineModel = (rows, groups, currentTimestamp, currentScheduleItems, planningWindow) => {
    const selectedOptions = groups.map((group) => getSelectedTradeOffForGroup(group))
    const selectedOverpassIds = new Set(selectedOptions.map((option) => option.overpassId))
    const optionByOverpassId = new Map(
      groups
        .flatMap((group) => group.options)
        .map((option) => [option.overpassId, option]),
    )

    const potentialSourceItems = rows
      .filter((row) => !row.scheduleBlocked)
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

        return {
          id: `potential-${row.overpassId}`,
          label: row.overpassId,
          startTime: row.startTime,
          endTime: row.endTime,
          detail: row.tradeOffId && row.tradeOffId !== '—'
            ? `${row.satId} → ${row.gsId} · ${row.tradeOffId}`
            : `${row.satId} → ${row.gsId}`,
          variant: row.tradeOffId && row.tradeOffId !== '—' ? 'candidate' : 'neutral',
          startTimestamp,
          endTimestamp,
          tradeOffId: row.tradeOffId ?? null,
          tradeOffScore: row.tradeOffScore ?? null,
          tradeOffColorIndex: row.tradeOffColorIndex ?? null,
          optionId: linkedOption?.optionId ?? null,
          recommended: linkedOption?.recommended ?? false,
        }
      })
      .filter(Boolean)

    const proposedSourceItems = (tradeOffsCalculated ? rows : [])
      .filter((row) => !row.scheduleBlocked)
      .filter((row) => row.tradeOffId === '—' || selectedOverpassIds.has(row.overpassId))
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

        const chosenOption = selectedOptions.find((option) => option.overpassId === row.overpassId)

        return {
          id: `proposed-${row.overpassId}`,
          label: row.overpassId,
          startTime: row.startTime,
          endTime: row.endTime,
          detail: row.tradeOffId && row.tradeOffId !== '—'
            ? `${row.satId} → ${row.gsId} · ${row.tradeOffId}`
            : `${row.satId} → ${row.gsId}`,
          variant: chosenOption
            ? chosenOption.optionId === selectedTradeOffOption
              ? 'selected'
              : 'recommended'
            : 'fixed',
          startTimestamp,
          endTimestamp,
          tradeOffId: row.tradeOffId ?? null,
          tradeOffScore: row.tradeOffScore ?? null,
          tradeOffColorIndex: row.tradeOffColorIndex ?? null,
          optionId: chosenOption?.optionId ?? null,
          recommended: chosenOption?.recommended ?? false,
        }
      })
      .filter(Boolean)

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

        return {
          id: item.id,
          label: item.label,
          startTime: item.startTime,
          endTime: item.endTime,
          detail: item.detail,
          variant: 'current',
          startTimestamp,
          endTimestamp,
          optionId: null,
          tradeOffId: null,
          tradeOffScore: null,
          tradeOffColorIndex: null,
          recommended: false,
        }
      })
      .filter(Boolean)

    const allTimestampItems = [
      ...currentSourceItems,
      ...potentialSourceItems,
      ...proposedSourceItems,
    ]

    if (allTimestampItems.length === 0) {
      return null
    }

    const planningStartTimestamp = toTimestamp(planningWindow?.startTime)
    const planningEndTimestamp = toTimestamp(planningWindow?.endTime)
    const minTimestamp = Math.min(...allTimestampItems.map((item) => item.startTimestamp))
    const maxTimestamp = Math.max(...allTimestampItems.map((item) => item.endTimestamp))
    const baseTimestamp = planningStartTimestamp ?? (minTimestamp - 30 * 60000)
    const endTimestamp = planningEndTimestamp ?? (maxTimestamp + 30 * 60000)
    const totalMinutes = Math.max(60, Math.ceil((endTimestamp - baseTimestamp) / 60000))
    const baseDate = new Date(baseTimestamp)

    const mapToTimelineItem = (item) => ({
      ...item,
      startMinutes: (item.startTimestamp - baseTimestamp) / 60000,
      durationMinutes: Math.max(5, (item.endTimestamp - item.startTimestamp) / 60000),
    })

    const currentItems = layoutTimelineItems(currentSourceItems.map(mapToTimelineItem))
    const potentialItems = layoutTimelineItems(potentialSourceItems.map(mapToTimelineItem))
    const proposedItems = layoutTimelineItems(proposedSourceItems.map(mapToTimelineItem))

    const ticks = Array.from({ length: Math.floor(totalMinutes / 60) + 2 }, (_, index) => {
      const offsetMinutes = index * 60
      const tickDate = new Date(baseDate.getTime() + offsetMinutes * 60000)
      return {
        offsetMinutes,
        date: tickDate,
        label: formatTimelineHour(tickDate),
      }
    }).filter((tick) => tick.offsetMinutes <= totalMinutes)

    return {
      baseDate,
      endDate: new Date(baseDate.getTime() + totalMinutes * 60000),
      totalMinutes,
      widthPx: Math.max(980, totalMinutes * 2.2),
      ticks,
      dayBands: buildDayBands(baseDate, totalMinutes),
      nowOffsetMinutes: (currentTimestamp - baseDate.getTime()) / 60000,
      tracks: [
        {
          id: 'current',
          label: 'Current SatOS Schedule',
          copy: 'Activities imported from the selected SatOS schedules.',
          laneCount: currentItems.laneCount,
          items: currentItems.items,
        },
        {
          id: 'potential',
          label: 'Potential Links',
          copy: useDemoData
            ? 'Extracted windows with demo trade-off context.'
            : 'All extracted communication windows before trade-off resolution.',
          demoLabel: useDemoData ? 'Demo' : null,
          laneCount: potentialItems.laneCount,
          items: potentialItems.items,
        },
        {
          id: 'proposed',
          label: 'Proposed Schedule',
          copy: useDemoData
            ? 'Current simulated trade-off selection.'
            : 'Current frontend selection of the available trade-off options.',
          demoLabel: useDemoData ? 'Demo' : null,
          laneCount: proposedItems.laneCount,
          items: proposedItems.items,
        },
      ],
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
    setSelectedSatellites([])
    setSelectedGroundStations([])
    setPlanningWindowStartDate('')
    setPlanningWindowStartTime('00:00')
    setPlanningWindowEndDate('')
    setPlanningWindowEndTime('23:59')
    setActiveTimeMenu(null)
    setSidebarCollapsed(false)
    setLaunchingScheduler(false)
    setSchedulerLaunched(false)
    setOverviewRows([])
    setExtractionStatus('Not started')
    setCalculatingTradeOffs(false)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption(null)
    setActiveMapAssetId(null)
    setActivePlanningWindow(null)
    setTimelineNow(Date.now())
    setTimelineZoomLevel('detail')
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
      mapView: false,
    })
    setConfirmingSchedule(false)
    setConfirmationProgress(0)
    setConfirmationStep('')
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
  }

  const localDateAndTimeToIso = (dateValue, timeValue) => {
    if (!dateValue || !timeValue) {
      return null
    }

    const combined = new Date(`${dateValue}T${timeValue}`)
    if (!Number.isFinite(combined.getTime())) {
      return null
    }

    return combined.toISOString()
  }

  const wait = (durationMs) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, durationMs)
    })

  const pollTaskResult = async (taskId) => {
    while (true) {
      const statusResponse = await fetch(`${BACKEND_BASE_URL}/tasks/status/${taskId}`)
      if (!statusResponse.ok) {
        throw new Error(`Status polling failed with ${statusResponse.status}`)
      }

      const taskStatus = await statusResponse.json()

      if (taskStatus.status === 'completed') {
        const resultResponse = await fetch(`${BACKEND_BASE_URL}/tasks/status/${taskId}/result`)
        if (!resultResponse.ok) {
          throw new Error(`Result request failed with ${resultResponse.status}`)
        }

        return resultResponse.json()
      }

      if (taskStatus.status === 'failed') {
        throw new Error(taskStatus.message || 'Overpass extraction failed.')
      }

      await wait(1200)
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
      startTime: localDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime),
      endTime: localDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime),
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
    setSchedulerLaunched(true)
    setTradeOffsCalculated(false)
    setTradeOffCards([])
    setActiveTradeOffCardIndex(0)
    setSelectedTradeOffOption(null)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
    setTimelineNow(Date.now())
    setSidebarCollapsed(true)

    setActivePlanningWindow(planningWindow)

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
      })

      if (!response.ok) {
        throw new Error(`Scheduler launch failed with status ${response.status}`)
      }

      setExtractionStatus('Running')

      const receipt = await response.json()
      const result = await pollTaskResult(receipt.task_id)
      const scheduleItems = buildCurrentScheduleItems(
        assetSchedules,
        [...selectedSatellites, ...selectedGroundStations],
      )
      const realRows = annotateRowsWithSchedulePriority(
        buildOverviewRowsFromOverpasses(result?.payload?.overpass_blocks ?? []),
        scheduleItems,
      )

      setOverviewRows(realRows)
      setExtractionStatus('Completed')
    } catch (err) {
      console.error(err)
      setOverviewRows([])
      setActivePlanningWindow(null)
      setSchedulerLaunched(false)
      setSidebarCollapsed(false)
      setExtractionStatus('Failed')
      setError(err.message || 'Failed to extract overpasses from the backend.')
    } finally {
      setLaunchingScheduler(false)
    }
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
    && localDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime)
    && localDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime)
    && new Date(localDateAndTimeToIso(planningWindowEndDate, planningWindowEndTime)) > new Date(localDateAndTimeToIso(planningWindowStartDate, planningWindowStartTime))
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

  const projectToMap = (latitude, longitude) => ({
    left: ((longitude + 180) / 360) * 100,
    top: ((90 - latitude) / 180) * 100,
  })

  const projectToMercator = (latitude, longitude, zoom) => {
    const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude))
    const latitudeRadians = (clampedLatitude * Math.PI) / 180
    const scale = MAP_TILE_SIZE * 2 ** zoom

    return {
      x: ((longitude + 180) / 360) * scale,
      y:
        (0.5
          - Math.log((1 + Math.sin(latitudeRadians)) / (1 - Math.sin(latitudeRadians))) / (4 * Math.PI))
        * scale,
    }
  }

  const buildDemoRegionMapModel = (assets) => {
    const topLeft = projectToMercator(
      DEMO_REGION_BOUNDS.maxLatitude,
      DEMO_REGION_BOUNDS.minLongitude,
      DEMO_REGION_MAP_ZOOM,
    )
    const bottomRight = projectToMercator(
      DEMO_REGION_BOUNDS.minLatitude,
      DEMO_REGION_BOUNDS.maxLongitude,
      DEMO_REGION_MAP_ZOOM,
    )

    const minTileX = Math.floor(topLeft.x / MAP_TILE_SIZE)
    const maxTileX = Math.floor(bottomRight.x / MAP_TILE_SIZE)
    const minTileY = Math.floor(topLeft.y / MAP_TILE_SIZE)
    const maxTileY = Math.floor(bottomRight.y / MAP_TILE_SIZE)

    const tileColumnCount = maxTileX - minTileX + 1
    const tileRowCount = maxTileY - minTileY + 1
    const originX = minTileX * MAP_TILE_SIZE
    const originY = minTileY * MAP_TILE_SIZE
    const widthPx = tileColumnCount * MAP_TILE_SIZE
    const heightPx = tileRowCount * MAP_TILE_SIZE

    const tiles = []
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        tiles.push({
          key: `${tileX}-${tileY}`,
          x: tileX,
          y: tileY,
          url: `https://tile.openstreetmap.org/${DEMO_REGION_MAP_ZOOM}/${tileX}/${tileY}.png`,
          left: ((tileX - minTileX) / tileColumnCount) * 100,
          top: ((tileY - minTileY) / tileRowCount) * 100,
          width: 100 / tileColumnCount,
          height: 100 / tileRowCount,
        })
      }
    }

    const markerPositions = assets.map((asset) => {
      const point = projectToMercator(asset.latitude, asset.longitude, DEMO_REGION_MAP_ZOOM)

      return {
        id: asset.id,
        left: ((point.x - originX) / widthPx) * 100,
        top: ((point.y - originY) / heightPx) * 100,
      }
    })

    return {
      tiles,
      markerPositions,
      tileColumnCount,
      tileRowCount,
      aspectRatio: `${tileColumnCount} / ${tileRowCount}`,
    }
  }

  const formatCoordinate = (value, positiveLabel, negativeLabel) => {
    const direction = value >= 0 ? positiveLabel : negativeLabel
    return `${Math.abs(value).toFixed(2)}° ${direction}`
  }

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
          ...coordinates,
        }
      })
      .filter(Boolean),
    ...selectedSatelliteAssets
      .map((asset) => {
        const coordinates = getAssetCoordinates(asset)
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

  const demoRegionalMapAssets = selectedMapAssets.filter(
    (asset) =>
      asset.markerType === 'ground-station'
      && asset.latitude >= DEMO_REGION_BOUNDS.minLatitude
      && asset.latitude <= DEMO_REGION_BOUNDS.maxLatitude
      && asset.longitude >= DEMO_REGION_BOUNDS.minLongitude
      && asset.longitude <= DEMO_REGION_BOUNDS.maxLongitude,
  )

  const showDemoRegionalMap = useDemoData && demoRegionalMapAssets.length > 0
  const demoRegionMapModel = showDemoRegionalMap
    ? buildDemoRegionMapModel(demoRegionalMapAssets)
    : null
  const demoRegionMarkerPositions = new Map(
    (demoRegionMapModel?.markerPositions ?? []).map((marker) => [marker.id, marker]),
  )
  const visibleMapAssets = showDemoRegionalMap ? demoRegionalMapAssets : selectedMapAssets

  const selectedAssetsWithoutLocation = [
    ...selectedSatelliteAssets
      .filter((asset) => !getAssetCoordinates(asset))
      .map((asset) => ({
        id: `selected-satellite-${asset.name}`,
        name: asset.name,
        type: 'Satellite',
      })),
  ]
  const activeMapAsset =
    visibleMapAssets.find((asset) => asset.id === activeMapAssetId) ?? visibleMapAssets[0] ?? null

  const currentScheduleItems = buildCurrentScheduleItems(
    assetSchedules,
    [...selectedSatellites, ...selectedGroundStations],
  )
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
  const timelineZoomMultiplier =
    TIMELINE_ZOOM_LEVELS.find((level) => level.id === timelineZoomLevel)?.multiplier ?? 1
  const timelineWidthPx = timelineModel
    ? Math.round(timelineModel.widthPx * timelineZoomMultiplier)
    : 0
  const visibleTimelineTracks = timelineModel?.tracks.filter((track) => timelineLayers[track.id]) ?? []
  const activeTradeOffCard = tradeOffCards[activeTradeOffCardIndex] ?? null
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

  const renderTradeOffPill = (tradeOffId, colorIndex) => (
    <span
      className="tradeoff-id-pill"
      style={{ '--tradeoff-accent': getTradeOffAccentColor(colorIndex) }}
    >
      {tradeOffId}
    </span>
  )

  const handleSelectTradeOffOption = (optionId) => {
    setSelectedTradeOffOption(optionId)
    setConfirmationSuccess(false)
    setConfirmedScheduleCount(0)
  }

  const handleTimelineItemClick = (item) => {
    if (item.optionId) {
      handleSelectTradeOffOption(item.optionId)
    }
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
            <div className="sidebar-collapsed-label">Configuration</div>
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
                        <span className="time-window-meta">Local time</span>
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
                      <p className="time-window-note">
                        Extracted data is limited to this interval.
                      </p>
                      {planningWindowComplete && !planningWindowValid && (
                        <p className="time-window-error">
                          Enter a valid time window with an end time after the start time.
                        </p>
                      )}
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
                <button
                  className="btn-fetch"
                  disabled={!launchRequirementsMet || launchingScheduler}
                  onClick={handleLaunchScheduler}
                >
                  {launchingScheduler ? 'Launching...' : 'Launch Communication Scheduler'}
                </button>
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
          <section className="panel panel--fullwidth map-panel">
            <div className="panel-heading panel-heading--map">
              <div className="panel-heading-title">
                <h2>Map View</h2>
                {useDemoData && renderDemoBadge()}
              </div>
              <div className="map-panel-controls">
                <button
                  type="button"
                  className="map-panel-toggle"
                  onClick={() => toggleSection('mapView')}
                  aria-expanded={expandedSections.mapView}
                  aria-label={expandedSections.mapView ? 'Collapse map view' : 'Expand map view'}
                >
                  <span className="section-toggle-icon" aria-hidden="true">
                    {renderSectionChevron(expandedSections.mapView)}
                  </span>
                </button>
              </div>
            </div>

            {expandedSections.mapView && (
              <div className="map-layout">
                <div className="map-canvas-shell">
                  <div
                    className={`map-canvas ${showDemoRegionalMap ? 'map-canvas--regional' : ''}`}
                    aria-label="Selected asset map view"
                    style={
                      showDemoRegionalMap && demoRegionMapModel
                        ? {
                            height: '520px',
                          }
                        : undefined
                    }
                  >
                    {showDemoRegionalMap && demoRegionMapModel && (
                      <div
                        className="map-region-art map-region-art--cropped"
                        style={{ '--map-region-aspect-ratio': demoRegionMapModel.aspectRatio }}
                        aria-hidden="true"
                      >
                        {demoRegionMapModel.tiles.map((tile) => (
                          <img
                            key={tile.key}
                            className="map-region-tile"
                            src={tile.url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            style={{
                              left: `${tile.left}%`,
                              top: `${tile.top}%`,
                              width: `${tile.width}%`,
                              height: `${tile.height}%`,
                            }}
                          />
                        ))}
                        {visibleMapAssets.map((asset) => {
                          const markerPosition = demoRegionMarkerPositions.get(asset.id)

                          return (
                            <button
                              key={asset.id}
                              type="button"
                              className={`map-marker map-marker--${asset.markerType} ${
                                activeMapAsset?.id === asset.id ? 'map-marker--active' : ''
                              }`}
                              style={{
                                left: `${markerPosition.left}%`,
                                top: `${markerPosition.top}%`,
                              }}
                              onClick={() => setActiveMapAssetId(asset.id)}
                              aria-label={`${asset.name} on map`}
                            >
                              <span className="map-marker-label">{asset.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {visibleMapAssets.length === 0 && (
                      <div className="map-empty-state">
                        {showDemoRegionalMap
                          ? 'Select one of the demo ground stations to place it on the regional map.'
                          : 'Select a ground station to place it on the map.'}
                      </div>
                    )}

                    {!showDemoRegionalMap && visibleMapAssets.map((asset) => {
                      const markerPosition = projectToMap(asset.latitude, asset.longitude)

                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className={`map-marker map-marker--${asset.markerType} ${
                            activeMapAsset?.id === asset.id ? 'map-marker--active' : ''
                          }`}
                          style={{
                            left: `${markerPosition.left}%`,
                            top: `${markerPosition.top}%`,
                          }}
                          onClick={() => setActiveMapAssetId(asset.id)}
                          aria-label={`${asset.name} on map`}
                        >
                          <span className="map-marker-label">{asset.name}</span>
                        </button>
                      )
                    })}
                    {showDemoRegionalMap && (
                      <div className="map-attribution">
                        Map data © OpenStreetMap contributors
                      </div>
                    )}
                  </div>
                </div>

                <aside className="map-sidebar">
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
                            onClick={() => setActiveMapAssetId(asset.id)}
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
                            <span className="map-missing-location-copy">Location data not available.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            )}
            {expandedSections.mapView && showDemoRegionalMap && (
              <p className="map-panel-note">
                Static demo map. Ground-station markers use real coordinates within this regional excerpt.
              </p>
            )}
          </section>

          <div
            ref={splitPanelsRef}
            className="workspace-panels-split"
            style={{
              gridTemplateColumns: `minmax(0, ${overviewPanelWidth}%) 0.9rem minmax(0, calc(${100 - overviewPanelWidth}% - 0.9rem))`,
            }}
          >
          <section className="panel overview-panel">
            <div className="panel-heading">
              <div className="panel-heading-title">
                <h2>Overview</h2>
              </div>
              <div
                className={`overview-inline-status ${
                  extractionStatus === 'Completed'
                    ? 'overview-inline-status--online'
                    : extractionStatus === 'Running'
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
                  <span className="overview-status-label">Overpass Extraction Status</span>
                  <div className="overview-status-value">
                    <span className="app-status-dot" aria-hidden="true"></span>
                    <span className="overview-status-text">{extractionStatus}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="overview-list">
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
                              ? <span className="overview-tradeoff-cell">{renderTradeOffPill(row.tradeOffId, row.tradeOffColorIndex)}</span>
                              : <span className="overview-tradeoff-cell">—</span>
                          )}
                          {tradeOffsCalculated && <span className="overview-score-cell">{row.tradeOffScore}</span>}
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
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
          </section>

          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize overview and trade-off panels"
            tabIndex={0}
            onPointerDown={handlePanelResizeStart}
            onKeyDown={handlePanelResizeKeyDown}
          >
            <span className="panel-resizer-line" aria-hidden="true"></span>
            <span className="panel-resizer-grip" aria-hidden="true"></span>
          </div>

          <section className="panel tradeoff-panel">
            <div className="panel-heading-title">
              <h2>Trade-Off</h2>
              {useDemoData && schedulerLaunched && renderDemoBadge()}
            </div>
            {!tradeOffsCalculated && !useDemoData && (
              <p>Enable Demo mode to use Trade-Off view.</p>
            )}
            {tradeOffsCalculated && tradeOffCards.length === 0 && (
              <p>No trade-off groups were identified for the current selection.</p>
            )}
            {tradeOffsCalculated && tradeOffCards.length > 0 && (
              <div className="tradeoff-card-list">
                {tradeOffCards.length > 1 && (
                  <div className="tradeoff-browser">
                    <div className="tradeoff-browser-tabs">
                      {tradeOffCards.map((card, index) => (
                        <button
                          key={`${card.id}-tab`}
                          type="button"
                          className={`tradeoff-browser-tab ${index === activeTradeOffCardIndex ? 'tradeoff-browser-tab--active' : ''}`}
                          style={{ '--tradeoff-accent': getTradeOffAccentColor(card.colorIndex) }}
                          onClick={() => setActiveTradeOffCardIndex(index)}
                        >
                          {card.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeTradeOffCard && (
                  <article
                    key={activeTradeOffCard.id}
                    className="tradeoff-card"
                    style={{ '--tradeoff-accent': getTradeOffAccentColor(activeTradeOffCard.colorIndex) }}
                  >
                    <div className="tradeoff-card-header">
                      <div className="tradeoff-card-titleblock">
                        <h3>{renderTradeOffPill(activeTradeOffCard.title, activeTradeOffCard.colorIndex)}</h3>
                        <p className="tradeoff-card-resource">{activeTradeOffCard.resourceLabel}</p>
                      </div>
                    </div>
                    <p className="tradeoff-reason">
                      <span className="tradeoff-reason-label">Reason:</span> {activeTradeOffCard.reason}
                    </p>

                    <div className="tradeoff-option-list">
                      {activeTradeOffCard.options.map((option) => (
                        <div
                          key={option.optionId}
                          className={`tradeoff-option ${selectedTradeOffOption === option.optionId ? 'tradeoff-option--selected' : ''}`}
                          style={{ '--tradeoff-accent': getTradeOffAccentColor(option.colorIndex) }}
                        >
                          <div className="tradeoff-option-header">
                            <span className="tradeoff-option-id">{option.overpassId}</span>
                            <div className="tradeoff-meta tradeoff-meta--option">
                              {option.recommended && <span className="tradeoff-recommended">Recommended</span>}
                              <span className="tradeoff-score">{option.score}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="tradeoff-select-button"
                            onClick={() => handleSelectTradeOffOption(option.optionId)}
                          >
                            {selectedTradeOffOption === option.optionId ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                )}
                {tradeOffCards.length > 1 && (
                  <div className="tradeoff-browser-nav tradeoff-browser-nav--bottom">
                    <button
                      type="button"
                      className="tradeoff-browser-button"
                      disabled={activeTradeOffCardIndex === 0}
                      onClick={() => setActiveTradeOffCardIndex((current) => Math.max(0, current - 1))}
                      aria-label="Previous trade-off card"
                    >
                      ‹
                    </button>
                    <span className="tradeoff-browser-status">
                      {activeTradeOffCardIndex + 1} / {tradeOffCards.length}
                    </span>
                    <button
                      type="button"
                      className="tradeoff-browser-button"
                      disabled={activeTradeOffCardIndex >= tradeOffCards.length - 1}
                      onClick={() => setActiveTradeOffCardIndex((current) => Math.min(tradeOffCards.length - 1, current + 1))}
                      aria-label="Next trade-off card"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
          </div>

          <section className="panel panel--fullwidth timeline-panel">
            <div className="panel-heading panel-heading--timeline">
              <div className="panel-heading-title">
                <h2>Timeline</h2>
              </div>
              {timelineModel && (
                <div className="timeline-header-meta">
                  <span className="timeline-meta-item">
                    <span className="timeline-meta-label">Planning Window</span>
                    <span className="timeline-meta-value">
                      {formatPlanningWindow(activePlanningWindow?.startTime, activePlanningWindow?.endTime)}
                    </span>
                  </span>
                  <span className="timeline-meta-item timeline-meta-item--muted">
                    <span className="timeline-meta-label">DOY</span>
                    <span className="timeline-meta-value">{getDayOfYear(timelineModel.baseDate)}</span>
                  </span>
                </div>
              )}
            </div>

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
                      {timelineModel.tracks.map((track) => (
                        <button
                          key={track.id}
                          type="button"
                          className={`timeline-toggle ${timelineLayers[track.id] ? 'timeline-toggle--active' : ''}`}
                          onClick={() => toggleTimelineLayer(track.id)}
                        >
                          {track.label}
                        </button>
                      ))}
                    </div>
                    <div className="timeline-toggle-group" role="group" aria-label="Timeline zoom">
                      {TIMELINE_ZOOM_LEVELS.map((level) => (
                        <button
                          key={level.id}
                          type="button"
                          className={`timeline-toggle ${timelineZoomLevel === level.id ? 'timeline-toggle--active' : ''}`}
                          onClick={() => setTimelineZoomLevel(level.id)}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {!useDemoData && (
                    <div className="timeline-toolbar-copy">
                      Current schedule activities and extracted overpasses use backend timestamps. Proposed scheduling remains empty until the backend trade-off workflow is connected.
                    </div>
                  )}
                </div>

                {visibleTimelineTracks.length === 0 ? (
                  <p className="timeline-empty-copy">Enable at least one timeline layer to display the schedule view.</p>
                ) : (
                  <div className="timeline-scroll">
                    <div
                      className="timeline-grid"
                      style={{ gridTemplateColumns: `11rem ${timelineWidthPx}px` }}
                    >
                      <div className="timeline-label-cell timeline-label-cell--blank"></div>
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

                      <div className="timeline-label-cell timeline-label-cell--blank"></div>
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

                      {visibleTimelineTracks.map((track) => (
                        <Fragment key={track.id}>
                          <div key={`${track.id}-label`} className="timeline-label-cell">
                            <span className="timeline-track-name">
                              {track.label}
                              {track.demoLabel && <span className="timeline-track-demo">{track.demoLabel}</span>}
                            </span>
                            <span className="timeline-track-copy">{track.copy}</span>
                          </div>
                          <div
                            key={`${track.id}-row`}
                            className="timeline-track-row"
                            style={{
                              '--timeline-row-height': `${Math.max(4, (track.laneCount ?? 1) * 3.35 + 0.55)}rem`,
                            }}
                          >
                            {timelineModel.ticks.map((tick) => (
                              <div
                                key={`${track.id}-tick-${tick.offsetMinutes}`}
                                className={`timeline-grid-line ${tick.offsetMinutes % 120 === 0 ? 'timeline-grid-line--major' : ''}`}
                                style={{ left: `${(tick.offsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                              ></div>
                            ))}

                            {timelineModel.nowOffsetMinutes >= 0 && timelineModel.nowOffsetMinutes <= timelineModel.totalMinutes && (
                              <div
                                className="timeline-now-line"
                                style={{ left: `${(timelineModel.nowOffsetMinutes / timelineModel.totalMinutes) * 100}%` }}
                              >
                                <span className="timeline-now-badge">Now</span>
                              </div>
                            )}

                            {track.items.map((item) => (
                              (() => {
                                const itemWidthPx = (item.durationMinutes / timelineModel.totalMinutes) * timelineWidthPx
                                const compactBar = itemWidthPx < 120
                                const tinyBar = itemWidthPx < 72

                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={`timeline-bar timeline-bar--${item.variant} ${item.tradeOffColorIndex !== null ? 'timeline-bar--tradeoff' : ''} ${compactBar ? 'timeline-bar--compact' : ''} ${tinyBar ? 'timeline-bar--tiny' : ''}`}
                                    style={{
                                      left: `${(item.startMinutes / timelineModel.totalMinutes) * 100}%`,
                                      width: `${(item.durationMinutes / timelineModel.totalMinutes) * 100}%`,
                                      top: `calc(0.7rem + ${(item.laneIndex ?? 0) * 3.35}rem)`,
                                      '--tradeoff-accent': item.tradeOffColorIndex !== null
                                        ? getTradeOffAccentColor(item.tradeOffColorIndex)
                                        : 'transparent',
                                    }}
                                    onClick={() => handleTimelineItemClick(item)}
                                    aria-label={`${item.label}. ${item.detail}. Start ${formatTimelineDateTime(item.startTime)}. End ${formatTimelineDateTime(item.endTime)}. Duration ${formatTimelineDuration(item.startTime, item.endTime)}.`}
                                  >
                                    <span className="timeline-bar-content">
                                      {item.recommended && !tinyBar && (
                                        <span
                                          className="timeline-bar-marker"
                                          aria-hidden="true"
                                        ></span>
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
                                      </span>
                                    </span>
                                  </button>
                                )
                              })()
                            ))}
                          </div>
                        </Fragment>
                      ))}
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
          </section>
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
