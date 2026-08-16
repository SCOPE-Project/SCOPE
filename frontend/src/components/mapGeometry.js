export const normalizeSignedLongitude = (longitude) => (
  ((longitude + 180) % 360 + 360) % 360 - 180
)

export const splitCoordinatesAtAntimeridian = (coordinates) => {
  if (coordinates.length < 2) {
    return []
  }

  const segments = []
  let currentSegment = [coordinates[0]]

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    const longitudeDelta = current[0] - previous[0]

    if (Math.abs(longitudeDelta) <= 180) {
      currentSegment.push(current)
      continue
    }

    const adjustedCurrentLongitude = current[0] + (longitudeDelta > 180 ? -360 : 360)
    const boundaryLongitude = adjustedCurrentLongitude > previous[0] ? 180 : -180
    const crossingRatio = (
      (boundaryLongitude - previous[0])
      / (adjustedCurrentLongitude - previous[0])
    )
    const crossingLatitude = previous[1] + ((current[1] - previous[1]) * crossingRatio)
    const oppositeBoundaryLongitude = boundaryLongitude === 180 ? -180 : 180

    currentSegment.push([boundaryLongitude, crossingLatitude])
    segments.push(currentSegment)
    currentSegment = [[oppositeBoundaryLongitude, crossingLatitude], current]
  }

  segments.push(currentSegment)
  return segments.filter((segment) => segment.length >= 2)
}

export const splitTrackAtAntimeridian = (points) => (
  splitCoordinatesAtAntimeridian(
    points
      .filter((point) => (
        Number.isFinite(point?.longitude_deg)
        && Number.isFinite(point?.latitude_deg)
      ))
      .map((point) => [normalizeSignedLongitude(point.longitude_deg), point.latitude_deg]),
  )
)

const coordinatesMatch = (left, right) => (
  Math.abs(left[0] - right[0]) < 1e-9
  && Math.abs(left[1] - right[1]) < 1e-9
)

const clipSegmentToLatitudeRange = (start, end, minimumLatitude, maximumLatitude) => {
  const latitudeDelta = end[1] - start[1]

  if (Math.abs(latitudeDelta) < 1e-12) {
    return start[1] >= minimumLatitude && start[1] <= maximumLatitude
      ? [start, end]
      : null
  }

  const firstBoundaryRatio = (minimumLatitude - start[1]) / latitudeDelta
  const secondBoundaryRatio = (maximumLatitude - start[1]) / latitudeDelta
  const entryRatio = Math.max(0, Math.min(firstBoundaryRatio, secondBoundaryRatio))
  const exitRatio = Math.min(1, Math.max(firstBoundaryRatio, secondBoundaryRatio))

  if (entryRatio > exitRatio) {
    return null
  }

  const interpolate = (ratio) => [
    start[0] + ((end[0] - start[0]) * ratio),
    start[1] + (latitudeDelta * ratio),
  ]

  return [interpolate(entryRatio), interpolate(exitRatio)]
}

export const clipPolylineToLatitudeRange = (
  coordinates,
  minimumLatitude,
  maximumLatitude,
) => {
  if (
    coordinates.length < 2
    || !Number.isFinite(minimumLatitude)
    || !Number.isFinite(maximumLatitude)
    || minimumLatitude >= maximumLatitude
  ) {
    return []
  }

  const clippedSegments = []
  let currentSegment = []

  for (let index = 1; index < coordinates.length; index += 1) {
    const clipped = clipSegmentToLatitudeRange(
      coordinates[index - 1],
      coordinates[index],
      minimumLatitude,
      maximumLatitude,
    )

    if (!clipped || coordinatesMatch(clipped[0], clipped[1])) {
      if (currentSegment.length >= 2) {
        clippedSegments.push(currentSegment)
      }
      currentSegment = []
      continue
    }

    if (
      currentSegment.length === 0
      || !coordinatesMatch(currentSegment.at(-1), clipped[0])
    ) {
      if (currentSegment.length >= 2) {
        clippedSegments.push(currentSegment)
      }
      currentSegment = [clipped[0]]
    }

    if (!coordinatesMatch(currentSegment.at(-1), clipped[1])) {
      currentSegment.push(clipped[1])
    }

    const nextPointIsOutside = (
      coordinates[index][1] < minimumLatitude
      || coordinates[index][1] > maximumLatitude
    )
    if (nextPointIsOutside && currentSegment.length >= 2) {
      clippedSegments.push(currentSegment)
      currentSegment = []
    }
  }

  if (currentSegment.length >= 2) {
    clippedSegments.push(currentSegment)
  }

  return clippedSegments
}

