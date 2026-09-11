import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PLANNING_WINDOW_PRESET,
  buildPlanningWindowPreset,
  formatPlanningDateFields,
  padDateTimePart,
  parsePlanningDateFields,
  resolvePlanningResetDate,
  roundUpToNextHour,
} from './planningWindow.js'

describe('padDateTimePart', () => {
  it('pads single digits and leaves wider values alone', () => {
    expect(padDateTimePart(7)).toBe('07')
    expect(padDateTimePart(12)).toBe('12')
    expect(padDateTimePart(0)).toBe('00')
  })
})

describe('formatPlanningDateFields', () => {
  const instant = new Date('2026-03-09T21:05:00.000Z')

  it('reads UTC fields in utc mode', () => {
    expect(formatPlanningDateFields(instant, 'utc')).toEqual({
      date: '2026-03-09',
      time: '21:05',
    })
  })

  it('reads local fields in local mode', () => {
    const expectedDay = String(instant.getDate()).padStart(2, '0')
    const expectedHour = String(instant.getHours()).padStart(2, '0')
    const fields = formatPlanningDateFields(instant, 'local')
    expect(fields.date.endsWith(expectedDay)).toBe(true)
    expect(fields.time.startsWith(expectedHour)).toBe(true)
  })
})

describe('parsePlanningDateFields', () => {
  it('parses a well-formed utc pair', () => {
    const parsed = parsePlanningDateFields('2026-09-01', '14:30', 'utc')
    expect(parsed.toISOString()).toBe('2026-09-01T14:30:00.000Z')
  })

  it('treats the same pair as local time in local mode', () => {
    const parsed = parsePlanningDateFields('2026-09-01', '14:30', 'local')
    expect(parsed.getHours()).toBe(14)
    expect(parsed.getMinutes()).toBe(30)
  })

  it('rejects a missing date or a malformed time', () => {
    expect(parsePlanningDateFields('', '14:30', 'utc')).toBeNull()
    expect(parsePlanningDateFields('2026-09-01', '1430', 'utc')).toBeNull()
    expect(parsePlanningDateFields('2026-09-01', '4:30', 'utc')).toBeNull()
    expect(parsePlanningDateFields('2026-09-01', '', 'utc')).toBeNull()
  })
})

describe('roundUpToNextHour', () => {
  it('advances to the next hour boundary', () => {
    expect(roundUpToNextHour(new Date('2026-09-01T10:17:42.000Z')).toISOString())
      .toBe('2026-09-01T11:00:00.000Z')
  })

  it('moves strictly forward when already on the boundary', () => {
    expect(roundUpToNextHour(new Date('2026-09-01T10:00:00.000Z')).toISOString())
      .toBe('2026-09-01T11:00:00.000Z')
  })
})

describe('buildPlanningWindowPreset', () => {
  it('spans one hour starting at the next boundary', () => {
    const preset = buildPlanningWindowPreset('utc', new Date('2026-09-01T10:17:00.000Z'))
    expect(preset).toMatchObject({
      startDate: '2026-09-01',
      startTime: '11:00',
      endDate: '2026-09-01',
      endTime: '12:00',
      startIso: '2026-09-01T11:00:00.000Z',
      endIso: '2026-09-01T12:00:00.000Z',
    })
  })

  it('rolls the end date over midnight', () => {
    const preset = buildPlanningWindowPreset('utc', new Date('2026-09-01T23:10:00.000Z'))
    expect(preset.startDate).toBe('2026-09-02')
    expect(preset.startTime).toBe('00:00')
    expect(preset.endTime).toBe('01:00')
  })

  it('exports a module-level preset with the same shape', () => {
    expect(Object.keys(DEFAULT_PLANNING_WINDOW_PRESET).sort()).toEqual(
      ['endDate', 'endIso', 'endTime', 'startDate', 'startIso', 'startTime'],
    )
  })
})

describe('resolvePlanningResetDate', () => {
  it('keeps a stored preset that is still in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'))

    const stored = '2026-09-01T18:00:00.000Z'
    expect(resolvePlanningResetDate(stored, 'utc', 'start').toISOString()).toBe(stored)

    vi.useRealTimers()
  })

  it('falls back to a fresh window when the stored preset has aged into the past', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T10:17:00.000Z'))

    // Reset must never land in the past, so a stale preset is discarded.
    const resolved = resolvePlanningResetDate('2026-08-30T09:00:00.000Z', 'utc', 'start')
    expect(resolved.toISOString()).toBe('2026-09-01T11:00:00.000Z')

    const resolvedEnd = resolvePlanningResetDate('2026-08-30T09:00:00.000Z', 'utc', 'end')
    expect(resolvedEnd.toISOString()).toBe('2026-09-01T12:00:00.000Z')

    vi.useRealTimers()
  })
})
