// A true Plate Carree (equirectangular) projection: longitude and latitude are
// mapped to screen space with the same, constant pixels-per-degree scale on
// both axes. Unlike Web Mercator, this keeps north/south spacing uniform all
// the way to the poles, so the whole globe (-90..90 latitude) can be shown at
// once and ground tracks / visibility cones near the poles are not distorted
// by the projection's own scale blow-up.

export const LONGITUDE_SPAN_DEGREES = 360
export const LATITUDE_SPAN_DEGREES = 180
export const MAX_LATITUDE = 90
export const MAX_LONGITUDE = 180

export const MIN_ZOOM_FLOOR = -4
export const MAX_ZOOM = 9

// scale = pixels per degree at a given zoom level. zoom 0 == 1px/degree,
// each +1 doubles the pixel density, mirroring familiar slippy-map zoom feel.
export const scaleForZoom = (zoom) => 2 ** zoom

export const zoomForScale = (scale) => Math.log2(scale)

// The zoom level at which the entire 360x180 degree world exactly fits
// inside a `width` x `height` viewport (a "contain" fit). This is also the
// lowest zoom the map should allow, since zooming out further only adds
// empty margin.
export const computeFitWorldZoom = (width, height) => {
  if (width <= 0 || height <= 0) {
    return MIN_ZOOM_FLOOR
  }

  const scale = Math.min(
    width / LONGITUDE_SPAN_DEGREES,
    height / LATITUDE_SPAN_DEGREES,
  )
  return Math.max(MIN_ZOOM_FLOOR, zoomForScale(scale))
}

export const project = (longitude, latitude, view, width, height) => {
  const scale = scaleForZoom(view.zoom)
  return {
    x: (width / 2) + ((longitude - view.centerLongitude) * scale),
    y: (height / 2) - ((latitude - view.centerLatitude) * scale),
  }
}

export const unproject = (x, y, view, width, height) => {
  const scale = scaleForZoom(view.zoom)
  return {
    longitude: view.centerLongitude + ((x - (width / 2)) / scale),
    latitude: view.centerLatitude - ((y - (height / 2)) / scale),
  }
}

const clampAxisCenter = (center, span, visibleSpan) => {
  if (visibleSpan >= span) {
    return 0
  }

  const limit = (span / 2) - (visibleSpan / 2)
  return Math.max(-limit, Math.min(limit, center))
}

export const clampView = (view, width, height, minZoom) => {
  const zoom = Math.max(minZoom, Math.min(MAX_ZOOM, view.zoom))
  const scale = scaleForZoom(zoom)
  const visibleLongitudeSpan = width / scale
  const visibleLatitudeSpan = height / scale

  return {
    zoom,
    centerLongitude: clampAxisCenter(
      view.centerLongitude,
      LONGITUDE_SPAN_DEGREES,
      visibleLongitudeSpan,
    ),
    centerLatitude: clampAxisCenter(
      view.centerLatitude,
      LATITUDE_SPAN_DEGREES,
      visibleLatitudeSpan,
    ),
  }
}

// SVG transform for the static world-outline layer, whose paths are defined
// once in raw "world space" (x = longitude, y = -latitude). Because the
// projection is a pure affine transform (uniform scale + translate), the
// entire land layer can be repositioned on pan/zoom with a single transform
// attribute instead of recomputing thousands of path points every frame.
export const worldGroupTransform = (view, width, height) => {
  const scale = scaleForZoom(view.zoom)
  const translateX = (width / 2) - (view.centerLongitude * scale)
  const translateY = (height / 2) + (view.centerLatitude * scale)
  return `translate(${translateX} ${translateY}) scale(${scale})`
}

export const getVisibleGeographicBounds = (view, width, height) => {
  const topLeft = unproject(0, 0, view, width, height)
  const bottomRight = unproject(width, height, view, width, height)

  return {
    minimumLongitude: Math.max(-MAX_LONGITUDE, topLeft.longitude),
    maximumLongitude: Math.min(MAX_LONGITUDE, bottomRight.longitude),
    minimumLatitude: Math.max(-MAX_LATITUDE, bottomRight.latitude),
    maximumLatitude: Math.min(MAX_LATITUDE, topLeft.latitude),
  }
}

// Computes the view (center + zoom) that fits a geographic bounding box
// inside the viewport, honoring asymmetric padding (e.g. for UI chrome that
// overlaps one side of the map) the same way MapLibre's fitBounds did.
export const computeFitBoundsView = (
  bounds,
  width,
  height,
  { padding = {}, maxZoom = MAX_ZOOM, minZoom = MIN_ZOOM_FLOOR } = {},
) => {
  const { top = 0, right = 0, bottom = 0, left = 0 } = padding
  const longitudeSpan = Math.max(1e-6, bounds.maxLongitude - bounds.minLongitude)
  const latitudeSpan = Math.max(1e-6, bounds.maxLatitude - bounds.minLatitude)
  const availableWidth = Math.max(1, width - left - right)
  const availableHeight = Math.max(1, height - top - bottom)

  const scale = Math.min(
    availableWidth / longitudeSpan,
    availableHeight / latitudeSpan,
  )
  const zoom = Math.max(minZoom, Math.min(maxZoom, zoomForScale(scale)))
  const fittedScale = scaleForZoom(zoom)

  const offsetX = (left - right) / 2
  const offsetY = (top - bottom) / 2
  const boundsCenterLongitude = (bounds.minLongitude + bounds.maxLongitude) / 2
  const boundsCenterLatitude = (bounds.minLatitude + bounds.maxLatitude) / 2

  return {
    zoom,
    centerLongitude: boundsCenterLongitude - (offsetX / fittedScale),
    centerLatitude: boundsCenterLatitude + (offsetY / fittedScale),
  }
}
