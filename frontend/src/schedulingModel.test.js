import { describe, expect, it } from 'vitest'
import {
  applySessionPlanToRows,
  buildCommitSummary,
  buildRowsFromFilteredLinks,
  buildSelectedOptionsFromPlan,
  buildTradeOffCardsFromPlan,
  getScheduledRows,
} from './schedulingModel.js'

const links = [
  {
    link_id: 'L1',
    overpass_id: 'OP1',
    satellite_name: 'Sat-1',
    groundstation_name: 'GS-1',
    start_time: '2026-08-22T10:00:00Z',
    end_time: '2026-08-22T10:10:00Z',
    duration_seconds: 600,
    max_elevation_deg: 45,
    estimated_data_capacity_mb: 15000,
    is_eligible: true,
    eligibility_status: 'eligible',
  },
  {
    link_id: 'L2',
    overpass_id: 'OP2',
    satellite_name: 'Sat-2',
    groundstation_name: 'GS-1',
    start_time: '2026-08-22T10:01:00Z',
    end_time: '2026-08-22T10:11:00Z',
    duration_seconds: 600,
    max_elevation_deg: 35,
    estimated_data_capacity_mb: 15000,
    is_eligible: true,
    eligibility_status: 'eligible',
  },
]

const plan = {
  current_plan: {
    L1: { link: links[0], is_scheduled: true, override_state: 'auto', tradeoff_id: 'TOG-0001', score: 81.25, useful_data_offloaded_mb: 500 },
    L2: { link: links[1], is_scheduled: false, override_state: 'auto', tradeoff_id: 'TOG-0001', score: 42.5, useful_data_offloaded_mb: 0, rejection_reason: 'Lost trade-off' },
  },
  trade_off_groups: {
    'TOG-0001': {
      tradeoff_id: 'TOG-0001',
      start_time: '2026-08-22T10:00:00Z',
      end_time: '2026-08-22T10:11:00Z',
      link_ids: ['L1', 'L2'],
      participating_satellites: ['Sat-1', 'Sat-2'],
      participating_groundstations: ['GS-1'],
      is_trivial: false,
    },
  },
  conflict_reasons: { 'L1:L2': 'Ground station contention' },
  satellite_buffer_profiles: {
    'Sat-1': {
      satellite_name: 'Sat-1',
      capacity_mb: 50000,
      peak_level_mb: 25000,
      final_level_mb: 12000,
      total_generated_mb: 30000,
      total_downlinked_mb: 500,
      total_lost_mb: 0,
    },
  },
}

describe('scheduling view-model adapters', () => {
  it('keeps backend IDs and eligibility authoritative', () => {
    const rows = buildRowsFromFilteredLinks(links)
    expect(rows[0]).toMatchObject({ backendLinkId: 'L1', overpassId: 'OP1', availabilityStatus: 'available' })
  })

  it('applies the session plan and derives cards without recalculating conflicts', () => {
    const rows = applySessionPlanToRows(buildRowsFromFilteredLinks(links), plan)
    const cards = buildTradeOffCardsFromPlan(plan, rows)

    expect(getScheduledRows(rows).map((row) => row.backendLinkId)).toEqual(['L1'])
    expect(cards[0].reason).toBe('Ground station contention')
    expect(cards[0].options[0]).toMatchObject({ linkId: 'L1', recommended: true, score: 81.25 })
    expect(rows[1]).toMatchObject({ score: 42.5, rejectionReason: 'Lost trade-off' })
    expect(buildSelectedOptionsFromPlan(plan)).toEqual({ 'TOG-0001': 'L1' })
  })

  it('builds commit summary with asset grouping and buffer profile metrics', () => {
    const rows = applySessionPlanToRows(buildRowsFromFilteredLinks(links), plan)
    const scheduledRows = getScheduledRows(rows)
    const summary = buildCommitSummary(scheduledRows, plan)

    expect(summary.totalScheduledLinks).toBe(1)
    expect(summary.totalOffloadedMb).toBe(500)
    expect(summary.totalOffloadedGb).toBe('0.50')
    expect(summary.totalDurationSeconds).toBe(600)
    expect(summary.totalDurationMinutes).toBe(10)

    expect(summary.satellites).toHaveLength(1)
    expect(summary.satellites[0]).toMatchObject({
      satId: 'Sat-1',
      totalOffloadedMb: 500,
      capacityMb: 50000,
      peakBufferMb: 25000,
      finalBufferMb: 12000,
    })
    expect(summary.satellites[0].links).toHaveLength(1)

    expect(summary.groundStations).toHaveLength(1)
    expect(summary.groundStations[0]).toMatchObject({
      gsId: 'GS-1',
      totalOffloadedMb: 500,
      totalDurationSeconds: 600,
    })
  })
})

