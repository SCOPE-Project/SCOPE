import { describe, expect, it } from 'vitest'

import {
  buildDayBands,
  formatBufferLevelGb,
  formatDataDownlinkGb,
  formatDurationFromSeconds,
  formatElevation,
  formatGb,
  formatOverviewEndDateTime,
  formatOverviewStartDateTime,
  formatPlanningWindow,
  formatTimelineDuration,
  formatTimelineItemDuration,
  formatUtcEventDateTime,
  getActivityEndTimestamp,
  getActivityStartTimestamp,
  getBackendDataDownlinkMb,
  getDayOfYear,
  getEventTimestamp,
  getOverviewDayOffset,
  getOverviewDisplayLinkId,
  getOverviewRowStatus,
  getPassCapacityMb,
  isUnavailableOverviewRow,
  layoutTimelineItems,
  shouldHideOverviewRowInAvailableMode,
  toTimestamp,
} from './format.js'

describe('timestamp readers', () => {
  it('accepts a plain string, an object with a timestamp, or neither', () => {
    expect(getEventTimestamp('2026-09-01T10:00:00Z')).toBe('2026-09-01T10:00:00Z')
    expect(getEventTimestamp({ timestamp: '2026-09-01T10:00:00Z' })).toBe('2026-09-01T10:00:00Z')
    expect(getEventTimestamp(null)).toBeNull()
    expect(getEventTimestamp({})).toBeNull()
  })

  it('falls through the snake_case and camelCase activity shapes in order', () => {
    expect(getActivityStartTimestamp({ start_event: '2026-01-01T00:00:00Z' }))
      .toBe('2026-01-01T00:00:00Z')
    expect(getActivityStartTimestamp({ startEvent: { timestamp: '2026-01-02T00:00:00Z' } }))
      .toBe('2026-01-02T00:00:00Z')
    expect(getActivityStartTimestamp({ start_timestamp: '2026-01-03T00:00:00Z' }))
      .toBe('2026-01-03T00:00:00Z')
    expect(getActivityStartTimestamp({})).toBeNull()
    expect(getActivityEndTimestamp({ end_event: '2026-01-04T00:00:00Z' }))
      .toBe('2026-01-04T00:00:00Z')
  })

  it('returns null rather than NaN for unparseable input', () => {
    expect(toTimestamp('2026-09-01T10:00:00.000Z')).toBe(Date.parse('2026-09-01T10:00:00.000Z'))
    expect(toTimestamp('not a date')).toBeNull()
    expect(toTimestamp(null)).toBeNull()
    expect(toTimestamp('')).toBeNull()
  })
})

describe('formatDurationFromSeconds', () => {
  it('renders minutes and seconds', () => {
    expect(formatDurationFromSeconds(480)).toBe('8min 0s')
    expect(formatDurationFromSeconds(505)).toBe('8min 25s')
    expect(formatDurationFromSeconds(59)).toBe('0min 59s')
  })

  it('renders an em dash for a missing or non-positive duration', () => {
    expect(formatDurationFromSeconds(0)).toBe('—')
    expect(formatDurationFromSeconds(-5)).toBe('—')
    expect(formatDurationFromSeconds(Number.NaN)).toBe('—')
    expect(formatDurationFromSeconds(undefined)).toBe('—')
  })
})

describe('formatUtcEventDateTime', () => {
  it('always renders UTC regardless of the host time zone', () => {
    expect(formatUtcEventDateTime('2026-09-01T14:05:09.000Z')).toBe('2026-09-01, 14:05:09')
  })

  it('renders an em dash for missing or invalid values', () => {
    expect(formatUtcEventDateTime(null)).toBe('—')
    expect(formatUtcEventDateTime('rubbish')).toBe('—')
  })
})

