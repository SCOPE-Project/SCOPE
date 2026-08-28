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
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })

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
  { onStatusUpdate, signal, pollIntervalMs = 1200 } = {},
) => {
  while (true) {
    if (signal?.aborted) {
      throw makeAbortError()
    }

    const taskStatus = await requestJson(`/tasks/status/${encodeURIComponent(taskId)}`, { signal })
    onStatusUpdate?.(taskStatus)

    if (taskStatus.status === 'completed') {
      return requestJson(`/tasks/status/${encodeURIComponent(taskId)}/result`, { signal })
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
})

export const initializeAssets = ({ forceRefresh = false } = {}, signal) => {
  const query = forceRefresh ? '?force_refresh=true' : ''
  return requestJson(`/tasks/initialize${query}`, { signal })
}

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

export const commitSession = (sessionId, user, signal) => {
  const payload = typeof user === 'string' ? { user } : user && typeof user === 'object' && !('aborted' in user) ? user : {}
  const abortSignal = user && typeof user === 'object' && 'aborted' in user ? user : signal
  return postJson(`/schedule/session/${encodeURIComponent(sessionId)}/commit`, payload, abortSignal)
}

export const clearScopeActivities = (payload, signal) => (
  postJson('/utilities/satos/clear-scope-activities', payload, signal)
)

