const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? 'http://localhost:8000'
const EXPECTED_BACKEND_PATHS = [
  '/status',
  '/satos/asset/list',
  '/tasks/initialize',
  '/tasks/extract-overpasses',
  '/tasks/filter-links',
  '/tasks/process-trade-offs',
  '/tasks/status/{task_id}',
  '/tasks/status/{task_id}/result',
  '/schedule/session/{session_id}',
  '/schedule/session/{session_id}/override',
  '/schedule/session/{session_id}/strategy',
  '/schedule/session/{session_id}/commit',
]

const resolveSchemaFromRef = (openApiDocument, schemaRef) => {
  if (!schemaRef?.startsWith('#/components/schemas/')) {
    return null
  }

  const schemaName = schemaRef.replace('#/components/schemas/', '')
  return openApiDocument?.components?.schemas?.[schemaName] ?? null
}

const extractSchemaProperties = (openApiDocument, schema) => {
  if (!schema) {
    return []
  }

  if (schema.$ref) {
    return extractSchemaProperties(openApiDocument, resolveSchemaFromRef(openApiDocument, schema.$ref))
  }

  return Object.keys(schema.properties ?? {})
}

const checkSchemaProperties = (issues, openApiDocument, schema, expectedProperties, label) => {
  const properties = extractSchemaProperties(openApiDocument, schema)
  expectedProperties.forEach((propertyName) => {
    if (properties.length > 0 && !properties.includes(propertyName)) {
      issues.push(`${label} is missing "${propertyName}".`)
    }
  })
}

