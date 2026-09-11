// Asset classification, operator-facing warnings, and the small vocabulary
// the override controls speak.
//
// The backend sends `classification` in more than one spelling and marks some
// assets ineligible with a separate flag; normalizing that in one place keeps
// the three asset lists on the landing page from disagreeing.

export const normalizeAssetClassification = (asset) => {
  if (asset.classification === 'satellite') {
    return 'satellite'
  }

  if (asset.classification === 'groundstation' || asset.classification === 'ground_station') {
    return 'ground_station'
  }

  if (asset.classification === 'ineligible' || asset.eligible === false) {
    return 'ineligible'
  }

  return asset.classification ?? 'unknown'
}

export const getAssetWarningMessage = (asset) => (
  asset?.error
  ?? asset?.reason
  ?? asset?.message
  ?? asset?.rejectionReason
  ?? asset?.ineligibility_reason
  ?? null
)

export const parseOptionalDegreeInput = (value) => {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export const getScheduleToggleState = (isScheduled) => (isScheduled ? 'excluded' : 'pinned')

export const getScheduleToggleTitle = (isScheduled) => (isScheduled
  ? 'Scheduled: click to force this link to stay unscheduled.'
  : 'Unscheduled: click to force this link to stay scheduled.')

export const getOverviewControlTooltip = (state) => {
  if (state === 'auto') {
    return 'Auto: keep the backend scheduling decision.'
  }

  if (state === 'pinned') {
    return 'Pinned: force this link to stay scheduled.'
  }

  return 'Excluded: force this link to stay unscheduled.'
}