describe('overview date labels', () => {
  // These formatters delegate to toLocaleString, so the exact clock format
  // follows the host locale. Assert the structure, not the punctuation.
  it('renders start as date plus time', () => {
    const label = formatOverviewStartDateTime('2026-09-01T14:05:09.000Z', 'utc')
    expect(label).toMatch(/Sep/)
    expect(label).toMatch(/\b0?1\b/)
    expect(label).toMatch(/:05:09/)
  })

  it('marks an end that rolls past midnight with a day offset', () => {
    expect(formatOverviewEndDateTime(
      '2026-09-01T23:50:00.000Z',
      '2026-09-02T00:10:00.000Z',
      'utc',
    )).toMatch(/:10:00.*\+1$/)
  })

  it('omits the offset when start and end share a day', () => {
    const sameDay = formatOverviewEndDateTime(
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T10:08:00.000Z',
      'utc',
    )
    expect(sameDay).toMatch(/:08:00/)
    expect(sameDay).not.toMatch(/\+/)
  })

  it('counts whole days across a multi-day gap', () => {
    expect(getOverviewDayOffset(
      new Date('2026-09-01T23:00:00.000Z'),
      new Date('2026-09-04T01:00:00.000Z'),
      'utc',
    )).toBe(3)
  })

  it('renders an em dash when either side is missing', () => {
    expect(formatOverviewStartDateTime(null, 'utc')).toBe('—')
    expect(formatOverviewEndDateTime('2026-09-01T10:00:00.000Z', null, 'utc')).toBe('—')
  })
})

describe('formatElevation', () => {
  it('renders one decimal place with a degree sign', () => {
    expect(formatElevation(42.57)).toBe('42.6°')
    expect(formatElevation(42.5)).toBe('42.5°')
    expect(formatElevation(0)).toBe('0.0°')
    expect(formatElevation(Number.NaN)).toBe('—')
  })
})

describe('overview row status', () => {
  const row = (overrides) => ({
    isEligible: true,
    availabilityStatus: 'available',
    scheduleBlocked: false,
    linkId: 'LNK-1',
    backendLinkId: 'LNK-1',
    ...overrides,
  })

  it('reports blocked ahead of ineligible', () => {
    expect(getOverviewRowStatus(row({ scheduleBlocked: true, isEligible: false })))
      .toBe('blocked')
    expect(getOverviewRowStatus(row({ availabilityStatus: 'blocked' }))).toBe('blocked')
  })

  it('reports ineligible for filtered and unavailable rows', () => {
    expect(getOverviewRowStatus(row({ isEligible: false }))).toBe('ineligible')
    expect(getOverviewRowStatus(row({ availabilityStatus: 'filtered' }))).toBe('ineligible')
    expect(getOverviewRowStatus(row({ availabilityStatus: 'unavailable' }))).toBe('ineligible')
  })

  it('reports eligible otherwise', () => {
    expect(getOverviewRowStatus(row())).toBe('eligible')
  })

  it('treats blocked rows as unavailable but still shows them in available mode', () => {
    const blocked = row({ scheduleBlocked: true })
    expect(isUnavailableOverviewRow(blocked)).toBe(true)
    expect(shouldHideOverviewRowInAvailableMode(blocked)).toBe(false)
    expect(shouldHideOverviewRowInAvailableMode(row({ isEligible: false }))).toBe(true)
  })

  it('masks the link id of an ineligible row', () => {
    expect(getOverviewDisplayLinkId(row())).toBe('LNK-1')
    expect(getOverviewDisplayLinkId(row({ isEligible: false }))).toBe('—')
  })
})

describe('data volume formatting', () => {
  it('drops the decimal above 100 GB', () => {
    expect(formatGb(4.25)).toBe('4.3 GB')
    expect(formatGb(128.4)).toBe('128 GB')
    expect(formatGb(100)).toBe('100 GB')
  })

  it('converts MB to GB for downlink and buffer readouts', () => {
    expect(formatDataDownlinkGb(15000)).toBe('15.0 GB')
    expect(formatBufferLevelGb(9000)).toBe('9.0 GB')
    expect(formatDataDownlinkGb(Number.NaN)).toBe('—')
  })

  it('keeps offloaded volume and pass capacity as separate quantities', () => {
    const item = { usefulDataOffloadedMb: 0, estimatedDataCapacityMb: 12000 }
    // A link the backend did not schedule reports 0 offloaded even though the
    // pass could theoretically have carried 12 GB. Never substitute one for
    // the other.
    expect(getBackendDataDownlinkMb(item)).toBe(0)
    expect(getPassCapacityMb(item)).toBe(12000)
    expect(getBackendDataDownlinkMb({})).toBeNaN()
    expect(getPassCapacityMb({})).toBeNaN()
  })
})

