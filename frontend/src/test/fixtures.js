// Backend fixtures for the characterization tests.
//
// These mirror the payload shapes the FastAPI backend actually returns, as
// consumed by scopeApi.js. They are deliberately minimal but structurally
// faithful: every field the frontend reads is present, so a shape change in
// the backend surfaces here rather than in a blank screen.

export const PLANNING_START_ISO = '2026-09-01T10:00:00.000Z'
export const PLANNING_END_ISO = '2026-09-01T22:00:00.000Z'

export const ASSETS_RESPONSE = {
  cached: false,
  assets: [
    { name: 'SAT-ALPHA', classification: 'satellite', eligible: true },
    { name: 'SAT-BRAVO', classification: 'satellite', eligible: true },
    { name: 'GS-KIRUNA', classification: 'groundstation', eligible: true },
    { name: 'GS-SVALBARD', classification: 'groundstation', eligible: true },
    {
      name: 'SAT-DECOMMISSIONED',
      classification: 'ineligible',
      eligible: false,
      ineligibility_reason: 'No TLE available for this asset.',
    },
  ],
  schedules: [{ name: 'SCOPE_TEST_SCHEDULE', activities: [] }],
}

const link = (overrides) => ({
  link_id: 'LNK-1',
  overpass_id: 'OVP-1',
  satellite_name: 'SAT-ALPHA',
  groundstation_name: 'GS-KIRUNA',
  start_time: '2026-09-01T11:00:00.000Z',
  end_time: '2026-09-01T11:08:00.000Z',
  duration_seconds: 480,
  max_elevation_deg: 42.5,
  estimated_data_capacity_mb: 12000,
  is_eligible: true,
  eligibility_status: 'eligible',
  ineligibility_reason: null,
  conflicting_activity_uuid: null,
  ...overrides,
})

// Two links that overlap in time on the same satellite: exactly the mutually
// exclusive situation the scheduler has to arbitrate, so the plan below has a
// real (non-trivial) trade-off group. The third is uncontested.
export const FILTERED_LINKS = [
  link({ link_id: 'LNK-1', overpass_id: 'OVP-1' }),
  link({
    link_id: 'LNK-2',
    overpass_id: 'OVP-2',
    groundstation_name: 'GS-SVALBARD',
    start_time: '2026-09-01T11:04:00.000Z',
    end_time: '2026-09-01T11:12:00.000Z',
    max_elevation_deg: 61.2,
    estimated_data_capacity_mb: 18000,
  }),
  link({
    link_id: 'LNK-3',
    overpass_id: 'OVP-3',
    satellite_name: 'SAT-BRAVO',
    groundstation_name: 'GS-KIRUNA',
    start_time: '2026-09-01T14:00:00.000Z',
    end_time: '2026-09-01T14:09:00.000Z',
    duration_seconds: 540,
    max_elevation_deg: 33.1,
    estimated_data_capacity_mb: 9000,
  }),
]

export const PROPAGATION_RESULT = {
  payload: {
    metadata: { task_id: 'orbit-run-1' },
    global_tracks: {
      'SAT-ALPHA': [
        { timestamp: '2026-09-01T10:00:00.000Z', latitude: 10, longitude: 20, altitude_km: 420 },
        { timestamp: '2026-09-01T10:10:00.000Z', latitude: 12, longitude: 24, altitude_km: 421 },
      ],
      'SAT-BRAVO': [
        { timestamp: '2026-09-01T10:00:00.000Z', latitude: -5, longitude: 60, altitude_km: 405 },
        { timestamp: '2026-09-01T10:10:00.000Z', latitude: -3, longitude: 64, altitude_km: 406 },
      ],
    },
  },
}

export const FILTER_RESULT = {
  payload: { filter_run_id: 'filter-run-1', links: FILTERED_LINKS },
}

const planStatus = (linkId, { scheduled, score, offloaded, overrideState = 'auto', tradeoffId = null }) => ({
  link: FILTERED_LINKS.find((candidate) => candidate.link_id === linkId),
  is_scheduled: scheduled,
  override_state: overrideState,
  score,
  tradeoff_id: tradeoffId,
  useful_data_offloaded_mb: offloaded,
  incoming_buffer_mb: 5000,
  potential_data_downlink_mb: 12000,
  rejection_reason: scheduled ? null : 'Lost the trade-off on expected data yield.',
})

