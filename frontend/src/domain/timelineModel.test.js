import { describe, expect, it } from 'vitest'

import { buildTimelineModel } from './timelineModel.js'

const PLANNING_WINDOW = {
  startTime: '2026-09-01T10:00:00.000Z',
  endTime: '2026-09-01T16:00:00.000Z',
  timeMode: 'utc',
}

const row = (overrides = {}) => ({
  linkId: 'LNK-1',
  backendLinkId: 'LNK-1',
  overpassId: 'OVP-1',
  satId: 'SAT-ALPHA',
  gsId: 'GS-KIRUNA',
  startTime: '2026-09-01T11:00:00.000Z',
  endTime: '2026-09-01T11:08:00.000Z',
  durationSeconds: 480,
  isEligible: true,
  availabilityStatus: 'available',
  scheduleBlocked: false,
  isScheduled: false,
  overrideState: 'auto',
  score: 0,
  tradeOffId: '—',
  usefulDataOffloadedMb: 0,
  ...overrides,
})

const OPTIONS = {
  selectedSatellites: ['SAT-ALPHA'],
  selectedGroundStations: ['GS-KIRUNA'],
  timelineAssetVisibility: { satellites: true, groundStations: true },
  timelineLayers: { payload: true, communication: true },
  tradeOffsCalculated: false,
}

const build = (rows, overrides = {}) => buildTimelineModel(
  rows,
  [],
  [],
  PLANNING_WINDOW,
  { ...OPTIONS, ...overrides },
)

describe('buildTimelineModel', () => {
  it('spans exactly the planning window', () => {
    const model = build([row()])
    expect(model.baseDate.toISOString()).toBe('2026-09-01T10:00:00.000Z')
    expect(model.endDate.toISOString()).toBe('2026-09-01T16:00:00.000Z')
    expect(model.totalMinutes).toBe(360)
  })

  it('places every link under both its satellite and its ground station', () => {
    const model = build([row()])
    const satellites = model.sections.find((section) => section.id === 'satellites')
    const groundStations = model.sections.find((section) => section.id === 'groundStations')

    expect(satellites.groups.map((group) => group.name)).toEqual(['SAT-ALPHA'])
    expect(groundStations.groups.map((group) => group.name)).toEqual(['GS-KIRUNA'])

    // The same link appears twice; both instances share a linkId so marking
    // one marks the other.
    const satItems = satellites.groups[0].rows.flatMap((r) => r.items)
    const gsItems = groundStations.groups[0].rows.flatMap((r) => r.items)
    expect(satItems.map((item) => item.linkId)).toEqual(['LNK-1'])
    expect(gsItems.map((item) => item.linkId)).toEqual(['LNK-1'])
  })

  it('hides a whole section when its visibility toggle is off', () => {
    const model = build([row()], {
      timelineAssetVisibility: { satellites: true, groundStations: false },
    })
    expect(model.sections.map((section) => section.id)).toEqual(['satellites'])
  })

  it('drops links outside the planning window', () => {
    const model = build([
      row(),
      row({
        linkId: 'LNK-LATE',
        backendLinkId: 'LNK-LATE',
        overpassId: 'OVP-LATE',
        startTime: '2026-09-02T11:00:00.000Z',
        endTime: '2026-09-02T11:08:00.000Z',
      }),
    ])
    const items = model.sections
      .flatMap((section) => section.groups)
      .flatMap((group) => group.rows)
      .flatMap((r) => r.items)
    expect([...new Set(items.map((item) => item.linkId))]).toEqual(['LNK-1'])
  })

  it('reports whether anything is visible at all', () => {
    expect(build([row()]).hasVisibleItems).toBe(true)
    expect(build([]).hasVisibleItems).toBe(false)
  })

  it('only creates a group for an asset that actually has overpasses', () => {
    // SAT-BRAVO is selected but has no link in the window, so it gets no
    // track: an empty row would read as "nothing scheduled here" when the
    // truth is "nothing was ever possible here".
    const model = build([row()], {
      selectedSatellites: ['SAT-ALPHA', 'SAT-BRAVO'],
      selectedGroundStations: ['GS-KIRUNA'],
    })
    const satellites = model.sections.find((section) => section.id === 'satellites')
    expect(satellites.groups.map((group) => group.name)).toEqual(['SAT-ALPHA'])
  })

  it('produces ruler ticks and day bands for the window', () => {
    const model = build([row()])
    expect(model.ticks.length).toBeGreaterThan(0)
    expect(model.dayBands).toHaveLength(1)
    expect(model.widthPx).toBeGreaterThanOrEqual(980)
  })

  it('carries the backend score and override state onto the bar', () => {
    const model = build(
      [row({ isScheduled: true, overrideState: 'pinned', score: 0.87, tradeOffId: 'TO-1' })],
      { tradeOffsCalculated: true },
    )
    const item = model.sections[0].groups[0].rows.flatMap((r) => r.items)[0]
    expect(item.isScheduled).toBe(true)
    expect(item.overrideState).toBe('pinned')
    expect(item.score).toBe(0.87)
  })
})