describe('timeline durations', () => {
  it('measures the gap between two timestamps', () => {
    expect(formatTimelineDuration('2026-09-01T10:00:00Z', '2026-09-01T10:08:00Z'))
      .toBe('8min 0s')
  })

  it('rejects a reversed or incomplete range', () => {
    expect(formatTimelineDuration('2026-09-01T10:08:00Z', '2026-09-01T10:00:00Z')).toBe('—')
    expect(formatTimelineDuration(null, '2026-09-01T10:08:00Z')).toBe('—')
  })

  it('prefers a link\'s backend duration over the timestamp gap', () => {
    expect(formatTimelineItemDuration({
      kind: 'link',
      durationSeconds: 300,
      startTime: '2026-09-01T10:00:00Z',
      endTime: '2026-09-01T10:08:00Z',
    })).toBe('5min 0s')
  })

  it('falls back to the timestamps for a non-link item', () => {
    expect(formatTimelineItemDuration({
      kind: 'activity',
      startTime: '2026-09-01T10:00:00Z',
      endTime: '2026-09-01T10:08:00Z',
    })).toBe('8min 0s')
  })
})

describe('getDayOfYear', () => {
  it('counts days from the start of the year', () => {
    expect(getDayOfYear(new Date('2026-01-01T12:00:00Z'), 'utc')).toBe(1)
    expect(getDayOfYear(new Date('2026-12-31T12:00:00Z'), 'utc')).toBe(365)
  })
})

describe('formatPlanningWindow', () => {
  it('collapses a same-day window to one date and two times', () => {
    const label = formatPlanningWindow(
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T22:00:00.000Z',
      'utc',
    )
    // One date, then the two clock times: the date must not repeat.
    expect(label.match(/Sep/g)).toHaveLength(1)
    expect(label).toContain(' - ')
  })

  it('spells out both ends of a multi-day window', () => {
    const label = formatPlanningWindow(
      '2026-09-01T22:00:00.000Z',
      '2026-09-03T02:00:00.000Z',
      'utc',
    )
    expect(label.match(/Sep/g)).toHaveLength(2)
  })

  it('renders an em dash for an incomplete window', () => {
    expect(formatPlanningWindow(null, '2026-09-01T22:00:00.000Z', 'utc')).toBe('—')
    expect(formatPlanningWindow('rubbish', 'rubbish', 'utc')).toBe('—')
  })
})

describe('layoutTimelineItems', () => {
  it('keeps non-overlapping items in one lane', () => {
    const { laneCount, items } = layoutTimelineItems([
      { id: 'a', startMinutes: 0, durationMinutes: 10 },
      { id: 'b', startMinutes: 20, durationMinutes: 10 },
    ])
    expect(laneCount).toBe(1)
    expect(items.map((item) => item.laneIndex)).toEqual([0, 0])
  })

  it('pushes an overlapping item into a second lane', () => {
    const { laneCount, items } = layoutTimelineItems([
      { id: 'a', startMinutes: 0, durationMinutes: 30 },
      { id: 'b', startMinutes: 10, durationMinutes: 10 },
    ])
    expect(laneCount).toBe(2)
    expect(items.find((item) => item.id === 'b').laneIndex).toBe(1)
  })

  it('reports at least one lane for an empty set', () => {
    expect(layoutTimelineItems([]).laneCount).toBe(1)
  })
})

describe('buildDayBands', () => {
  it('splits a window at midnight and alternates the stripe', () => {
    const bands = buildDayBands(new Date('2026-09-01T22:00:00.000Z'), 6 * 60, 'utc')
    expect(bands).toHaveLength(2)
    expect(bands[0].widthMinutes).toBe(120)
    expect(bands[1].widthMinutes).toBe(240)
    expect(bands[0].alt).toBe(false)
    expect(bands[1].alt).toBe(true)
  })

  it('produces a single band for a window inside one day', () => {
    const bands = buildDayBands(new Date('2026-09-01T10:00:00.000Z'), 4 * 60, 'utc')
    expect(bands).toHaveLength(1)
    expect(bands[0].startMinutes).toBe(0)
  })
})
