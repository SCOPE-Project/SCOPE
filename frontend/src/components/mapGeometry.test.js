import { describe, expect, it } from 'vitest'
import {
  EARTH_MEAN_RADIUS_METERS,
  buildCoordinateGrid,
  buildGeodesicCircle,
  calculateElevationFootprintAngle,
  clipPolylineToLatitudeRange,
  interpolateTrackPosition,
  normalizeSignedLongitude,
  splitCoordinatesAtAntimeridian,
  splitTrackAtAntimeridian,
} from './mapGeometry.js'

describe('splitTrackAtAntimeridian', () => {
  it('keeps ordinary ground tracks in one segment', () => {
    const segments = splitTrackAtAntimeridian([
      { longitude_deg: 10, latitude_deg: 20 },
      { longitude_deg: 25, latitude_deg: 30 },
    ])

    expect(segments).toEqual([[[10, 20], [25, 30]]])
  })

  it('splits eastbound tracks at the antimeridian', () => {
    const segments = splitTrackAtAntimeridian([
      { longitude_deg: 170, latitude_deg: 10 },
      { longitude_deg: -170, latitude_deg: 20 },
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0].at(-1)).toEqual([180, 15])
    expect(segments[1][0]).toEqual([-180, 15])
  })

  it('splits westbound tracks at the antimeridian', () => {
    const segments = splitTrackAtAntimeridian([
      { longitude_deg: -170, latitude_deg: 20 },
      { longitude_deg: 170, latitude_deg: 10 },
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0].at(-1)).toEqual([-180, 15])
    expect(segments[1][0]).toEqual([180, 15])
  })

  it('wraps unbounded east longitudes before splitting the track', () => {
    const segments = splitTrackAtAntimeridian([
      { longitude_deg: 179, latitude_deg: 10 },
      { longitude_deg: 181, latitude_deg: 12 },
    ])

    expect(segments).toEqual([
      [[179, 10], [180, 11]],
      [[-180, 11], [-179, 12]],
    ])
  })
})

describe('normalizeSignedLongitude', () => {
  it('wraps longitudes into a single visible world', () => {
    expect(normalizeSignedLongitude(181)).toBe(-179)
    expect(normalizeSignedLongitude(-181)).toBe(179)
    expect(normalizeSignedLongitude(180)).toBe(-180)
  })
})

describe('splitCoordinatesAtAntimeridian', () => {
  it('splits generic coordinate rings without drawing across the map', () => {
    const segments = splitCoordinatesAtAntimeridian([
      [175, 70],
      [-175, 75],
      [-165, 70],
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0].at(-1)[0]).toBe(180)
    expect(segments[1][0][0]).toBe(-180)
  })
})

describe('clipPolylineToLatitudeRange', () => {
  it('ends a line at the Mercator latitude instead of flattening out-of-range points', () => {
    const segments = clipPolylineToLatitudeRange(
      [[10, 80], [20, 88], [30, 89]],
      -85,
      85,
    )

    expect(segments).toHaveLength(1)
    expect(segments[0][0]).toEqual([10, 80])
    expect(segments[0].at(-1)[1]).toBeCloseTo(85)
    expect(segments[0]).toHaveLength(2)
  })

  it('keeps separate visible sections separate', () => {
    const segments = clipPolylineToLatitudeRange(
      [[0, 80], [10, 88], [20, 80]],
      -85,
      85,
    )

    expect(segments).toHaveLength(2)
    expect(segments[0].at(-1)[1]).toBeCloseTo(85)
    expect(segments[1][0][1]).toBeCloseTo(85)
  })
})

describe('buildCoordinateGrid', () => {
  it('builds longitude and latitude lines with geographic metadata', () => {
    const grid = buildCoordinateGrid()
    const longitudeLines = grid.features.filter(({ properties }) => (
      properties.axis === 'longitude'
    ))
    const latitudeLines = grid.features.filter(({ properties }) => (
      properties.axis === 'latitude'
    ))

    expect(grid.type).toBe('FeatureCollection')
    expect(longitudeLines).toHaveLength(12)
    expect(latitudeLines).toHaveLength(11)
    expect(longitudeLines[0].geometry.coordinates[0]).toEqual([-180, -85])
    expect(latitudeLines[0].geometry.coordinates.at(-1)).toEqual([180, -75])
  })
})

describe('interpolateTrackPosition', () => {
  const track = [
    {
      timestamp: '2026-08-10T12:00:00.000Z',
      latitude_deg: 10,
      longitude_deg: 170,
      altitude_m: 300000,
    },
    {
      timestamp: '2026-08-10T12:01:00.000Z',
      latitude_deg: 20,
      longitude_deg: -170,
      altitude_m: 320000,
    },
  ]

  it('interpolates position and altitude at the selected timestamp', () => {
    const position = interpolateTrackPosition(track, Date.parse('2026-08-10T12:00:30.000Z'))

    expect(position.latitude).toBeCloseTo(15)
    expect(Math.abs(position.longitude)).toBeCloseTo(180)
    expect(position.altitude).toBeCloseTo(310000)
    expect(position.timestamp).toBe('2026-08-10T12:00:30.000Z')
  })

  it('returns no stale position outside the propagated interval', () => {
    expect(interpolateTrackPosition(track, Date.parse('2026-08-10T11:59:59.000Z'))).toBeNull()
    expect(interpolateTrackPosition(track, Date.parse('2026-08-10T12:01:01.000Z'))).toBeNull()
  })

  it('wraps an exact propagated point beyond 180 degrees', () => {
    const position = interpolateTrackPosition([
      {
        timestamp: '2026-08-10T12:00:00.000Z',
        latitude_deg: 5,
        longitude_deg: 181,
        altitude_m: 300000,
      },
    ], Date.parse('2026-08-10T12:00:00.000Z'))

    expect(position.longitude).toBe(-179)
  })
})

describe('calculateElevationFootprintAngle', () => {
  it('matches the geometric horizon angle at zero elevation', () => {
    const altitudeMeters = 300000
    const footprintAngle = calculateElevationFootprintAngle(altitudeMeters, 0)

    expect(footprintAngle).toBeCloseTo(
      Math.acos(EARTH_MEAN_RADIUS_METERS / (EARTH_MEAN_RADIUS_METERS + altitudeMeters)),
      10,
    )
  })

  it('collapses to the station location at zenith', () => {
    expect(calculateElevationFootprintAngle(300000, 90)).toBeCloseTo(0, 10)
  })
})

describe('buildGeodesicCircle', () => {
  it('returns a closed ring around the station', () => {
    const circle = buildGeodesicCircle(50, 10, 0.1, 32)

    expect(circle).toHaveLength(33)
    expect(circle[0][0]).toBeCloseTo(circle.at(-1)[0], 10)
    expect(circle[0][1]).toBeCloseTo(circle.at(-1)[1], 10)
  })
})