const run = async () => {
  const issues = []
  const notes = []
  let routeSummary = []
  let assetSummary = null

  const statusResponse = await fetch(`${BACKEND_BASE_URL}/status`).catch((error) => {
    throw new Error(`Backend unavailable at ${BACKEND_BASE_URL}: ${error.message}`)
  })

  if (!statusResponse.ok) {
    throw new Error(`Backend status endpoint returned ${statusResponse.status}`)
  }

  const openApiResponse = await fetch(`${BACKEND_BASE_URL}/openapi.json`)
  if (!openApiResponse.ok) {
    issues.push(`OpenAPI document unavailable (${openApiResponse.status}).`)
  } else {
    const openApiDocument = await openApiResponse.json()
    const availablePaths = Object.keys(openApiDocument.paths ?? {})
    const componentSchemas = openApiDocument.components?.schemas ?? {}

    routeSummary = EXPECTED_BACKEND_PATHS.map((path) => ({
      path,
      present: availablePaths.includes(path),
    }))

    routeSummary
      .filter((entry) => !entry.present)
      .forEach((entry) => {
        issues.push(`Missing backend route: ${entry.path}`)
      })

    const extractOverpassesSchema = openApiDocument.paths?.['/tasks/extract-overpasses']?.post?.requestBody?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      extractOverpassesSchema,
      ['satellites', 'groundstations', 'start_time', 'end_time'],
      'Orbit engine payload',
    )

    const filterSchema = openApiDocument.paths?.['/tasks/filter-links']?.post?.requestBody?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      filterSchema,
      ['orbit_engine_run_id', 'min_aos_los_elevation_deg', 'min_peak_elevation_deg', 'default_downlink_rate_mbps'],
      'Filter-links payload',
    )

    const tradeOffSchema = openApiDocument.paths?.['/tasks/process-trade-offs']?.post?.requestBody?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      tradeOffSchema,
      ['filter_run_id', 'satellite_buffer_configs', 'default_buffer_config', 'scoring_config'],
      'Trade-off payload',
    )

    const overrideSchema = openApiDocument.paths?.['/schedule/session/{session_id}/override']?.post?.requestBody?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      overrideSchema,
      ['link_id', 'override_state'],
      'Session override payload',
    )

    const strategySchema = openApiDocument.paths?.['/schedule/session/{session_id}/strategy']?.post?.requestBody?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      strategySchema,
      ['name', 'parameters'],
      'Session strategy payload',
    )

    const sessionPlanSchema = openApiDocument.paths?.['/schedule/session/{session_id}']?.get?.responses?.['200']?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      sessionPlanSchema,
      ['session_id', 'filter_run_id', 'current_plan', 'trade_off_groups', 'conflict_reasons', 'satellite_buffer_profiles'],
      'Session plan response',
    )

    const commitSchema = openApiDocument.paths?.['/schedule/session/{session_id}/commit']?.post?.responses?.['200']?.content?.['application/json']?.schema
    checkSchemaProperties(
      issues,
      openApiDocument,
      commitSchema,
      ['session_id', 'committed_links_count', 'created_activities_count', 'status'],
      'Session commit response',
    )

    checkSchemaProperties(
      issues,
      openApiDocument,
      componentSchemas.TaskReceiptResponse,
      ['task_id', 'status'],
      'Task receipt response',
    )
    checkSchemaProperties(
      issues,
      openApiDocument,
      componentSchemas.FilterResultDTO,
      ['filter_run_id', 'orbit_engine_run_id', 'links'],
      'Filter result',
    )
    checkSchemaProperties(
      issues,
      openApiDocument,
      componentSchemas.LinkBlockDTO,
      [
        'link_id',
        'overpass_id',
        'satellite_name',
        'groundstation_name',
        'start_time',
        'end_time',
        'duration_seconds',
        'max_elevation_deg',
        'estimated_data_capacity_mb',
        'is_eligible',
        'eligibility_status',
        'ineligibility_reason',
        'conflicting_activity_uuid',
      ],
      'Filtered link',
    )
    checkSchemaProperties(
      issues,
      openApiDocument,
      componentSchemas.ScheduledLinkStatusDTO,
      ['link', 'is_scheduled', 'override_state', 'tradeoff_id', 'score', 'useful_data_offloaded_mb', 'rejection_reason'],
      'Scheduled link status',
    )
  }

  const initializeResponse = await fetch(`${BACKEND_BASE_URL}/tasks/initialize`)
  if (!initializeResponse.ok) {
    issues.push(`/tasks/initialize returned ${initializeResponse.status}.`)
  } else {
    const initializePayload = await initializeResponse.json()
    const initializedAssets = Array.isArray(initializePayload?.assets) ? initializePayload.assets : null

    if (!initializedAssets) {
      issues.push('/tasks/initialize payload does not contain an assets array.')
    } else {
      const classificationTokens = [...new Set(initializedAssets.map((asset) => asset.classification ?? '(missing)'))]
      const unknownClassifications = classificationTokens.filter(
        (classification) => !['satellite', 'groundstation', 'ground_station', 'ineligible', '(missing)'].includes(classification)
      )
      const eligibleFalseWithoutError = initializedAssets.filter(
        (asset) => asset.eligible === false && !asset.error
      )
      const missingCoreFields = initializedAssets.filter(
        (asset) => typeof asset.name !== 'string' || typeof asset.eligible !== 'boolean' || typeof asset.classification !== 'string'
      )

      if (classificationTokens.includes('groundstation')) {
        notes.push('Backend uses "groundstation". Frontend normalization covers this naming.')
      }

      if (unknownClassifications.length > 0) {
        issues.push(`Unknown asset classifications detected: ${unknownClassifications.join(', ')}`)
      }

      if (eligibleFalseWithoutError.length > 0) {
        issues.push(`${eligibleFalseWithoutError.length} ineligible assets are missing an error message.`)
      }

      if (missingCoreFields.length > 0) {
        issues.push(`${missingCoreFields.length} assets are missing required frontend fields (name, eligible, classification).`)
      }

      assetSummary = {
        total: initializedAssets.length,
        classifications: classificationTokens,
        ineligibleCount: initializedAssets.filter((asset) => asset.eligible === false).length,
      }
    }
  }

  console.log('[SCOPE backend compatibility]')
  console.log(`Backend base URL: ${BACKEND_BASE_URL}`)

  if (assetSummary) {
    console.log(`Assets: ${assetSummary.total}`)
    console.log(`Classifications: ${assetSummary.classifications.join(', ')}`)
    console.log(`Ineligible assets: ${assetSummary.ineligibleCount}`)
  }

  if (routeSummary.length > 0) {
    const missingRoutes = routeSummary.filter((entry) => !entry.present)
    console.log(`Checked routes: ${routeSummary.length}`)
    console.log(`Missing routes: ${missingRoutes.length}`)
  }

  if (notes.length > 0) {
    console.log(`Compatibility notes: ${notes.length}`)
    notes.forEach((note) => console.log(`- ${note}`))
  }

  if (issues.length === 0) {
    console.log('No compatibility issues detected.')
    return
  }

  console.log(`Detected ${issues.length} compatibility issue(s):`)
  issues.forEach((issue) => console.log(`- ${issue}`))
  process.exitCode = 1
}

run().catch((error) => {
  console.error(`[SCOPE backend compatibility] ${error.message}`)
  process.exitCode = 1
})
