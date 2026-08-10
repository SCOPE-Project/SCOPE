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
) => {
  if (!Number.isFinite(altitudeMeters) || altitudeMeters <= 0) {
    return null
  }

  const elevationRadians = (
    Math.max(0, Math.min(90, minimumElevationDegrees ?? 0))
    * Math.PI
    / 180
  )
  const satelliteRadius = EARTH_MEAN_RADIUS_METERS + altitudeMeters
  const arccosInput = Math.max(
    -1,
    Math.min(
      1,
      (EARTH_MEAN_RADIUS_METERS / satelliteRadius) * Math.cos(elevationRadians),
    ),
  )

  return Math.max(0, Math.acos(arccosInput) - elevationRadians)
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
  const coordinates = []

  for (let index = 0; index <= pointCount; index += 1) {
    const bearing = (index / pointCount) * Math.PI * 2
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

    coordinates.push([
      ((longitude * 180 / Math.PI) + 540) % 360 - 180,
      latitude * 180 / Math.PI,
    ])
  }

  return coordinates
}
