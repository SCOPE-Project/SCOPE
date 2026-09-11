import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  TIMELINE_DEFAULT_ZOOM_LEVEL,
  TIMELINE_FIT_EDGE_INSET_PX,
  TIMELINE_MIN_ZOOM_MULTIPLIER,
  TIMELINE_WHEEL_ZOOM_STEP,
} from '../config/constants.js'
import { toTimestamp } from '../domain/format.js'
import { buildTimelineModel } from '../domain/timelineModel.js'
import { useTimelineView } from './useTimelineView.js'
import {
  buildDataVolumeModel,
  buildDataVolumePolyline as buildDataVolumePolylineIn,
} from '../domain/dataVolumeModel.js'

// Everything derived from the timeline's view state: pixel geometry, the
// render rows, the data-volume curves, and the pointer/keyboard/wheel
// interactions that move the playhead or change the zoom.
//
// Splitting this from useTimelineView keeps that hook to plain state; this
// one is where the state meets the DOM. Drags and playback write to the DOM
// each frame and commit to React only at the end, which is why so much of it
// works through refs.
export const useTimelineGeometry = ({
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

}) => {
  const view = useTimelineView()
  const {
    timelinePlayheadTime,
    setTimelinePlayheadTime,
    timelineLive,
    setTimelineLive,
    timelineLayers,
    timelineAssetVisibility,
    setTimelineAssetVisibility,
    timelinePlayingRef,
    timelinePlayheadDraggingRef,
    timelinePlaying,
    setTimelinePlaying,
    timelinePlaybackSpeed,
    setTimelineZoomLevel,
    timelineViewportWidthPx,
    setTimelineViewportWidthPx,
    timelineCustomZoomMultiplier,
    setTimelineCustomZoomMultiplier,
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
    setTimelineHorizontalControl,
    timelineScrollRef,
    timelineScrollFrameRef,
    timelineHorizontalRangeRef,
    timelinePlayheadSliderRef,
    timelinePlaybackRafRef,
    timelinePlaybackFrameTimestampRef,
    timelinePlayheadTimeRef,
    timelinePlaybackDomRef,
    timelinePlaybackLastTextSyncRef,
  } = view

  // Clamped here rather than in App: it is derived purely from this hook's
  // own playhead state, and App would otherwise have to read that state
  // before the hook that owns it has run.
  const timelinePlayheadTimestamp = clampToPlanningWindow(timelinePlayheadTime)

  useEffect(() => {
    timelinePlayingRef.current = timelinePlaying
  }, [timelinePlaying, timelinePlayingRef])

  // Deliberately does not depend on timelinePlaying: this effect resets the
  // playhead to the window start when the planning window itself changes
  // (or the scheduler freshly launches), not when playback is merely
  // paused/resumed. Reading timelinePlayingRef instead of timelinePlaying
  // lets it still skip the reset while actively playing, without re-running
  // -- and incorrectly resetting -- every time Play/Pause is toggled.
  useEffect(() => {
    if (
      !schedulerLaunched
      || planningWindowStartTimestamp === null
      || timelinePlayingRef.current
      || timelinePlayheadDraggingRef.current
    ) {
      return
    }

    timelinePlayheadTimeRef.current = planningWindowStartTimestamp
    setTimelinePlayheadTime((current) => (
      current === planningWindowStartTimestamp ? current : planningWindowStartTimestamp
    ))
    setTimelineLive(false)
  }, [planningWindowStartTimestamp, schedulerLaunched, setTimelineLive, setTimelinePlayheadTime, timelinePlayheadDraggingRef, timelinePlayheadTimeRef, timelinePlayingRef])

  const timelineModel = useMemo(() => buildTimelineModel(
    overviewRows,
    tradeOffCards,
    currentScheduleItems,
    activePlanningWindow,
    {
      selectedSatellites,
      selectedGroundStations,
      timelineAssetVisibility,
      timelineLayers,
      tradeOffsCalculated,
    },
  ), [
    activePlanningWindow,
    currentScheduleItems,
    overviewRows,
    selectedGroundStations,
    selectedSatellites,
    timelineAssetVisibility,
    timelineLayers,
    tradeOffCards,
    tradeOffsCalculated,
  ])

  // Moves the playhead to a timestamp immediately, both in state and in the
  // ref the drag/playback loop reads, and stops any playback that was under
  // way. Used when a scheduler run establishes a new planning window.
  const jumpTimelinePlayheadTo = (timestamp) => {
    setTimelinePlayheadTime(timestamp)
    timelinePlayheadTimeRef.current = timestamp
    setTimelineLive(false)
    setTimelinePlaying(false)
  }

  const timelineWheelHintRef = useRef(null)
  const timelineWheelHintTimeoutRef = useRef(null)
  const timelineWheelHandlerRef = useRef(null)
  const timelineTradeOffDrawerDragCleanupRef = useRef(null)
  const timelineTradeOffDrawerRef = useRef(null)
  const timelineTooltipHideTimeoutRef = useRef(null)

  const timelineZoomMultiplier = timelineCustomZoomMultiplier ?? 1
  const timelineFitWidthPx = timelineViewportWidthPx > 0
    ? timelineViewportWidthPx
    : timelineModel?.widthPx ?? 0
  const timelineWidthPx = timelineModel
    ? Math.max(1, Math.round(timelineFitWidthPx * timelineZoomMultiplier))
    : 0
  const timelineIsFit = timelineZoomMultiplier <= TIMELINE_MIN_ZOOM_MULTIPLIER
  const timelineContentInsetPx = timelineIsFit ? TIMELINE_FIT_EDGE_INSET_PX : 0
  const timelineDrawableWidthPx = Math.max(1, timelineWidthPx - (timelineContentInsetPx * 2))
  const visibleTimelineTicks = useMemo(() => {
    if (!timelineModel || timelineWidthPx <= 0 || timelineModel.totalMinutes <= 0) {
      return []
    }

    const minLabelSpacingPx = 64
    const visibleTicks = []

    timelineModel.ticks.forEach((tick, index) => {
      const positionPx = timelineContentInsetPx
        + ((tick.offsetMinutes / timelineModel.totalMinutes) * timelineDrawableWidthPx)
      const isFirst = index === 0
      const isLast = index === timelineModel.ticks.length - 1

      if (isFirst) {
        visibleTicks.push({ ...tick, positionPx })
        return
      }

      if (isLast) {
        const previousTick = visibleTicks[visibleTicks.length - 1]
        if (previousTick && positionPx - previousTick.positionPx < minLabelSpacingPx) {
          visibleTicks.pop()
        }
        visibleTicks.push({ ...tick, positionPx })
        return
      }

      const previousTick = visibleTicks[visibleTicks.length - 1]
      if (!previousTick || positionPx - previousTick.positionPx >= minLabelSpacingPx) {
        visibleTicks.push({ ...tick, positionPx })
      }
    })

    return visibleTicks.map(({ positionPx, ...tick }) => tick)
  }, [timelineContentInsetPx, timelineDrawableWidthPx, timelineModel, timelineWidthPx])
  const activeTimelineTradeOffCard = useMemo(() => {
    if (!timelineTradeOffViewId) {
      return null
    }

    return tradeOffCards.find((card) => card.id === timelineTradeOffViewId) ?? null
  }, [timelineTradeOffViewId, tradeOffCards])
  const focusedTimelineTradeOffId = useMemo(() => {
    if (timelineTradeOffViewId) {
      return timelineTradeOffViewId
    }

    if (!markedTimelineLinkId) {
      return null
    }

    return tradeOffCards.find((card) => (
      card.options.some((option) => option.linkId === markedTimelineLinkId)
    ))?.id ?? null
  }, [timelineTradeOffViewId, markedTimelineLinkId, tradeOffCards])
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
  // Rebuilt whenever an expanded satellite, the plan or the window changes.
  const dataVolumeModel = useMemo(() => buildDataVolumeModel({
    timelineModel,
    sessionPlan,
    expandedTimelineSections,
    expandedTimelineGroups,
    finalScheduleRows,
  }), [
    expandedTimelineGroups,
    expandedTimelineSections,
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
  }, [expandedSections.timeline, timelineHasRows, view, setTimelineViewportWidthPx, timelineScrollFrameRef])

  useLayoutEffect(() => {
    const scrollContainer = timelineScrollRef.current
    const range = timelineHorizontalRangeRef.current
    if (!scrollContainer || !range) {
      return undefined
    }

    const syncHorizontalRange = () => {
      const maxScrollLeft = timelineIsFit
        ? 0
        : Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth)
      range.max = String(maxScrollLeft)
      range.disabled = timelineIsFit || maxScrollLeft <= 0
      range.value = String(Math.min(maxScrollLeft, scrollContainer.scrollLeft))
      range.setAttribute('aria-valuemax', String(Math.round(maxScrollLeft)))
      range.setAttribute('aria-valuenow', String(Math.round(scrollContainer.scrollLeft)))
    }

    syncHorizontalRange()
    scrollContainer.addEventListener('scroll', syncHorizontalRange, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', syncHorizontalRange)
  }, [
    expandedSections.timeline,
    timelineHasRows,
    timelineHorizontalControl.visible,
    timelineIsFit,
    timelineWidthPx,
    setTimelineHorizontalControl,
    timelinePanelRef,
    timelineHorizontalRangeRef,
    timelineScrollRef,
  ])

  useLayoutEffect(() => {
    const panel = timelinePanelRef.current
    const scrollContainer = panel?.closest('.workspace-main')
    if (!panel || !scrollContainer || !schedulerLaunched || !expandedSections.timeline || timelineIsFit) {
      setTimelineHorizontalControl((current) => (
        current.visible ? { ...current, visible: false } : current
      ))
      return undefined
    }

    const updateHorizontalControl = () => {
      const panelRect = panel.getBoundingClientRect()
      const headerBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0
      const visible = panelRect.bottom > headerBottom && panelRect.top < window.innerHeight

      if (!visible) {
        setTimelineHorizontalControl((current) => (
          current.visible ? { ...current, visible: false } : current
        ))
        return
      }

      const labelRect = panel.querySelector('.timeline-label-column')?.getBoundingClientRect()
      const left = Math.max(panelRect.left + 16, labelRect?.right ?? panelRect.left + 16)
      const right = Math.min(window.innerWidth - 16, panelRect.right - 16)
      const width = Math.max(180, right - left)

      setTimelineHorizontalControl((current) => (
        current.visible && Math.abs(current.left - left) < 0.5 && Math.abs(current.width - width) < 0.5
          ? current
          : { visible: true, left, width }
      ))
    }

    updateHorizontalControl()
    scrollContainer.addEventListener('scroll', updateHorizontalControl, { passive: true })
    window.addEventListener('resize', updateHorizontalControl)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateHorizontalControl)
    observer?.observe(panel)

    return () => {
      scrollContainer.removeEventListener('scroll', updateHorizontalControl)
      window.removeEventListener('resize', updateHorizontalControl)
      observer?.disconnect()
    }
  }, [expandedSections.timeline, schedulerLaunched, timelineHasRows, timelineIsFit, view, setTimelineHorizontalControl, timelinePanelRef])

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
  // 6% of headroom above the capacity line so the curve never touches the
  // top edge of the chart.
  const dataVolumeScale = dataVolumeModel && {
    startTimestamp: dataVolumeModel.startTimestamp,
    durationMs: dataVolumeModel.durationMs,
    yMaxGb: dataVolumeYMaxGb,
  }
  const buildDataVolumePolyline = (points) =>
    buildDataVolumePolylineIn(points, dataVolumeScale)

  const timelineBaseTimestamp = timelineModel?.baseDate.getTime() ?? null
  const timelineDurationMs = timelineModel ? timelineModel.totalMinutes * 60000 : 0
  const timelinePlayheadOffsetMinutes = timelineBaseTimestamp !== null
    ? (timelinePlayheadTimestamp - timelineBaseTimestamp) / 60000
    : null
  const timelinePlayheadCanvasRatio = (
    timelinePlayheadOffsetMinutes !== null
    && timelineModel?.totalMinutes > 0
  )
    ? timelinePlayheadOffsetMinutes / timelineModel.totalMinutes
    : null

  const refreshTimelinePlaybackDom = () => {
    const root = timelinePanelRef.current
    if (!root) {
      timelinePlaybackDomRef.current = { playhead: null, bars: [], label: null }
      return
    }

    timelinePlaybackDomRef.current = {
      playhead: root.querySelector('[data-timeline-playhead]'),
      bars: [...root.querySelectorAll('[data-playback-start][data-playback-end]')],
      label: root.querySelector('[data-playback-label]'),
    }
  }

  const positionTimelinePlayhead = (timestamp) => {
    const playhead = timelinePlaybackDomRef.current.playhead
    const scrollContainer = timelineScrollRef.current
    if (!playhead || !scrollContainer) {
      return
    }

    const ratio = (
      timelineBaseTimestamp !== null
      && timelineDurationMs > 0
    )
      ? (timestamp - timelineBaseTimestamp) / timelineDurationMs
      : null
    const visible = ratio !== null && ratio >= 0 && ratio <= 1

    playhead.hidden = !visible
    if (visible) {
      // Label, handle and dashed line are one viewport overlay. This is the
      // only X-coordinate used for rendering and pointer input, so zoom and
      // horizontal scrolling cannot separate those pieces.
      playhead.style.left = `${timelineContentInsetPx + (ratio * timelineDrawableWidthPx) - scrollContainer.scrollLeft}px`
    }
  }

  const syncTimelinePlaybackDom = (timestamp, syncText = false) => {
    if (!Number.isFinite(timestamp)) {
      return
    }

    const { bars, label } = timelinePlaybackDomRef.current
    positionTimelinePlayhead(timestamp)
    timelinePlayheadSliderRef.current?.setAttribute('aria-valuenow', String(Math.round(timestamp)))

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

  // Maps a timestamp ratio to the scroll position used by playback/live
  // follow. The canvas has no horizontal padding, so this is also the same
  // coordinate space used by the playhead overlay.
  const getTimelineScrollLeftForTimestamp = (timestamp) => {
    if (timelineBaseTimestamp === null || timelineDurationMs <= 0 || timelineWidthPx <= 0) {
      return 0
    }

    const viewportWidthPx = timelineScrollRef.current?.clientWidth ?? 0
    const ratio = Math.max(
      0,
      Math.min(1, (timestamp - timelineBaseTimestamp) / timelineDurationMs),
    )
    return ratio * Math.max(0, timelineWidthPx - viewportWidthPx)
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

  // Opening a trade-off exposes all involved assets, but does not reposition
  // the timeline horizontally. The current viewport is user-owned.
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
  }

  const openTimelineTradeOffView = (tradeOffId, optionId = null, linkId = null, scrollToPanel = false) => {
    if (!tradeOffId) {
      return
    }

    const cardIndex = tradeOffCards.findIndex((card) => card.id === tradeOffId)
    if (cardIndex === -1) {
      return
    }

    const card = tradeOffCards[cardIndex]
    setTimelineTradeOffViewId(tradeOffId)
    setTimelineTradeOffDrawerOffset({ x: 0, y: 0 })
    setActiveTradeOffCardIndex(cardIndex)
    if (scrollToPanel) {
      timelinePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    focusTimelineOnTradeOffCard(card)

    if (optionId) {
      setMarkedTradeOffOptionId(optionId)
    } else {
      setMarkedTradeOffOptionId(null)
    }

    if (linkId) {
      setMarkedTimelineLinkId(linkId)
    }
  }

  const closeTimelineTradeOffView = () => {
    timelineTradeOffDrawerDragCleanupRef.current?.()
    timelineTradeOffDrawerDragCleanupRef.current = null
    setTimelineTradeOffViewId(null)
    setTimelineTradeOffDrawerOffset({ x: 0, y: 0 })
    setMarkedTradeOffOptionId(null)
    setMarkedTimelineLinkId(null)
    hideTimelineTooltip(true)
  }

  const handleTimelineTradeOffDrawerPointerDown = (event) => {
    if (
      event.button !== 0
      || event.target.closest('button')
    ) {
      return
    }

    const container = timelinePanelRef.current
    const drawer = timelineTradeOffDrawerRef.current
    if (!container || !drawer) {
      return
    }

    const startX = event.clientX
    const startY = event.clientY
    const startOffset = { ...timelineTradeOffDrawerOffset }

    // Figure out how far the drawer can move, in offset space, before it
    // would cross the timeline panel's edge. The panel clips its contents
    // (overflow: hidden), so dragging the drawer past this range is what
    // was making it appear to vanish instead of just stopping at the edge.
    const containerRect = container.getBoundingClientRect()
    const drawerRect = drawer.getBoundingClientRect()
    const naturalLeft = drawerRect.left - startOffset.x
    const naturalTop = drawerRect.top - startOffset.y
    const minX = containerRect.left - naturalLeft
    const maxX = Math.max(minX, containerRect.right - naturalLeft - drawerRect.width)
    const minY = containerRect.top - naturalTop
    const maxY = Math.max(minY, containerRect.bottom - naturalTop - drawerRect.height)
    const clampRange = (value, min, max) => Math.min(Math.max(value, min), max)

    const handlePointerMove = (moveEvent) => {
      setTimelineTradeOffDrawerOffset({
        x: clampRange(startOffset.x + (moveEvent.clientX - startX), minX, maxX),
        y: clampRange(startOffset.y + (moveEvent.clientY - startY), minY, maxY),
      })
    }

    const stopDragging = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      timelineTradeOffDrawerDragCleanupRef.current = null
    }

    timelineTradeOffDrawerDragCleanupRef.current = stopDragging

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
  }

  // Clicking an option card marks (or, if already marked, unmarks -- same
  // toggle the timeline bars themselves use) its link and, only when the
  // click just turned marking on, scrolls the timeline so the newly marked
  // block is actually visible instead of marking something off-screen.
  const focusTimelineOnOption = (option) => {
    if (!option?.linkId) {
      return
    }

    const wasMarked = markedTimelineLinkId === option.linkId
    markLinkForNavigation(option.linkId, option.optionId)

    if (wasMarked) {
      return
    }

    timelinePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    window.requestAnimationFrame(() => {
      const node = timelinePanelRef.current?.querySelector(`[data-link-id="${option.linkId}"]`)
      node?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    })
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
  }, [markedTradeOffOptionId, activeTradeOffCardIndex, tradeOffCardListRef])

  // Pointer drags and playback animate only the playhead/map nodes each frame;
  // React receives the committed value at the end of a drag. This keeps the
  // map responsive without allowing an unrelated render to snap the handle
  // back to an older timestamp.
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
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    timelinePlayheadDraggingRef.current = true
    setTimelineLive(false)
    setTimelinePlaying(false)

    const nextTimestamp = computeTimelineTimestampFromCanvasClientX(event.clientX)
    if (nextTimestamp !== null) {
      setTimelinePlayheadTime(previewTimelinePlayheadTime(nextTimestamp))
    }
  }

  const handleTimelinePlayheadPointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      return
    }

    const nextTimestamp = computeTimelineTimestampFromCanvasClientX(event.clientX)
    if (nextTimestamp !== null) {
      previewTimelinePlayheadTime(nextTimestamp)
    }
  }

  const handleTimelinePlayheadPointerUp = (event) => {
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    timelinePlayheadDraggingRef.current = false
    commitTimelinePlayheadTime()
  }

  // Convert the pointer's screen X through the canvas's current scroll and
  // zoom. Rendering uses this exact coordinate in reverse.
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
    const drawablePositionPx = canvasPositionPx - timelineContentInsetPx
    return Math.max(0, Math.min(1, drawablePositionPx / timelineDrawableWidthPx))
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
      return Math.max(TIMELINE_MIN_ZOOM_MULTIPLIER, next)
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
  }, [expandedSections.timeline, view, timelineScrollRef])

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
    setTimelineTooltip,
    timelinePanelRef,
    timelineScrollRef,
  ])

  // React owns the committed playhead value, while playback and pointer drags
  // update the small set of animated DOM nodes through this ref. Refresh the
  // node cache after commits so an unrelated render cannot leave those nodes
  // displaying the older committed timestamp.
  useLayoutEffect(() => {
    if (!timelinePlaying && !timelinePlayheadDraggingRef.current) {
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

  // Horizontal scrolling changes the playhead's viewport X without changing
  // its timestamp. Keep the one combined playhead overlay on the same canvas
  // coordinate whenever the native scrollbar, range control or trackpad pans.
  useLayoutEffect(() => {
    const scrollContainer = timelineScrollRef.current
    if (!scrollContainer) {
      return undefined
    }

    const syncPositionAfterScroll = () => {
      positionTimelinePlayhead(
        timelinePlayheadTimeRef.current ?? timelinePlayheadTimestamp,
      )
    }

    syncPositionAfterScroll()
    scrollContainer.addEventListener('scroll', syncPositionAfterScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', syncPositionAfterScroll)
  // Positioning closes over the current canvas bounds and is refreshed when
  // either of them changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expandedSections.timeline,
    timelineHasRows,
    timelineBaseTimestamp,
    timelineDurationMs,
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
        anchorItemId: item.id,
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
              anchorItemId: null,
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
            anchorItemId: null,
            x: current.x,
            y: current.y,
          }
    })
  }

  useLayoutEffect(() => {
    if (!timelineTooltip.visible || !timelineTooltip.pinned || !timelineTooltip.anchorItemId) {
      return undefined
    }

    const updatePinnedTimelineTooltipPosition = () => {
      const anchorNode = timelinePanelRef.current?.querySelector(
        `[data-timeline-item-id="${timelineTooltip.anchorItemId}"]`,
      )

      if (!anchorNode) {
        return
      }

      const rect = anchorNode.getBoundingClientRect()
      const preferredLeft = rect.right + 12
      const fallbackLeft = rect.left - 320
      const nextLeft = preferredLeft <= window.innerWidth - 24
        ? preferredLeft
        : Math.max(16, fallbackLeft)
      const nextTop = Math.max(16, Math.min(rect.top + 6, window.innerHeight - 240))

      setTimelineTooltip((current) => (
        current.visible && current.pinned && current.anchorItemId === timelineTooltip.anchorItemId
          ? (
              Math.abs(current.x - nextLeft) < 0.5 && Math.abs(current.y - nextTop) < 0.5
                ? current
                : { ...current, x: nextLeft, y: nextTop }
            )
          : current
      ))
    }

    updatePinnedTimelineTooltipPosition()

    const timelineScroll = timelineScrollRef.current
    const workspaceScroll = timelinePanelRef.current?.closest('.workspace-main')
    timelineScroll?.addEventListener('scroll', updatePinnedTimelineTooltipPosition, { passive: true })
    workspaceScroll?.addEventListener('scroll', updatePinnedTimelineTooltipPosition, { passive: true })
    window.addEventListener('resize', updatePinnedTimelineTooltipPosition)

    return () => {
      timelineScroll?.removeEventListener('scroll', updatePinnedTimelineTooltipPosition)
      workspaceScroll?.removeEventListener('scroll', updatePinnedTimelineTooltipPosition)
      window.removeEventListener('resize', updatePinnedTimelineTooltipPosition)
    }
  }, [timelineTooltip.anchorItemId, timelineTooltip.pinned, timelineTooltip.visible, setTimelineTooltip, timelinePanelRef, timelineScrollRef])

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
          anchorItemId: null,
          x: current.x,
          y: current.y,
        }
      }

      return {
        visible: true,
        pinned: true,
        item,
        anchorItemId: item.id,
        x: event?.clientX ?? current.x,
        y: event?.clientY ?? current.y,
      }
    })
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

  // Navigation only: marking a link highlights its timeline instances without
  // auto-scrolling or opening/changing the trade-off drawer.
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

    setMarkedTradeOffOptionId(optionId)
  }

  const handleTimelineItemClick = (item, event) => {
    event.preventDefault()
    event.stopPropagation()

    if (item.kind === 'link') {
      markLinkForNavigation(item.linkId, item.optionId)
    }

    toggleTimelineTooltipPin(item, event)
  }

  const handleTimelineBackgroundClick = (event) => {
    if (event.target.closest('button, [role="slider"], .timeline-tradeoff-drawer')) {
      return
    }

    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    hideTimelineTooltip(true)
  }

  const getOptionForLinkId = (linkId) => tradeOffCards
    .flatMap((card) => card.options)
    .find((option) => option.linkId === linkId) ?? null

  const handleOverviewTradeOffClick = (row) => {
    const linkId = row.backendLinkId ?? row.linkId ?? null
    const option = getOptionForLinkId(linkId)

    if (timelineTradeOffViewId === row.tradeOffId && markedTimelineLinkId === linkId) {
      closeTimelineTradeOffView()
      return
    }

    openTimelineTradeOffView(
      row.tradeOffId,
      option?.optionId ?? linkId,
      linkId,
      true,
    )
  }

  useEffect(() => () => {
    if (timelineTooltipHideTimeoutRef.current !== null) {
      window.clearTimeout(timelineTooltipHideTimeoutRef.current)
      timelineTooltipHideTimeoutRef.current = null
    }
  }, [])

  return {
    ...view,
    jumpTimelinePlayheadTo,
    toggleTimelineSection,
    toggleTimelineGroup,
    toggleTimelineAssetVisibility,
    handleTimelineItemClick,
    handleTimelineBackgroundClick,
    getOptionForLinkId,
    handleOverviewTradeOffClick,
    timelineModel,
    timelinePlayheadTimestamp,
    timelineWheelHintRef,
    timelineTradeOffDrawerRef,
    timelineTooltipHideTimeoutRef,
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
    toggleTimelineTooltipPin,
    visibleTimelineTicks,
  }
}
