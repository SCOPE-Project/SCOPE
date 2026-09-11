// Layout, timeline and scheduling defaults shared across the app.
//
// These were module constants inside App.jsx. They are values, not policy:
// anything that reads state or derives from it belongs in domain/ instead.

// Reset View puts the whole planning window back on screen. Everything between
// 1x and the max multiplier is reached with Ctrl/Cmd + wheel.
export const TIMELINE_DEFAULT_ZOOM_LEVEL = 'fit'
// The primary schedule layers for the timeline.
export const TIMELINE_LAYERS = [
  { id: 'payload', label: 'Payload Schedule' },
  { id: 'communication', label: 'Communication Schedule' },
]
export const TIMELINE_WHEEL_ZOOM_STEP = 0.6
export const TIMELINE_MIN_ZOOM_MULTIPLIER = 1
export const TIMELINE_FIT_EDGE_INSET_PX = 14
export const TIMELINE_PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128]
export const DEFAULT_PLANNING_TIME_MODE = 'utc'
export const MAP_PANEL_CHROME_OVERHEAD_PX = 88
// Panel identity is separate from panel position: PANEL_LABELS/panelSlotAssignment
// let every panel (Overview, Trade-Off, Map View, Timeline) be
// dragged between layout slots, while collapse state etc. stays keyed
// to the panel itself.
export const PANEL_LABELS = {
  overview: 'Overview',
  mapView: 'Map View',
  timeline: 'Timeline',
}

// Values entered in GB are converted to MB at the API boundary. Backend rate
// fields currently use MB/s semantics despite their historical `_mbps` names.
// Keep in sync with the backend fallbacks in core/models/scheduling.py
// (DEFAULT_BUFFER_* / DEFAULT_PAYLOAD_GENERATION_RATE_MBPS). The frontend always
// sends an explicit default_buffer_config, so these are the values that actually
// reach the scheduler; the backend constants only cover API/CLI callers.
export const DEFAULT_DATA_START_FILL_GB = 5
export const DEFAULT_DATA_GENERATION_MBPS = 4
export const DEFAULT_DATA_CAPACITY_GB = 100
export const DEFAULT_DOWNLINK_RATE_MBPS = 25
export const DEFAULT_TRADE_OFF_STRATEGY = 'buffer_overflow_avoidance'
export const DEFAULT_SCORING_ALPHA = 2
export const DEFAULT_SCORING_EXPONENT = 2
export const TRADE_OFF_STRATEGIES = [
  { value: 'buffer_overflow_avoidance', label: 'Buffer overflow avoidance' },
  { value: 'max_downlink_throughput', label: 'Maximum downlink throughput' },
  { value: 'max_pass_duration', label: 'Maximum pass duration' },
]