export const EARTH_MEAN_RADIUS_METERS = 6371008.8

// WGS84 rotational ellipsoid (semi-major/semi-minor axes). Ground station
// visibility footprints below are drawn with spherical trigonometry, which
// needs a single "Earth radius" -- but the true geocentric distance to the
// surface varies with latitude (~6378.1 km at the equator down to
// ~6356.8 km at the poles), a ~21 km spread that a single mean-sphere
// radius (EARTH_MEAN_RADIUS_METERS) ignores. geocentricEarthRadiusMeters
// below corrects for this at a given ground station's latitude instead of
// always assuming the mean sphere.
const WGS84_SEMI_MAJOR_AXIS_METERS = 6378137
const WGS84_SEMI_MINOR_AXIS_METERS = 6356752.314245
const WGS84_ECCENTRICITY_SQUARED = (
  (WGS84_SEMI_MAJOR_AXIS_METERS ** 2 - WGS84_SEMI_MINOR_AXIS_METERS ** 2)
  / (WGS84_SEMI_MAJOR_AXIS_METERS ** 2)
)

// Geocentric radius (distance from Earth's center to the ellipsoid surface)
// at a given geodetic latitude. Derived from the standard ellipsoid
// parametrization by geodetic latitude phi:
//   N(phi) = a / sqrt(1 - e^2 sin^2(phi))        -- prime-vertical radius of curvature
//   p(phi) = N(phi) * cos(phi)                   -- distance from the rotation axis
//   z(phi) = N(phi) * (1 - e^2) * sin(phi)        -- height above the equatorial plane
// and the geocentric radius is simply sqrt(p^2 + z^2).
export const geocentricEarthRadiusMeters = (latitudeDegrees) => {
  if (!Number.isFinite(latitudeDegrees)) {
    return EARTH_MEAN_RADIUS_METERS
  }

  const latitudeRadians = latitudeDegrees * Math.PI / 180
  const sinLatitude = Math.sin(latitudeRadians)
  const primeVerticalRadius = (
    WGS84_SEMI_MAJOR_AXIS_METERS
    / Math.sqrt(1 - (WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude))
  )
  const distanceFromAxis = primeVerticalRadius * Math.cos(latitudeRadians)
  const heightAboveEquatorialPlane = (
    primeVerticalRadius * (1 - WGS84_ECCENTRICITY_SQUARED) * sinLatitude
  )

  return Math.sqrt(
    (distanceFromAxis ** 2) + (heightAboveEquatorialPlane ** 2),
  )
}

// A satellite's instantaneous propagated altitude wobbles along its orbit
// (more so for eccentric orbits) and jumps whenever a different satellite
// becomes the map's "reference" satellite. Ground station visibility
// footprints should stay stationary rather than resize on every timeline
// tick, so callers use this orbit-representative altitude (the track's mean
// altitude) instead of the live interpolated altitude at the current
// playhead time.
export const computeMeanTrackAltitudeMeters = (trackPoints) => {
  const altitudes = (trackPoints ?? [])
    .map((point) => point?.altitude_m)
    .filter((altitude) => Number.isFinite(altitude))

  if (altitudes.length === 0) {
    return null
  }

  return altitudes.reduce((sum, altitude) => sum + altitude, 0) / altitudes.length
}

