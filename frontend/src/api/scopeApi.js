export const BACKEND_BASE_URL = (
  import.meta.env.VITE_BACKEND_BASE_URL?.replace(/\/$/, '')
  ?? 'http://localhost:8000'
)

const readErrorMessage = async (response) => {
  const fallback = `Backend request failed with status ${response.status}`

  try {
    const body = await response.json()
    return body?.detail ?? body?.message ?? fallback
  } catch {
    return fallback
  }
}

export const requestJson = async (path, options = {}) => {
  const {
    timeoutMs = 15000,
    signal: externalSignal,
    ...fetchOptions
  } = options

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  const abortExternal = () => controller.abort()

  if (externalSignal?.aborted) {
    window.clearTimeout(timeoutId)
    throw makeAbortError()
  }

  externalSignal?.addEventListener('abort', abortExternal, { once: true })

  let response

  try {
    response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(fetchOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...fetchOptions.headers,
      },
    })
  } catch (error) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw makeAbortError()
      }

      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    if (response.status === 404 && path.startsWith('/schedule/session/')) {
      throw new Error(`${message} The scheduling session is stale; calculate trade-offs again.`)
    }
    if (response.status === 404 && path.startsWith('/tasks/status/')) {
      throw new Error(`${message} The backend task is stale; rerun the affected pipeline stage.`)
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

const makeAbortError = () => {
  const error = new Error('Stopped waiting for the backend task.')
  error.name = 'AbortError'
  return error
}

const waitForNextPoll = (durationMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(makeAbortError())
    return
  }

  const timeoutId = window.setTimeout(resolve, durationMs)
  signal?.addEventListener('abort', () => {
    window.clearTimeout(timeoutId)
    reject(makeAbortError())
  }, { once: true })
})

export const pollTaskResult = async (
  taskId,
  {
    onStatusUpdate,
    signal,
    pollIntervalMs = 1200,
    requestTimeoutMs = 5000,
    maxWaitMs = 90000,
  } = {},
) => {
  const startedAt = Date.now()

  while (true) {
    if (signal?.aborted) {
      throw makeAbortError()
    }

    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error(`Backend task timed out after ${Math.round(maxWaitMs / 1000)} seconds.`)
    }

    const taskStatus = await requestJson(`/tasks/status/${encodeURIComponent(taskId)}`, {
      signal,
      timeoutMs: requestTimeoutMs,
    })
    onStatusUpdate?.(taskStatus)

    if (taskStatus.status === 'completed') {
      return requestJson(`/tasks/status/${encodeURIComponent(taskId)}/result`, {
        signal,
        timeoutMs: requestTimeoutMs,
      })
    }

    if (taskStatus.status === 'failed') {
      throw new Error(taskStatus.message || 'Backend task failed.')
    }

    await waitForNextPoll(pollIntervalMs, signal)
  }
}

const postJson = (path, payload, signal) => requestJson(path, {
  method: 'POST',
  body: JSON.stringify(payload),
  signal,
  timeoutMs: 15000,
})

export const initializeAssets = () => requestJson('/tasks/initialize', { timeoutMs: 15000 })

export const startOrbitExtraction = (payload, signal) => (
  postJson('/tasks/extract-overpasses', payload, signal)
)

export const startLinkFiltering = (payload, signal) => (
  postJson('/tasks/filter-links', payload, signal)
)

export const startTradeOffProcessing = (payload, signal) => (
  postJson('/tasks/process-trade-offs', payload, signal)
)

export const applySessionOverride = (sessionId, payload, signal) => (
  postJson(`/schedule/session/${encodeURIComponent(sessionId)}/override`, payload, signal)
)

export const updateSessionStrategy = (sessionId, payload, signal) => (
  postJson(`/schedule/session/${encodeURIComponent(sessionId)}/strategy`, payload, signal)
)

export const commitSession = (sessionId, signal) => (
  requestJson(`/schedule/session/${encodeURIComponent(sessionId)}/commit`, {
    method: 'POST',
    signal,
  })
)
