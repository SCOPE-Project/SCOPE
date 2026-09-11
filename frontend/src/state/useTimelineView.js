import { useRef, useState } from 'react'

import { TIMELINE_DEFAULT_ZOOM_LEVEL } from '../config/constants.js'

// Everything about how the timeline is currently being LOOKED AT: playhead
// position, playback, zoom, which groups are expanded, what is marked, and
// the floating tooltip/scroll controls.
//
// None of this describes the schedule itself -- the timeline shows and
// navigates, it does not decide. Nothing here reaches the backend.
//
// The refs matter as much as the state: pointer drags and playback animate
// the playhead and map nodes directly each frame and only commit the final
// value to React, so a drag stays at pointer speed instead of re-rendering
// the workspace on every move event.
export const useTimelineView = () => {
  const timelineScrollRef = useRef(null)
  const timelineScrollFrameRef = useRef(null)
  const timelineHorizontalRangeRef = useRef(null)
  const timelinePlayheadSliderRef = useRef(null)
  const timelinePlaybackRafRef = useRef(null)
  const timelinePlaybackFrameTimestampRef = useRef(null)
  const timelinePlayheadTimeRef = useRef(null)
  const timelinePlayingRef = useRef(false)
  const timelinePlayheadDraggingRef = useRef(false)
  const timelinePlaybackDomRef = useRef({ playhead: null, bars: [], label: null })
  const timelinePlaybackLastTextSyncRef = useRef(0)
  const [timelinePlayheadTime, setTimelinePlayheadTime] = useState(() => Date.now())
  const [timelineLive, setTimelineLive] = useState(false)
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
    payload: true,
    communication: true,
    ineligible: false,
  })
  const [timelineAssetVisibility, setTimelineAssetVisibility] = useState({
    satellites: true,
    groundStations: false,
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
    anchorItemId: null,
    x: 0,
    y: 0,
  })
  const [timelineHorizontalControl, setTimelineHorizontalControl] = useState({
    visible: false,
    left: 0,
    width: 0,
  })
  const resetTimelineView = (planningWindowStartTimestamp) => {
    setTimelinePlayheadTime(planningWindowStartTimestamp)
    timelinePlayheadTimeRef.current = planningWindowStartTimestamp
    setTimelineLive(false)
    setTimelinePlaying(false)
    setTimelinePlaybackSpeed(1)
    setTimelineZoomLevel(TIMELINE_DEFAULT_ZOOM_LEVEL)
    setTimelineCustomZoomMultiplier(null)
    setExpandedTimelineGroups({})
    setExpandedTimelineSections({ satellites: true, groundStations: true })
    setMarkedTimelineLinkId(null)
    setMarkedTradeOffOptionId(null)
    setTimelineLayers({ payload: true, communication: true, ineligible: false })
  }

  return {
    timelinePlayheadTime,
    setTimelinePlayheadTime,
    timelineLive,
    setTimelineLive,
    timelinePlaying,
    setTimelinePlaying,
    timelinePlaybackSpeed,
    setTimelinePlaybackSpeed,
    timelineZoomLevel,
    setTimelineZoomLevel,
    timelineViewportWidthPx,
    setTimelineViewportWidthPx,
    timelineCustomZoomMultiplier,
    setTimelineCustomZoomMultiplier,
    timelineLayers,
    setTimelineLayers,
    timelineAssetVisibility,
    setTimelineAssetVisibility,
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
    timelinePlayingRef,
    timelinePlayheadDraggingRef,
    timelinePlaybackDomRef,
    timelinePlaybackLastTextSyncRef,
    resetTimelineView,
  }
}
