// Panel geometry: which panel sits in which slot, how wide/tall each slot
// is, and the pointer/keyboard interactions that change either.
//
// Drag-to-resize writes straight to the DOM during the gesture and commits
// to React state only on pointer-up, so a drag stays at pointer speed
// instead of re-rendering the workspace on every move event.

import { useEffect, useRef, useState } from 'react'

import { MAP_PANEL_CHROME_OVERHEAD_PX } from '../config/constants.js'

export const usePanelLayout = ({ expandedSections, missionMapRef }) => {
  const splitPanelsRef = useRef(null)
  const planningRowResizeDragCleanupRef = useRef(null)
  const topPanelsResizeDragCleanupRef = useRef(null)
  const splitDragCleanupRef = useRef(null)

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
  // Shared height (px) of the top row (Overview/Trade-Off by default);
  // both panels stretch to this height and scroll their own content
  // internally. 346px is 60% of the panels' original fixed 36rem (576px)
  // height.
  const [topPanelsHeightPx, setTopPanelsHeightPx] = useState(346)

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

  return {
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
  }
}