export const buildCoordinateGrid = (
  longitudeStepDegrees = 30,
  latitudeStepDegrees = 15,
) => {
  const features = []

  for (let longitude = -180; longitude < 180; longitude += longitudeStepDegrees) {
    const coordinates = []
    for (let latitude = -85; latitude <= 85; latitude += 5) {
      coordinates.push([longitude, latitude])
    }

    features.push({
      type: 'Feature',
      properties: { axis: 'longitude', degrees: longitude },
      geometry: { type: 'LineString', coordinates },
    })
  }

  for (let latitude = -75; latitude <= 75; latitude += latitudeStepDegrees) {
    const coordinates = []
    for (let longitude = -180; longitude <= 180; longitude += 5) {
      coordinates.push([longitude, latitude])
    }

    features.push({
      type: 'Feature',
      properties: { axis: 'latitude', degrees: latitude },
      geometry: { type: 'LineString', coordinates },
    })
  }

  return { type: 'FeatureCollection', features }
}

export const interpolateTrackPosition = (trackPoints, targetTimestamp) => {
  if (!Number.isFinite(targetTimestamp)) {
    return null
  }

  const points = (trackPoints ?? [])
    .map((point) => ({ ...point, timestampMs: Date.parse(point?.timestamp) }))
    .filter((point) => (
      Number.isFinite(point.timestampMs)
      && Number.isFinite(point.latitude_deg)
      && Number.isFinite(point.longitude_deg)
    ))
    .sort((first, second) => first.timestampMs - second.timestampMs)

  if (
    points.length === 0
    || targetTimestamp < points[0].timestampMs
    || targetTimestamp > points.at(-1).timestampMs
  ) {
    return null
  }

  const exactPoint = points.find((point) => point.timestampMs === targetTimestamp)
  if (exactPoint) {
    return {
      latitude: exactPoint.latitude_deg,
      longitude: normalizeSignedLongitude(exactPoint.longitude_deg),
      altitude: exactPoint.altitude_m,
      timestamp: new Date(targetTimestamp).toISOString(),
    }
  }

  const nextIndex = points.findIndex((point) => point.timestampMs > targetTimestamp)
  const previous = points[nextIndex - 1]
  const next = points[nextIndex]
  const interpolationRatio = (
    (targetTimestamp - previous.timestampMs)
    / (next.timestampMs - previous.timestampMs)
  )
  let longitudeDelta = next.longitude_deg - previous.longitude_deg

  if (longitudeDelta > 180) {
    longitudeDelta -= 360
  } else if (longitudeDelta < -180) {
    longitudeDelta += 360
  }

  const hasInterpolatedAltitude = (
    Number.isFinite(previous.altitude_m)
    && Number.isFinite(next.altitude_m)
  )

  return {
    latitude: previous.latitude_deg
      + ((next.latitude_deg - previous.latitude_deg) * interpolationRatio),
    longitude: normalizeSignedLongitude(
      previous.longitude_deg + (longitudeDelta * interpolationRatio),
    ),
    altitude: hasInterpolatedAltitude
      ? previous.altitude_m + ((next.altitude_m - previous.altitude_m) * interpolationRatio)
      : previous.altitude_m,
    timestamp: new Date(targetTimestamp).toISOString(),
  }
}

export const calculateElevationFootprintAngle = (
  altitudeMeters,
  minimumElevationDegrees,
  groundRadiusMeters = EARTH_MEAN_RADIUS_METERS,
) => {
  if (!Number.isFinite(altitudeMeters) || altitudeMeters <= 0) {
    return null
  }

  const earthRadius = (
    Number.isFinite(groundRadiusMeters) && groundRadiusMeters > 0
      ? groundRadiusMeters
      : EARTH_MEAN_RADIUS_METERS
  )
  const elevationRadians = (
    Math.max(0, Math.min(90, minimumElevationDegrees ?? 0))
    * Math.PI
    / 180
  )
  const satelliteRadius = earthRadius + altitudeMeters
  const arccosInput = Math.max(
    -1,
    Math.min(
      1,
      (earthRadius / satelliteRadius) * Math.cos(elevationRadians),
    ),
  )

  return Math.max(0, Math.acos(arccosInput) - elevationRadians)
}

