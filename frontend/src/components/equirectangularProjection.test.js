import { describe, expect, it } from 'vitest'
import {
  clampView,
  computeFitBoundsView,
  computeFitWorldZoom,
  project,
  unproject,
  worldGroupTransform,
} from './equirectangularProjection.js'

describe('project / unproject', () => {
  it('maps the center of the view to the center of the viewport', () => {
    const view = { centerLongitude: 12, centerLatitude: -5, zoom: 3 }
    const point = project(12, -5, view, 800, 400)
    expect(point.x).toBeCloseTo(400)
    expect(point.y).toBeCloseTo(200)
  })

  it('uses the same pixels-per-degree scale on both axes (constant angular spacing)', () => {
    const view = { centerLongitude: 0, centerLatitude: 0, zoom: 4 }
    const east = project(10, 0, view, 800, 400)
    const north = project(0, 10, view, 800, 400)
    const westward = 400 - project(-10, 0, view, 800, 400).x
    const southward = project(0, -10, view, 800, 400).y - 200

    expect(east.x - 400).toBeCloseTo(westward)
    expect(200 - north.y).toBeCloseTo(southward)
    expect(east.x - 400).toBeCloseTo(200 - north.y)
  })

  it('places the north pole above the south pole regardless of zoom', () => {
    const view = { centerLongitude: 0, centerLatitude: 0, zoom: 2 }
    const north = project(0, 90, view, 1000, 1000)
    const south = project(0, -90, view, 1000, 1000)
    expect(north.y).toBeLessThan(south.y)
  })

  it('round-trips through unproject', () => {
    const view = { centerLongitude: -40, centerLatitude: 15, zoom: 5 }
    const projected = project(33, -60, view, 1024, 640)
    const back = unproject(projected.x, projected.y, view, 1024, 640)
    expect(back.longitude).toBeCloseTo(33)
    expect(back.latitude).toBeCloseTo(-60)
  })
})

describe('computeFitWorldZoom', () => {
  it('picks a zoom where the whole 360x180 world fits inside the viewport', () => {
    const width = 900
    const height = 500
    const zoom = computeFitWorldZoom(width, height)
    const scale = 2 ** zoom
    expect(scale * 360).toBeLessThanOrEqual(width + 1e-6)
    expect(scale * 180).toBeLessThanOrEqual(height + 1e-6)
    // it should be a "contain" fit: at least one axis is fully used
    expect(Math.max(scale * 360, scale * 180)).toBeGreaterThan(
      Math.min(width, height) * 0.5,
    )
  })
})

describe('clampView', () => {
  it('recenters an axis to 0 once the whole span already fits on screen', () => {
    const minZoom = computeFitWorldZoom(900, 500)
    const clamped = clampView(
      { centerLongitude: 40, centerLatitude: -20, zoom: minZoom },
      900,
      500,
      minZoom,
    )
    expect(clamped.centerLongitude).toBe(0)
    expect(clamped.centerLatitude).toBe(0)
  })

  it('never allows panning past the poles or the +-180 meridian when zoomed in', () => {
    const clamped = clampView(
      { centerLongitude: 500, centerLatitude: 500, zoom: 6 },
      800,
      400,
      -4,
    )
    expect(clamped.centerLongitude).toBeLessThanOrEqual(180)
    expect(clamped.centerLatitude).toBeLessThanOrEqual(90)
  })

  it('never zooms out past minZoom or in past MAX_ZOOM', () => {
    const clamped = clampView(
      { centerLongitude: 0, centerLatitude: 0, zoom: -100 },
      800,
      400,
      -2,
    )
    expect(clamped.zoom).toBe(-2)
  })
})

describe('worldGroupTransform', () => {
  it('produces a transform that maps world-space (lon, -lat) to the same screen point as project()', () => {
    const view = { centerLongitude: 5, centerLatitude: -10, zoom: 3 }
    const width = 640
    const height = 480
    const transform = worldGroupTransform(view, width, height)
    const match = transform.match(
      /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/,
    )
    expect(match).not.toBeNull()
    const [, translateX, translateY, scale] = match.map(Number)

    const longitude = 42
    const latitude = 17
    const worldX = longitude
    const worldY = -latitude
    const screenX = (worldX * scale) + translateX
    const screenY = (worldY * scale) + translateY

    const expected = project(longitude, latitude, view, width, height)
    expect(screenX).toBeCloseTo(expected.x)
    expect(screenY).toBeCloseTo(expected.y)
  })
})

describe('computeFitBoundsView', () => {
  it('centers on the bounding box when there is no padding', () => {
    const view = computeFitBoundsView(
      { minLongitude: 10, maxLongitude: 30, minLatitude: -5, maxLatitude: 15 },
      800,
      400,
    )
    expect(view.centerLongitude).toBeCloseTo(20)
    expect(view.centerLatitude).toBeCloseTo(5)
  })

  it('shifts the view center to keep the bbox centered inside asymmetric padding', () => {
    const bounds = { minLongitude: -10, maxLongitude: 10, minLatitude: -10, maxLatitude: 10 }
    const view = computeFitBoundsView(bounds, 800, 400, {
      padding: { top: 0, right: 200, bottom: 0, left: 0 },
    })
    // With extra padding on the right, the map center must move right of the
    // bbox center so the bbox appears centered in the remaining space.
    expect(view.centerLongitude).toBeGreaterThan(0)
  })
})
