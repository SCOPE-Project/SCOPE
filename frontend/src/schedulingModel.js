const toTimestamp = (value) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const parseOverpassSequence = (overpassId) => {
  const match = String(overpassId ?? '').match(/(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY
}

const parseLinkSequence = (linkId) => {
  const match = String(linkId ?? '').match(/(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY
}

const eligibilityToAvailability = (link) => {
  if (link?.is_eligible) {
    return 'available'
  }

  if (link?.eligibility_status === 'blocked_by_baseline') {
    return 'blocked'
  }

  if (link?.eligibility_status === 'excluded_by_peak_elev') {
    return 'filtered'
  }

  return 'unavailable'
}

export const buildRowsFromFilteredLinks = (links = []) => [...links]
  .sort((left, right) => {
    const sequenceDelta = parseOverpassSequence(left.overpass_id) - parseOverpassSequence(right.overpass_id)
    if (sequenceDelta !== 0) {
      return sequenceDelta
    }

    return String(left.overpass_id ?? '').localeCompare(String(right.overpass_id ?? ''))
  })
  .map((link) => ({
    overpassId: link.overpass_id,
    backendOverpassId: link.overpass_id,
    linkId: link.link_id,
    backendLinkId: link.link_id,
    satId: link.satellite_name,
    gsId: link.groundstation_name,
    durationSeconds: link.duration_seconds,
    startTime: link.start_time,
    endTime: link.end_time,
    maxElevationDeg: link.max_elevation_deg,
    estimatedDataCapacityMb: link.estimated_data_capacity_mb,
    isEligible: Boolean(link.is_eligible),
    eligibilityStatus: link.eligibility_status,
    availabilityStatus: eligibilityToAvailability(link),
    rejectionReason: link.ineligibility_reason ?? null,
    conflictingActivityUuid: link.conflicting_activity_uuid ?? null,
    scheduleBlocked: link.eligibility_status === 'blocked_by_baseline',
    isScheduled: false,
    overrideState: 'auto',
    score: 0,
    backendTradeOffId: null,
    tradeOffId: '—',
    usefulDataOffloadedMb: 0,
  }))

export const applySessionPlanToRows = (rows, sessionPlan) => {
  const currentPlan = sessionPlan?.current_plan ?? {}

  return rows.map((row) => {
    const status = currentPlan[row.backendLinkId]
    if (!status) {
      return row
    }

    const link = status.link ?? {}
    const eligibilityStatus = link.eligibility_status ?? row.eligibilityStatus
    const isEligible = link.is_eligible ?? row.isEligible
    const nextRejectionReason = status.rejection_reason ?? link.ineligibility_reason ?? null

    return {
      ...row,
      overpassId: link.overpass_id ?? row.overpassId,
      backendOverpassId: link.overpass_id ?? row.backendOverpassId,
      satId: link.satellite_name ?? row.satId,
      gsId: link.groundstation_name ?? row.gsId,
      startTime: link.start_time ?? row.startTime,
      endTime: link.end_time ?? row.endTime,
      durationSeconds: link.duration_seconds ?? row.durationSeconds,
      maxElevationDeg: link.max_elevation_deg ?? row.maxElevationDeg,
      estimatedDataCapacityMb: link.estimated_data_capacity_mb ?? row.estimatedDataCapacityMb,
      isEligible,
      eligibilityStatus,
      availabilityStatus: eligibilityToAvailability({
        is_eligible: isEligible,
        eligibility_status: eligibilityStatus,
      }),
      scheduleBlocked: eligibilityStatus === 'blocked_by_baseline',
      isScheduled: Boolean(status.is_scheduled),
      overrideState: status.override_state ?? 'auto',
      score: status.score ?? 0,
      backendTradeOffId: status.tradeoff_id ?? null,
      tradeOffId: status.tradeoff_id ?? '—',
      usefulDataOffloadedMb: status.useful_data_offloaded_mb ?? 0,
      rejectionReason: isEligible && Boolean(status.is_scheduled) ? null : nextRejectionReason,
      conflictingActivityUuid: link.conflicting_activity_uuid ?? row.conflictingActivityUuid,
    }
  })
}

const getConflictReason = (group, conflictReasons) => {
  const reasons = new Set()

  group.link_ids.forEach((leftId) => {
    group.link_ids.forEach((rightId) => {
      if (leftId !== rightId) {
        const reason = conflictReasons[`${leftId}:${rightId}`]
        if (reason) {
          reasons.add(reason)
        }
      }
    })
  })

  return [...reasons].join('; ') || 'The backend identified mutually exclusive communication links.'
}

export const buildTradeOffCardsFromPlan = (sessionPlan, rows) => {
  const rowByLinkId = new Map(rows.map((row) => [row.backendLinkId, row]))
  const currentPlan = sessionPlan?.current_plan ?? {}
  const conflictReasons = sessionPlan?.conflict_reasons ?? {}

  return Object.values(sessionPlan?.trade_off_groups ?? {})
    .filter((group) => !group.is_trivial)
    .sort((left, right) => toTimestamp(left.start_time) - toTimestamp(right.start_time))
    .map((group, colorIndex) => ({
      id: group.tradeoff_id,
      title: group.tradeoff_id,
      resourceLabel: [
        ...(group.participating_satellites ?? []),
        ...(group.participating_groundstations ?? []),
      ].join(' · '),
      reason: getConflictReason(group, conflictReasons),
      colorIndex,
      options: [...group.link_ids]
        .sort((left, right) => {
          const sequenceDelta = parseLinkSequence(left) - parseLinkSequence(right)
          if (sequenceDelta !== 0) {
            return sequenceDelta
          }

          return String(left ?? '').localeCompare(String(right ?? ''))
        })
        .map((linkId) => {
        const row = rowByLinkId.get(linkId)
        const status = currentPlan[linkId]

        return {
          tradeOffGroupId: group.tradeoff_id,
          optionId: linkId,
          linkId,
          overpassId: row?.overpassId ?? status?.link?.overpass_id ?? linkId,
          satId: row?.satId ?? status?.link?.satellite_name,
          gsId: row?.gsId ?? status?.link?.groundstation_name,
          durationSeconds: row?.durationSeconds ?? status?.link?.duration_seconds,
          startTime: row?.startTime ?? status?.link?.start_time,
          endTime: row?.endTime ?? status?.link?.end_time,
          maxElevationDeg: row?.maxElevationDeg ?? status?.link?.max_elevation_deg,
          estimatedDataCapacityMb: row?.estimatedDataCapacityMb ?? status?.link?.estimated_data_capacity_mb ?? 0,
          usefulDataOffloadedMb: status?.useful_data_offloaded_mb ?? 0,
          isScheduled: Boolean(status?.is_scheduled),
          overrideState: status?.override_state ?? 'auto',
          score: status?.score ?? 0,
          rejectionReason: status?.rejection_reason ?? null,
          recommended: Boolean(status?.is_scheduled) && status?.override_state === 'auto',
          colorIndex,
        }
      }),
    }))
}

export const buildSelectedOptionsFromPlan = (sessionPlan) => Object.fromEntries(
  Object.values(sessionPlan?.trade_off_groups ?? {})
    .map((group) => {
      const selectedId = group.link_ids.find(
        (linkId) => sessionPlan?.current_plan?.[linkId]?.is_scheduled,
      )
      return selectedId ? [group.tradeoff_id, selectedId] : null
    })
    .filter(Boolean),
)

export const getScheduledRows = (rows) => rows.filter((row) => row.isScheduled)
