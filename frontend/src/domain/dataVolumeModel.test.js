import { describe, expect, it } from 'vitest'

import { buildDataVolumeModel, buildDataVolumePolyline } from './dataVolumeModel.js'

const TIMELINE_MODEL = {
  baseDate: new Date('2026-09-01T10:00:00.000Z'),
  endDate: new Date('2026-09-01T16:00:00.000Z'),
  sections: [
    {
      id: 'satellites',
      groups: [{ id: 'sat:SAT-ALPHA', name: 'SAT-ALPHA' }],
    },
  ],
}

const SESSION_PLAN = {
  satellite_configs: { 'SAT-ALPHA': { downlink_rate_mbps: 25 } },
  satellite_buffer_profiles: {
    'SAT-ALPHA': {
      capacity_mb: 100000,
      total_generated_mb: 20000,
      total_downlinked_mb: 15000,
      total_lost_mb: 0,
      final_level_mb: 5000,
      peak_level_mb: 9000,
      overflow_events: [],
      profile_points: [
        { timestamp: '2026-09-01T10:00:00.000Z', level_mb: 5000, event_type: 'window_start', associated_id: null },
        { timestamp: '2026-09-01T10:30:00.000Z', level_mb: 6000, event_type: 'payload_start', associated_id: 'PL-1' },
        { timestamp: '2026-09-01T10:50:00.000Z', level_mb: 9000, event_type: 'payload_end', associated_id: 'PL-1' },
        { timestamp: '2026-09-01T11:00:00.000Z', level_mb: 9000, event_type: 'downlink_start', associated_id: 'LNK-1' },
        { timestamp: '2026-09-01T11:08:00.000Z', level_mb: 1000, event_type: 'downlink_end', associated_id: 'LNK-1' },
      ],
    },
  },
}

const FINAL_ROWS = [{
  backendLinkId: 'LNK-1',
  overpassId: 'OVP-1',
  satId: 'SAT-ALPHA',
  gsId: 'GS-KIRUNA',
  maxElevation: '42.5°',
  startTime: '2026-09-01T11:00:00.000Z',
  endTime: '2026-09-01T11:08:00.000Z',
  usefulDataOffloadedMb: 8000,
}]

const build = (overrides = {}) => buildDataVolumeModel({
  timelineModel: TIMELINE_MODEL,
  sessionPlan: SESSION_PLAN,
  expandedTimelineSections: { satellites: true },
  expandedTimelineGroups: { 'sat:SAT-ALPHA': true },
  finalScheduleRows: FINAL_ROWS,
  ...overrides,
})

describe('buildDataVolumeModel', () => {
  it('returns null before a session plan or timeline model exists', () => {
    expect(build({ sessionPlan: null })).toBeNull()
    expect(build({ timelineModel: null })).toBeNull()
  })

  it('converts backend MB into GB without deriving anything', () => {
    const series = build().series[0]
    expect(series.capacityGb).toBe(100)
    expect(series.totalGeneratedGb).toBe(20)
    expect(series.totalDownlinkedGb).toBe(15)
    expect(series.finalLevelGb).toBe(5)
    expect(series.peakLevelGb).toBe(9)
    expect(series.overflowed).toBe(false)
  })

  it('pairs payload start and end points into windows', () => {
    const series = build().series[0]
    expect(series.payloadWindows).toHaveLength(1)
    expect(series.payloadWindows[0]).toMatchObject({ id: 'PL-1' })
  })

  it('reads each downlink step\'s levels from the backend profile', () => {
    const step = build().series[0].steps[0]
    expect(step).toMatchObject({
      id: 'LNK-1',
      label: 'OVP-1',
      gsId: 'GS-KIRUNA',
      downlinkMbps: 25,
      transferredGb: 8,
      levelBefore: 9,
      levelAfter: 1,
    })
  })

  it('only includes satellites whose group is expanded', () => {
    expect(build({ expandedTimelineGroups: {} }).series).toHaveLength(0)
    expect(build({ expandedTimelineSections: { satellites: false } }).expandedSatelliteCount).toBe(0)
  })

  it('reports a positive duration even for a zero-length window', () => {
    const model = build({
      timelineModel: {
        ...TIMELINE_MODEL,
        endDate: new Date('2026-09-01T10:00:00.000Z'),
      },
    })
    expect(model.durationMs).toBeGreaterThan(0)
  })

  it('skips a satellite the plan has no profile for', () => {
    expect(build({
      sessionPlan: { ...SESSION_PLAN, satellite_buffer_profiles: {} },
    }).series).toHaveLength(0)
  })
})

describe('buildDataVolumePolyline', () => {
  const scale = { startTimestamp: 0, durationMs: 1000, yMaxGb: 100 }

  it('maps points into the 1000x100 viewBox', () => {
    expect(buildDataVolumePolyline([
      { timestamp: 0, level: 0 },
      { timestamp: 500, level: 50 },
      { timestamp: 1000, level: 100 },
    ], scale)).toBe('0.00,100.00 500.00,50.00 1000.00,0.00')
  })

  it('returns an empty string without points or scale', () => {
    expect(buildDataVolumePolyline([], scale)).toBe('')
    expect(buildDataVolumePolyline([{ timestamp: 0, level: 0 }], null)).toBe('')
  })
})
