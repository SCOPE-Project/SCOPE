import { describe, expect, it, vi } from 'vitest'
import { loadWorldOutlines, parseWorldOutlines } from './worldMap.js'

describe('parseWorldOutlines', () => {
  it('passes through valid pre-built path entries', () => {
    const paths = parseWorldOutlines({
      paths: [
        { id: 'Testland', d: 'M 0 0 L 10 0 L 10 -10 Z' },
      ],
    })

    expect(paths).toEqual([{ id: 'Testland', d: 'M 0 0 L 10 0 L 10 -10 Z' }]);
  })

  it('drops entries with no usable path data', () => {
    const paths = parseWorldOutlines({
      paths: [
        { id: 'Empty', d: '' },
        { id: 'Missing' },
        null,
      ],
    })

    expect(paths).toHaveLength(0)
  })

  it('handles a missing paths array gracefully', () => {
    expect(parseWorldOutlines({})).toEqual([])
    expect(parseWorldOutlines(null)).toEqual([])
  })
})

describe('loadWorldOutlines', () => {
  it('fetches and parses the world outline document', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        paths: [{ id: 'Testland', d: 'M 0 0 L 1 1 Z' }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const paths = await loadWorldOutlines('/world/countries.json')

    expect(fetchMock).toHaveBeenCalledWith('/world/countries.json', { signal: undefined })
    expect(paths).toEqual([{ id: 'Testland', d: 'M 0 0 L 1 1 Z' }])

    vi.unstubAllGlobals()
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(loadWorldOutlines('/world/countries.json')).rejects.toThrow('404')

    vi.unstubAllGlobals()
  })
})