const sphericalCirclePoint = (
  latitudeRadians,
  longitudeRadians,
  angularRadiusRadians,
  bearing,
) => {
  const latitude = Math.asin(
    (Math.sin(latitudeRadians) * Math.cos(angularRadiusRadians))
    + (
      Math.cos(latitudeRadians)
      * Math.sin(angularRadiusRadians)
      * Math.cos(bearing)
    ),
  )
  const longitude = longitudeRadians + Math.atan2(
    Math.sin(bearing) * Math.sin(angularRadiusRadians) * Math.cos(latitudeRadians),
    Math.cos(angularRadiusRadians) - (Math.sin(latitudeRadians) * Math.sin(latitude)),
  )

  return [
    ((longitude * 180 / Math.PI) + 540) % 360 - 180,
    latitude * 180 / Math.PI,
  ]
}

// The minimal longitude separation between two points, taking the +-180
// antimeridian wrap into account (e.g. 179 and -179 are 2 degrees apart,
// not 358).
const wrappedLongitudeDelta = (longitudeA, longitudeB) => {
  const rawDelta = Math.abs(longitudeA - longitudeB)
  return rawDelta > 180 ? 360 - rawDelta : rawDelta
}

// When a footprint/visibility circle is centered close to a pole and its
// angular radius reaches past it, the circle's boundary passes very close
// to the pole itself. There, longitude changes extremely fast per degree of
// bearing (in the limit, infinitely fast exactly at the pole), so a fixed
// number of evenly-spaced bearing samples can leave two *adjacent* samples
// tens of degrees of longitude apart. Rendered as a straight line, that
// shows up as a long, wrong-looking diagonal chord cutting across the map
// instead of the curve hugging the area near the pole.
//
// This recursively bisects only the bearing intervals that need it (large
// longitude jump between endpoints), so ordinary circles are unaffected and
// stay at their base `pointCount` resolution.
const ADAPTIVE_LONGITUDE_THRESHOLD_DEGREES = 5
const MAX_ADAPTIVE_SUBDIVISIONS = 24

const appendRefinedArc = (
  output,
  pointAt,
  bearingStart,
  pointStart,
  bearingEnd,
  pointEnd,
  depth,
) => {
  if (
    depth >= MAX_ADAPTIVE_SUBDIVISIONS
    || wrappedLongitudeDelta(pointStart[0], pointEnd[0]) <= ADAPTIVE_LONGITUDE_THRESHOLD_DEGREES
  ) {
    output.push(pointEnd)
    return
  }

  const bearingMid = (bearingStart + bearingEnd) / 2
  const pointMid = pointAt(bearingMid)
  appendRefinedArc(output, pointAt, bearingStart, pointStart, bearingMid, pointMid, depth + 1)
  appendRefinedArc(output, pointAt, bearingMid, pointMid, bearingEnd, pointEnd, depth + 1)
}

export const buildGeodesicCircle = (
  latitudeDegrees,
  longitudeDegrees,
  angularRadiusRadians,
  pointCount = 128,
) => {
  if (
    !Number.isFinite(latitudeDegrees)
    || !Number.isFinite(longitudeDegrees)
    || !Number.isFinite(angularRadiusRadians)
    || angularRadiusRadians <= 0
  ) {
    return []
  }

  const latitudeRadians = (latitudeDegrees * Math.PI) / 180
  const longitudeRadians = (longitudeDegrees * Math.PI) / 180
  const pointAt = (bearing) => (
    sphericalCirclePoint(latitudeRadians, longitudeRadians, angularRadiusRadians, bearing)
  )

  const firstPoint = pointAt(0)
  const coordinates = [firstPoint]
  let previousBearing = 0
  let previousPoint = firstPoint

  for (let index = 1; index <= pointCount; index += 1) {
    const bearing = (index / pointCount) * Math.PI * 2
    const point = pointAt(bearing)
    appendRefinedArc(coordinates, pointAt, previousBearing, previousPoint, bearing, point, 0)
    previousBearing = bearing
    previousPoint = point
  }

  return coordinates
}
