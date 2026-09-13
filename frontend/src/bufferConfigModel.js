// Buffer configuration = one fleet default plus sparse per-satellite overrides.
// Values are kept as the strings the operator typed (GB for volumes, MB/s for
// rates); a blank override field means "inherit the default". Conversion to the
// backend's MB units happens only when a request payload is built.

export const BUFFER_FIELDS = [
  { key: 'capacityGb', label: 'Capacity', unit: 'GB', min: '0.001', step: '10', apiKey: 'capacity_mb', mbFactor: 1000 },
  { key: 'startFillGb', label: 'Initial Fill', unit: 'GB', min: '0', step: '10', apiKey: 'initial_level_mb', mbFactor: 1000 },
  { key: 'generationMbps', label: 'Payload Generation', unit: 'MB/s', min: '0', step: '1', apiKey: 'payload_generation_rate_mbps', mbFactor: 1 },
  { key: 'downlinkRateMbps', label: 'Downlink Rate', unit: 'MB/s', min: '0.001', step: '0.1', apiKey: 'downlink_rate_mbps', mbFactor: 1 },
]

const isBlank = (value) => value === undefined || value === null || String(value).trim() === ''

const toNumber = (value) => (isBlank(value) ? Number.NaN : Number(value))

export const getOverriddenFieldKeys = (overrides, satelliteName) => {
  const override = overrides?.[satelliteName] ?? {}
  return BUFFER_FIELDS
    .map((field) => field.key)
    .filter((key) => !isBlank(override[key]))
}

export const hasBufferOverride = (overrides, satelliteName) => (
  getOverriddenFieldKeys(overrides, satelliteName).length > 0
)

// Effective numeric configuration of one satellite (or of the default when no
// override is given).
export const resolveBufferConfig = (defaults, override = {}) => Object.fromEntries(
  BUFFER_FIELDS.map(({ key }) => [
    key,
    toNumber(isBlank(override?.[key]) ? defaults?.[key] : override[key]),
  ]),
)

// Returns a human-readable problem with a resolved configuration, or null.
export const validateBufferConfig = (config) => {
  const { capacityGb, startFillGb, generationMbps, downlinkRateMbps } = config
  if (!Number.isFinite(capacityGb) || capacityGb <= 0) {
    return 'capacity must be positive'
  }
  if (!Number.isFinite(startFillGb) || startFillGb < 0) {
    return 'initial fill must be zero or greater'
  }
  if (startFillGb > capacityGb) {
    return 'initial fill cannot exceed capacity'
  }
  if (!Number.isFinite(generationMbps) || generationMbps < 0) {
    return 'payload generation must be zero or greater'
  }
  if (!Number.isFinite(downlinkRateMbps) || downlinkRateMbps <= 0) {
    return 'downlink rate must be positive'
  }
  return null
}

// Validates the default and the effective configuration of every listed
// satellite. An override is judged after merging, so a lower capacity override
// is flagged when the inherited initial fill no longer fits.
export const validateBufferSetup = (defaults, overrides, satelliteNames = []) => {
  const defaultError = validateBufferConfig(resolveBufferConfig(defaults))
  const satelliteErrors = {}
  satelliteNames.forEach((satelliteName) => {
    if (!hasBufferOverride(overrides, satelliteName)) {
      return
    }
    const error = validateBufferConfig(resolveBufferConfig(defaults, overrides[satelliteName]))
    if (error) {
      satelliteErrors[satelliteName] = error
    }
  })

  return {
    valid: !defaultError && Object.keys(satelliteErrors).length === 0,
    defaultError,
    satelliteErrors,
  }
}

export const setBufferOverrideField = (overrides, satelliteName, fieldKey, value) => {
  const nextOverride = { ...(overrides?.[satelliteName] ?? {}) }
  if (isBlank(value)) {
    delete nextOverride[fieldKey]
  } else {
    nextOverride[fieldKey] = value
  }

  const next = { ...(overrides ?? {}) }
  if (Object.keys(nextOverride).length === 0) {
    delete next[satelliteName]
  } else {
    next[satelliteName] = nextOverride
  }
  return next
}

export const clearBufferOverride = (overrides, satelliteName) => {
  const next = { ...(overrides ?? {}) }
  delete next[satelliteName]
  return next
}

const toMb = (field, value) => Number(value) * field.mbFactor

// Request body shared by POST /tasks/process-trade-offs and
// POST /schedule/session/{id}/buffer-configs. Only satellites in
// `satelliteNames` are sent (the backend rejects overrides for satellites
// without candidate links) and only the fields that differ from the default.
export const buildBufferConfigPayload = (defaults, overrides, satelliteNames = []) => {
  const resolvedDefault = resolveBufferConfig(defaults)
  const satelliteBufferConfigs = {}

  ;[...new Set(satelliteNames)].sort().forEach((satelliteName) => {
    const override = overrides?.[satelliteName] ?? {}
    const fields = BUFFER_FIELDS.filter((field) => !isBlank(override[field.key]))
    if (fields.length > 0) {
      satelliteBufferConfigs[satelliteName] = Object.fromEntries(
        fields.map((field) => [field.apiKey, toMb(field, override[field.key])]),
      )
    }
  })

  return {
    default_buffer_config: Object.fromEntries(
      BUFFER_FIELDS.map((field) => [field.apiKey, toMb(field, resolvedDefault[field.key])]),
    ),
    satellite_buffer_configs: satelliteBufferConfigs,
  }
}

// Per-satellite downlink rates for POST /tasks/filter-links, so link pass
// capacities are derived with each satellite's own rate.
export const buildSatelliteDownlinkRates = (overrides, satelliteNames = []) => Object.fromEntries(
  [...new Set(satelliteNames)]
    .sort()
    .filter((satelliteName) => !isBlank(overrides?.[satelliteName]?.downlinkRateMbps))
    .map((satelliteName) => [satelliteName, Number(overrides[satelliteName].downlinkRateMbps)]),
)
