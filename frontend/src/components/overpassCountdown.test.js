import { describe, expect, it } from 'vitest'

import { formatCountdownDelta, formatOverpassCountdown } from './overpassCountdown.js'

const NOW = Date.parse('2026-08-27T12:00:00Z')
const at = (iso) => Date.parse(iso)

describe('formatCountdownDelta', () => {
  it('renders hours, minutes and seconds below one day', () => {
    expect(formatCountdownDelta(3 * 3600000 + 12 * 60000 + 45000)).toBe('03:12:45')
  })

  it('zero-pads every component', () => {
    expect(formatCountdownDelta(65000)).toBe('00:01:05')
  })

  it('switches to days and drops seconds beyond 24 h', () => {
    expect(formatCountdownDelta(2 * 86400000 + 3 * 3600000 + 12 * 60000)).toBe('2d 03:12')
  })

  it('rounds up so a partial second never reads as zero', () => {
    expect(formatCountdownDelta(1)).toBe('00:00:01')
    expect(formatCountdownDelta(1500)).toBe('00:00:02')
  })

  it('clamps negative deltas to zero', () => {
    expect(formatCountdownDelta(-5000)).toBe('00:00:00')
  })
})

describe('formatOverpassCountdown', () => {
  it('counts down to a future overpass', () => {
    const result = formatOverpassCountdown('2026-08-27T13:30:00Z', '2026-08-27T13:40:00Z', NOW)
    expect(result.state).toBe('future')
    expect(result.label).toBe('T-01:30:00')
  })

  it('spans multiple days', () => {
    const result = formatOverpassCountdown('2026-08-29T15:00:00Z', '2026-08-29T15:10:00Z', NOW)
    expect(result.label).toBe('T-2d 03:00')
  })

  it('reports an overpass that is currently running', () => {
    const result = formatOverpassCountdown('2026-08-27T11:55:00Z', '2026-08-27T12:05:00Z', NOW)
    expect(result.state).toBe('active')
    expect(result.label).toBe('In pass')
  })

  it('treats the exact AOS instant as in pass, not as T-00:00:00', () => {
    const result = formatOverpassCountdown('2026-08-27T12:00:00Z', '2026-08-27T12:10:00Z', NOW)
    expect(result.state).toBe('active')
  })

  it('reports an overpass that is over', () => {
    const result = formatOverpassCountdown('2026-08-27T10:00:00Z', '2026-08-27T10:10:00Z', NOW)
    expect(result.state).toBe('past')
    expect(result.label).toBe('Elapsed')
  })

  it('falls back to a dash for unusable timestamps', () => {
    expect(formatOverpassCountdown(null, null, NOW).state).toBe('unknown')
    expect(formatOverpassCountdown('not-a-date', 'not-a-date', NOW).label).toBe('\u2014')
  })

  it('still counts down when the end timestamp is missing', () => {
    const result = formatOverpassCountdown('2026-08-27T12:00:30Z', undefined, NOW)
    expect(result.state).toBe('future')
    expect(result.label).toBe('T-00:00:30')
  })

  it('ticks down one second at a time', () => {
    const start = '2026-08-27T12:01:00Z'
    expect(formatOverpassCountdown(start, undefined, NOW).label).toBe('T-00:01:00')
    expect(formatOverpassCountdown(start, undefined, NOW + 1000).label).toBe('T-00:00:59')
    expect(formatOverpassCountdown(start, undefined, at(start) - 1).label).toBe('T-00:00:01')
  })
})
