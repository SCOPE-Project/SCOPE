import { describe, expect, it } from 'vitest'

import {
  getAssetWarningMessage,
  getOverviewControlTooltip,
  getScheduleToggleState,
  getScheduleToggleTitle,
  normalizeAssetClassification,
  parseOptionalDegreeInput,
} from './assets.js'

describe('normalizeAssetClassification', () => {
  it('accepts both spellings the backend uses for a ground station', () => {
    expect(normalizeAssetClassification({ classification: 'groundstation' })).toBe('ground_station')
    expect(normalizeAssetClassification({ classification: 'ground_station' })).toBe('ground_station')
  })

  it('passes satellites through', () => {
    expect(normalizeAssetClassification({ classification: 'satellite' })).toBe('satellite')
  })

  it('treats an eligible:false asset as ineligible whatever its class', () => {
    expect(normalizeAssetClassification({ classification: 'satellite', eligible: false }))
      .toBe('satellite')
    expect(normalizeAssetClassification({ classification: 'something', eligible: false }))
      .toBe('ineligible')
    expect(normalizeAssetClassification({ classification: 'ineligible' })).toBe('ineligible')
  })

  it('falls back to unknown when the backend sends no classification', () => {
    expect(normalizeAssetClassification({})).toBe('unknown')
  })
})

describe('getAssetWarningMessage', () => {
  it('prefers the most specific field the backend populated', () => {
    expect(getAssetWarningMessage({ error: 'a', reason: 'b' })).toBe('a')
    expect(getAssetWarningMessage({ reason: 'b', message: 'c' })).toBe('b')
    expect(getAssetWarningMessage({ ineligibility_reason: 'no TLE' })).toBe('no TLE')
  })

  it('returns null when the backend offered no explanation', () => {
    expect(getAssetWarningMessage({})).toBeNull()
    expect(getAssetWarningMessage(null)).toBeNull()
  })
})

describe('parseOptionalDegreeInput', () => {
  it('treats an empty field as "no filter"', () => {
    expect(parseOptionalDegreeInput('')).toBeNull()
    expect(parseOptionalDegreeInput('   ')).toBeNull()
  })

  it('parses a number', () => {
    expect(parseOptionalDegreeInput('12.5')).toBe(12.5)
    expect(parseOptionalDegreeInput('0')).toBe(0)
  })

  it('reports NaN for junk, distinct from an empty field', () => {
    expect(parseOptionalDegreeInput('abc')).toBeNaN()
  })
})

describe('override control vocabulary', () => {
  it('toggles between the two forcing states, never back to auto', () => {
    expect(getScheduleToggleState(true)).toBe('excluded')
    expect(getScheduleToggleState(false)).toBe('pinned')
  })

  it('describes what a click will do, not what the state is', () => {
    expect(getScheduleToggleTitle(true)).toMatch(/stay unscheduled/)
    expect(getScheduleToggleTitle(false)).toMatch(/stay scheduled/)
  })

  it('explains each override state', () => {
    expect(getOverviewControlTooltip('auto')).toMatch(/backend scheduling decision/)
    expect(getOverviewControlTooltip('pinned')).toMatch(/stay scheduled/)
    expect(getOverviewControlTooltip('excluded')).toMatch(/stay unscheduled/)
  })
})
