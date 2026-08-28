import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { initializeAssets } from './scopeApi.js'

describe('initializeAssets', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls /tasks/initialize without query string by default', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ assets: [], schedules: [], cached: true, source: 'cache' }),
    })

    const result = await initializeAssets()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('/tasks/initialize')
    expect(url).not.toContain('force_refresh')
    expect(result).toEqual({ assets: [], schedules: [], cached: true, source: 'cache' })
  })

  it('calls /tasks/initialize?force_refresh=true when forceRefresh is true', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ assets: [], schedules: [], cached: false, source: 'initialization' }),
    })

    const result = await initializeAssets({ forceRefresh: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('/tasks/initialize?force_refresh=true')
    expect(result).toEqual({ assets: [], schedules: [], cached: false, source: 'initialization' })
  })
})