// LNK-2 wins the contested group on capacity; LNK-1 is the losing alternative.
export const buildSessionPlan = (overrides = {}) => ({
  session_id: 'session-1',
  filter_run_id: 'filter-run-1',
  current_plan: {
    'LNK-1': planStatus('LNK-1', { scheduled: false, score: 0.41, offloaded: 0, tradeoffId: 'TO-1' }),
    'LNK-2': planStatus('LNK-2', { scheduled: true, score: 0.87, offloaded: 15000, tradeoffId: 'TO-1' }),
    'LNK-3': planStatus('LNK-3', { scheduled: true, score: 0.63, offloaded: 8000, tradeoffId: 'TO-2' }),
  },
  trade_off_groups: {
    'TO-1': {
      tradeoff_id: 'TO-1',
      is_trivial: false,
      start_time: '2026-09-01T11:00:00.000Z',
      link_ids: ['LNK-1', 'LNK-2'],
      participating_satellites: ['SAT-ALPHA'],
      participating_groundstations: ['GS-KIRUNA', 'GS-SVALBARD'],
    },
    // Trivial groups are filtered out of the cards; keeping one here proves it.
    'TO-2': {
      tradeoff_id: 'TO-2',
      is_trivial: true,
      start_time: '2026-09-01T14:00:00.000Z',
      link_ids: ['LNK-3'],
      participating_satellites: ['SAT-BRAVO'],
      participating_groundstations: ['GS-KIRUNA'],
    },
  },
  conflict_reasons: {
    'LNK-1:LNK-2': 'SAT-ALPHA has a single receiver and both passes overlap.',
  },
  satellite_configs: {
    'SAT-ALPHA': { downlink_rate_mbps: 25, capacity_mb: 100000 },
    'SAT-BRAVO': { downlink_rate_mbps: 25, capacity_mb: 100000 },
  },
  satellite_buffer_profiles: {
    'SAT-ALPHA': {
      points: [
        { timestamp: '2026-09-01T10:00:00.000Z', level_mb: 5000, event_type: 'window_start', associated_id: null },
        { timestamp: '2026-09-01T11:04:00.000Z', level_mb: 9000, event_type: 'downlink_start', associated_id: 'LNK-2' },
        { timestamp: '2026-09-01T11:12:00.000Z', level_mb: 1000, event_type: 'downlink_end', associated_id: 'LNK-2' },
      ],
      overflow_events: [],
      total_lost_mb: 0,
    },
    'SAT-BRAVO': {
      points: [
        { timestamp: '2026-09-01T10:00:00.000Z', level_mb: 5000, event_type: 'window_start', associated_id: null },
        { timestamp: '2026-09-01T14:00:00.000Z', level_mb: 8600, event_type: 'downlink_start', associated_id: 'LNK-3' },
        { timestamp: '2026-09-01T14:09:00.000Z', level_mb: 600, event_type: 'downlink_end', associated_id: 'LNK-3' },
      ],
      overflow_events: [],
      total_lost_mb: 0,
    },
  },
  ...overrides,
})

// The same plan after the operator pins LNK-1, which evicts LNK-2.
export const buildOverriddenSessionPlan = () => {
  const plan = buildSessionPlan()
  plan.current_plan['LNK-1'] = planStatus('LNK-1', {
    scheduled: true,
    score: 0.41,
    offloaded: 11000,
    overrideState: 'pinned',
    tradeoffId: 'TO-1',
  })
  plan.current_plan['LNK-2'] = planStatus('LNK-2', {
    scheduled: false,
    score: 0.87,
    offloaded: 0,
    tradeoffId: 'TO-1',
  })
  return plan
}

export const COMMIT_RESULT = {
  committed_links: 2,
  created_activities: 2,
  schedule_name: 'SCOPE_TEST_SCHEDULE',
}
