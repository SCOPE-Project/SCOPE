const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? 'http://localhost:8000'
const EXPECTED_BACKEND_PATHS = [
  '/status',
  '/satos/asset/list',
  '/tasks/initialize',
  '/tasks/extract-overpasses',
  '/tasks/process-trade-offs',
  '/tasks/status/{task_id}',
  '/tasks/status/{task_id}/result',
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
    const extractOverpassesProperties = extractSchemaProperties(openApiDocument, extractOverpassesSchema)
    ;['satellites', 'groundstations', 'start_time', 'end_time'].forEach((propertyName) => {
      if (extractOverpassesProperties.length > 0 && !extractOverpassesProperties.includes(propertyName)) {
        issues.push(`Orbit engine payload is missing "${propertyName}".`)
      }
    })

    const tradeOffSchema = openApiDocument.paths?.['/tasks/process-trade-offs']?.post?.requestBody?.content?.['application/json']?.schema
    const tradeOffProperties = extractSchemaProperties(openApiDocument, tradeOffSchema)
    if (tradeOffProperties.length > 0 && !tradeOffProperties.includes('satellites')) {
      issues.push('Trade-off payload is missing "satellites".')
    }
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
