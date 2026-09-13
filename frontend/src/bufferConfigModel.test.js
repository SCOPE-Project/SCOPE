import { describe, expect, it } from 'vitest'
import {
  buildBufferConfigPayload,
  buildSatelliteDownlinkRates,
  clearBufferOverride,
  hasBufferOverride,
  resolveBufferConfig,
  setBufferOverrideField,
  validateBufferSetup,
} from './bufferConfigModel.js'

const defaults = {
  capacityGb: '100',
  startFillGb: '5',
  generationMbps: '4',
  downlinkRateMbps: '25',
}

describe('bufferConfigModel', () => {
  it('resolves blank override fields from the default', () => {
    expect(resolveBufferConfig(defaults, { capacityGb: '250', startFillGb: '' })).toEqual({
      capacityGb: 250,
      startFillGb: 5,
      generationMbps: 4,
      downlinkRateMbps: 25,
    })
  })

  it('adds and removes override fields, dropping empty satellites', () => {
    let overrides = setBufferOverrideField({}, 'Sat-2', 'generationMbps', '8')
    expect(overrides).toEqual({ 'Sat-2': { generationMbps: '8' } })
    expect(hasBufferOverride(overrides, 'Sat-2')).toBe(true)

    overrides = setBufferOverrideField(overrides, 'Sat-2', 'generationMbps', '  ')
    expect(overrides).toEqual({})
    expect(hasBufferOverride(overrides, 'Sat-2')).toBe(false)

    overrides = setBufferOverrideField({ 'Sat-1': { capacityGb: '50' } }, 'Sat-2', 'capacityGb', '60')
    expect(clearBufferOverride(overrides, 'Sat-1')).toEqual({ 'Sat-2': { capacityGb: '60' } })
  })

  it('validates overrides after merging with the default', () => {
    const overrides = { 'Sat-2': { capacityGb: '2' }, 'Sat-3': { capacityGb: '2' } }
    const result = validateBufferSetup(defaults, overrides, ['Sat-1', 'Sat-2'])

    expect(result.valid).toBe(false)
    expect(result.defaultError).toBeNull()
    // Inherited 5 GB fill no longer fits a 2 GB buffer; Sat-3 is not selected.
    expect(result.satelliteErrors).toEqual({ 'Sat-2': 'initial fill cannot exceed capacity' })

    expect(validateBufferSetup({ ...defaults, capacityGb: '' }, {}, ['Sat-1']).defaultError)
      .toBe('capacity must be positive')
  })

  it('builds a sparse MB payload limited to the given satellites', () => {
    const overrides = {
      'Sat-2': { capacityGb: '250', downlinkRateMbps: '50' },
      'Sat-9': { capacityGb: '10' },
    }

    expect(buildBufferConfigPayload(defaults, overrides, ['Sat-2', 'Sat-1'])).toEqual({
      default_buffer_config: {
        capacity_mb: 100000,
        initial_level_mb: 5000,
        payload_generation_rate_mbps: 4,
        downlink_rate_mbps: 25,
      },
      satellite_buffer_configs: {
        'Sat-2': { capacity_mb: 250000, downlink_rate_mbps: 50 },
      },
    })
  })

  it('extracts per-satellite downlink rates for link filtering', () => {
    const overrides = {
      'Sat-1': { capacityGb: '250' },
      'Sat-2': { downlinkRateMbps: '50' },
      'Sat-3': { downlinkRateMbps: '10' },
    }

    expect(buildSatelliteDownlinkRates(overrides, ['Sat-1', 'Sat-2'])).toEqual({ 'Sat-2': 50 })
  })
})
