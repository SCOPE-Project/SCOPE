// The timeline's row model: what the operator sees as tracks, groups and bars.
//
// Pure. Everything it used to read from App state (asset selection, per-asset
// visibility toggles, layer toggles, and whether trade-offs have been scored)
// arrives as the options argument instead.

import { DEFAULT_PLANNING_TIME_MODE } from '../config/constants.js'
import {
  filterVisibleTimelineActivities,
  filterVisibleTimelineLinks,
} from './schedulingModel.js'
import {
  buildDayBands,
  formatTimelineHour,
  getOverviewRowStatus,
  layoutTimelineItems,
  toTimestamp,
} from './format.js'

// Timeline rows are asset-centric: one collapsible group per satellite and
// per ground station, a header row per group that aggregates what is
// actually scheduled for that asset, and one sub-row per counterpart it
// actually has overpasses with. Every link therefore appears TWICE (once
// under its satellite, once under its ground station); both instances share
// a `linkId` so marking one marks the other.
export const buildTimelineModel = (
  rows,
  groups,
  currentScheduleItems,
  planningWindow,
  {
    selectedSatellites = [],
    selectedGroundStations = [],
    timelineAssetVisibility = {},
    timelineLayers = {},
    tradeOffsCalculated = false,
  } = {},
) => {
  const timeMode = planningWindow?.timeMode ?? DEFAULT_PLANNING_TIME_MODE
  const optionByOverpassId = new Map(
    groups
      .flatMap((group) => group.options)
      .map((option) => [option.overpassId, option]),
  )

  // One bar per overpass instead of one bar per layer. With per-counterpart
  // rows a "potential" and a "proposed" copy of the same overpass would land
  // on the exact same pixels of the exact same row, so the layer toggles now
  // filter which KIND of bar is drawn rather than which track exists.
  const linkSourceItems = rows
    .map((row) => {
      const startTimestamp = toTimestamp(row.startTime)
      const endTimestamp = toTimestamp(row.endTime)

      if (
        startTimestamp === null
        || endTimestamp === null
        || endTimestamp <= startTimestamp
      ) {
        return null
      }

      const linkedOption = optionByOverpassId.get(row.overpassId)
      const hasTradeOff = Boolean(row.tradeOffId && row.tradeOffId !== '—')
      const dimmed = tradeOffsCalculated && hasTradeOff && !row.isScheduled
      const ineligible = getOverviewRowStatus(row) === 'ineligible'

      let variant = 'neutral'
      if (row.scheduleBlocked) {
        variant = 'blocked'
      } else if (row.overrideState === 'excluded') {
        variant = 'excluded'
      } else if (row.overrideState === 'pinned') {
        variant = 'pinned'
      } else if (row.isScheduled) {
        variant = 'selected'
      } else if (hasTradeOff) {
        variant = 'candidate'
      } else if (tradeOffsCalculated) {
        variant = 'neutral'
      }

      const resolvedLinkId = (row.backendLinkId && String(row.backendLinkId).trim().length > 0)
        ? row.backendLinkId
        : (row.linkId && String(row.linkId).trim().length > 0)
          ? row.linkId
          : row.overpassId

      return {
        kind: 'link',
        linkId: resolvedLinkId,
        overpassId: row.overpassId,
        satId: row.satId,
        gsId: row.gsId,
        durationSeconds: row.durationSeconds,
        label: resolvedLinkId,
        detail: hasTradeOff
          ? `${row.satId} → ${row.gsId} · ${row.tradeOffId}`
          : `${row.satId} → ${row.gsId}`,
        startTime: row.startTime,
        endTime: row.endTime,
        startTimestamp,
        endTimestamp,
        variant,
        dimmed,
        ineligible,
        blocked: Boolean(row.scheduleBlocked),
        blockMessage: row.scheduleBlocked
          ? row.rejectionReason
          : null,
        tradeOffId: hasTradeOff ? row.tradeOffId : null,
        tradeOffGroupId: linkedOption?.tradeOffGroupId ?? (hasTradeOff ? row.tradeOffId : null),
        tradeOffColorIndex: row.tradeOffColorIndex ?? null,
        optionId: linkedOption?.optionId ?? null,
        isSchedulable: getOverviewRowStatus(row) === 'eligible',
        isScheduled: Boolean(row.isScheduled),
        recommended: row.isScheduled && row.overrideState === 'auto',
        overrideState: row.overrideState,
        usefulDataOffloadedMb: row.usefulDataOffloadedMb,
        score: row.score,
        rejectionReason: row.rejectionReason,
      }
    })
    .filter(Boolean)

  const blockedRows = rows.filter((row) => row.scheduleBlocked)
  const currentSourceItems = currentScheduleItems
    .map((item) => {
      const startTimestamp = toTimestamp(item.startTime)
      const endTimestamp = toTimestamp(item.endTime)

      if (
        startTimestamp === null
        || endTimestamp === null
        || endTimestamp <= startTimestamp
      ) {
        return null
      }

      // A SatOS activity that pushes an overpass out of the plan is drawn in
      // the asset's header row as a blocking bar -- that is the red bar in
      // the agreed layout sketch.
      const blocking = blockedRows.some(
        (row) => row.conflictingActivityUuid && row.conflictingActivityUuid === item.activityUuid,
      )

      return {
        kind: 'activity',
        id: item.id,
        linkId: null,
        assetName: item.detail,
        label: item.label,
        detail: item.detail,
        durationSeconds: null,
        startTime: item.startTime,
        endTime: item.endTime,
        startTimestamp,
        endTimestamp,
        layer: 'current',
        variant: blocking ? 'blocking' : 'current',
        dimmed: false,
        blocked: false,
        blockMessage: null,
        tradeOffId: null,
        tradeOffScore: null,
        tradeOffColorIndex: null,
        optionId: null,
        recommended: false,
      }
    })
    .filter(Boolean)

  const planningStartTimestamp = toTimestamp(planningWindow?.startTime)
  const planningEndTimestamp = toTimestamp(planningWindow?.endTime)

  const clampTimelineItemToWindow = (item) => {
    const clampedStartTimestamp = planningStartTimestamp !== null
      ? Math.max(item.startTimestamp, planningStartTimestamp)
      : item.startTimestamp
    const clampedEndTimestamp = planningEndTimestamp !== null
      ? Math.min(item.endTimestamp, planningEndTimestamp)
      : item.endTimestamp

    if (clampedEndTimestamp <= clampedStartTimestamp) {
      return null
    }

    return {
      ...item,
      startTimestamp: clampedStartTimestamp,
      endTimestamp: clampedEndTimestamp,
      startTime: new Date(clampedStartTimestamp).toISOString(),
      endTime: new Date(clampedEndTimestamp).toISOString(),
    }
  }

  const clampedLinkItems = linkSourceItems
    .map(clampTimelineItemToWindow)
    .filter(Boolean)
  const clampedCurrentItems = currentSourceItems
    .map(clampTimelineItemToWindow)
    .filter(Boolean)
  const allTimestampItems = [...clampedCurrentItems, ...clampedLinkItems]

  if (
    allTimestampItems.length === 0
    && (planningStartTimestamp === null || planningEndTimestamp === null)
  ) {
    return null
  }

  const minTimestamp = allTimestampItems.length > 0
    ? Math.min(...allTimestampItems.map((item) => item.startTimestamp))
    : planningStartTimestamp
  const maxTimestamp = allTimestampItems.length > 0
    ? Math.max(...allTimestampItems.map((item) => item.endTimestamp))
    : planningEndTimestamp
  const baseTimestamp = planningStartTimestamp ?? (minTimestamp - 30 * 60000)
  const endTimestamp = planningEndTimestamp ?? (maxTimestamp + 30 * 60000)
  // When an explicit planning window is active, use its exact (possibly
  // fractional) duration in minutes instead of flooring/padding it. The
  // playhead slider above the timeline positions itself as a fraction of
  // planningWindowStartTimestamp/EndTimestamp directly, while the marker
  // line drawn inside the scrollable canvas positions itself as a
  // fraction of this totalMinutes value -- if totalMinutes were rounded
  // up (Math.ceil) or padded out to a 60-minute floor, the two would be
  // computing their percentage against slightly different spans and the
  // timestamp label and its line would visibly drift apart, worse the
  // shorter the actual planning window is. Only fall back to the
  // floor/rounding when there's no explicit window to derive exact
  // bounds from (the timeline is instead sized to whatever schedule data
  // happens to exist, padded with a 30-minute margin).
  const totalMinutes = (planningStartTimestamp !== null && planningEndTimestamp !== null)
    ? Math.max(1, (endTimestamp - baseTimestamp) / 60000)
    : Math.max(60, Math.ceil((endTimestamp - baseTimestamp) / 60000))
  const baseDate = new Date(baseTimestamp)

  const mapToTimelineItem = (item) => ({
    ...item,
    startMinutes: (item.startTimestamp - baseTimestamp) / 60000,
    durationMinutes: Math.max(1 / 60, (item.endTimestamp - item.startTimestamp) / 60000),
  })

  const visibleActivityItems = filterVisibleTimelineActivities(clampedCurrentItems, timelineLayers)
  const visibleLinkItems = filterVisibleTimelineLinks(clampedLinkItems, timelineLayers)

  const satelliteNames = [...new Set([
    ...rows.map((row) => row.satId),
    ...clampedCurrentItems
      .filter((item) => selectedSatellites.includes(item.assetName))
      .map((item) => item.assetName),
  ].filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))

  const groundStationNames = [...new Set([
    ...rows.map((row) => row.gsId),
    ...clampedCurrentItems
      .filter((item) => selectedGroundStations.includes(item.assetName))
      .map((item) => item.assetName),
  ].filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))

  const buildAssetGroup = (kind, assetName) => {
    const ownLinkItems = visibleLinkItems.filter(
      (item) => (kind === 'satellite' ? item.satId : item.gsId) === assetName,
    )
    const counterpartOf = (item) => (kind === 'satellite' ? item.gsId : item.satId)

    // Q15: a sub-row exists only for counterparts with at least one overpass
    // in the planning window -- a full cross product of every selected
    // satellite against every selected ground station would be mostly blank.
    const counterpartNames = [...new Set(ownLinkItems.map(counterpartOf).filter(Boolean))]
      .sort((left, right) => String(left).localeCompare(String(right)))

    const headerSource = [
      ...visibleActivityItems.filter((item) => item.assetName === assetName),
      // The header aggregates what is actually scheduled for this
      // asset, so a collapsed group still tells the truth.
      ...ownLinkItems.filter((item) => item.isScheduled),
    ]
    const headerLayout = layoutTimelineItems(headerSource.map(mapToTimelineItem))

    const assetRows = counterpartNames.map((counterpartName) => {
      const rowItems = ownLinkItems.filter((item) => counterpartOf(item) === counterpartName)
      const layout = layoutTimelineItems(rowItems.map(mapToTimelineItem))

      return {
        id: `${kind}:${assetName}|${counterpartName}`,
        counterpartName,
        label: `${assetName} – ${counterpartName}`,
        laneCount: layout.laneCount,
        items: layout.items.map((item) => ({
          ...item,
          id: `${kind}:${assetName}|${counterpartName}|${item.overpassId || item.linkId}`,
        })),
        containsSelected: rowItems.some((item) => item.variant === 'selected'),
      }
    })

    return {
      id: `${kind}:${assetName}`,
      kind,
      name: assetName,
      label: assetName,
      laneCount: headerLayout.laneCount,
      items: headerLayout.items.map((item) => ({
        ...item,
        id: `${kind}:${assetName}|header|${item.overpassId || item.linkId || item.id}`,
      })),
      rows: assetRows,
      linkCount: assetRows.length,
    }
  }

  const satelliteGroups = satelliteNames.map((name) => buildAssetGroup('satellite', name))
  const groundStationGroups = groundStationNames.map((name) => buildAssetGroup('ground_station', name))

  const firstTickDate = new Date(baseDate.getTime())
  if (timeMode === 'utc') {
    firstTickDate.setUTCMinutes(0, 0, 0)
    if (firstTickDate.getTime() < baseDate.getTime()) {
      firstTickDate.setUTCHours(firstTickDate.getUTCHours() + 1)
    }
  } else {
    firstTickDate.setMinutes(0, 0, 0)
    if (firstTickDate.getTime() < baseDate.getTime()) {
      firstTickDate.setHours(firstTickDate.getHours() + 1)
    }
  }

  const ticks = []
  for (
    let tickDate = new Date(firstTickDate.getTime());
    tickDate.getTime() <= baseDate.getTime() + totalMinutes * 60000;
    tickDate = new Date(tickDate.getTime() + 60 * 60000)
  ) {
    const offsetMinutes = (tickDate.getTime() - baseDate.getTime()) / 60000
    if (offsetMinutes >= 0 && offsetMinutes <= totalMinutes) {
      ticks.push({
        offsetMinutes,
        date: tickDate,
        label: formatTimelineHour(tickDate, timeMode),
      })
    }
  }

  return {
    baseDate,
    endDate: new Date(baseDate.getTime() + totalMinutes * 60000),
    totalMinutes,
    widthPx: Math.max(980, totalMinutes * 2.2),
    ticks,
    dayBands: buildDayBands(baseDate, totalMinutes, timeMode),
    sections: [
      timelineAssetVisibility.satellites
        ? { id: 'satellites', label: 'Satellites', groups: satelliteGroups }
        : null,
      timelineAssetVisibility.groundStations
        ? { id: 'groundStations', label: 'Ground Stations', groups: groundStationGroups }
        : null,
    ].filter(Boolean),
    hasVisibleItems: visibleLinkItems.length > 0 || visibleActivityItems.length > 0,
  }
}
