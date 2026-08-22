import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import {
  buildGeodesicCircle,
  calculateElevationFootprintAngle,
  clipPolylineToLatitudeRange,
  clipTrackToTimeWindow,
  computeMeanTrackAltitudeMeters,
  geocentricEarthRadiusMeters,
  interpolateTrackPosition,
  normalizeSignedLongitude,
  splitCoordinatesAtAntimeridian,
  splitTrackAtAntimeridian,
} from './mapGeometry.js'
import {
  MAX_LATITUDE,
  clampView,
  computeFitBoundsView,
  computeFitWorldZoom,
  getVisibleGeographicBounds,
  project,
  scaleForZoom,
  unproject,
  worldGroupTransform,
} from './equirectangularProjection.js'
import { loadWorldOutlines } from './worldMap.js'

const WORLD_OUTLINES_URL = `${import.meta.env.BASE_URL}world/countries-110m.json`
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const WHEEL_ZOOM_STEP = 0.55
const BUTTON_ZOOM_STEP = 1
const EASE_DURATION_MS = 450
const SATELLITE_VISIBILITY_REDRAW_MS = 100
const GROUND_TRACK_REDRAW_MS = 250
const SATELLITE_VISIBILITY_POINT_COUNT = 64

// Equirectangular (Plate Carree) projection: longitude and latitude share the
// same constant pixels-per-degree scale, so the whole world from pole to
// pole can be shown at once and ground tracks / visibility footprints keep a
// uniform north/south spacing instead of the Mercator's polar stretching.

const easeOutCubic = (t) => 1 - ((1 - t) ** 3)

const animateView = (viewRef, target, duration, onFrame) => {
  const start = { ...viewRef.current }
  const startTime = (typeof performance !== 'undefined' ? performance : Date).now()

  if (duration <= 0) {
    viewRef.current = target
    onFrame()
    return
  }

  const step = () => {
    const now = (typeof performance !== 'undefined' ? performance : Date).now()
    const progress = Math.min(1, (now - startTime) / duration)
    const eased = easeOutCubic(progress)

    viewRef.current = {
      centerLongitude: start.centerLongitude
        + ((target.centerLongitude - start.centerLongitude) * eased),
      centerLatitude: start.centerLatitude
        + ((target.centerLatitude - start.centerLatitude) * eased),
      zoom: start.zoom + ((target.zoom - start.zoom) * eased),
    }
    onFrame()

    if (progress < 1) {
      window.requestAnimationFrame(step)
    }
  }

  window.requestAnimationFrame(step)
}

const formatCoordinate = (value, positiveLabel, negativeLabel, precision = 2) => {
  const direction = value >= 0 ? positiveLabel : negativeLabel
  return `${Math.abs(value).toFixed(precision)}° ${direction}`
}

const formatGridCoordinate = (value, positiveLabel, negativeLabel) => {
  if (Math.abs(value) < 1e-8) {
    return '0°'
  }

  const roundedValue = Number(Math.abs(value).toFixed(4))
  return `${roundedValue}° ${value > 0 ? positiveLabel : negativeLabel}`
}

const getNiceGridStep = (span, targetLineCount = 12) => {
  const rawStep = Math.max(span / targetLineCount, 0.1)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalizedStep = rawStep / magnitude
  const multiplier = [1, 1.5, 2, 2.5, 5, 10]
    .find((candidate) => candidate >= normalizedStep) ?? 10
  return multiplier * magnitude
}

const getGridValues = (minimum, maximum, step) => {
  const values = []
  const firstValue = Math.ceil((minimum - 1e-9) / step) * step

  for (let value = firstValue; value <= maximum + 1e-9; value += step) {
    values.push(Number(value.toFixed(8)))
  }

  return values
}

const niceScaleDistanceMeters = (maxDistanceMeters) => {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    return 0
  }

  const exponent = Math.floor(Math.log10(maxDistanceMeters))
  const fraction = maxDistanceMeters / (10 ** exponent)
  let niceFraction = 1
  if (fraction >= 7) {
    niceFraction = 10
  } else if (fraction >= 3) {
    niceFraction = 5
  } else if (fraction >= 1.5) {
    niceFraction = 2
  }

  return niceFraction * (10 ** exponent)
}

const computeScaleBar = (view, maxBarWidthPx = 110) => {
  const cosLatitude = Math.max(0.02, Math.cos(view.centerLatitude * Math.PI / 180))
  const metersPerDegree = 111320 * cosLatitude
  const scale = scaleForZoom(view.zoom)
  const metersPerPixel = metersPerDegree / scale
  const distanceMeters = niceScaleDistanceMeters(maxBarWidthPx * metersPerPixel)

  if (!(distanceMeters > 0) || !(metersPerPixel > 0)) {
    return null
  }

  const widthPx = distanceMeters / metersPerPixel
  const label = distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(distanceMeters >= 10000 ? 0 : 1)} km`
    : `${Math.round(distanceMeters)} m`

  return { widthPx, label }
}

const createSvgElement = (name, className) => {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  if (className) {
    element.setAttribute('class', className)
  }
  return element
}

const appendGridLabel = (fragment, text, x, y, anchor, axis, edge) => {
  const tick = createSvgElement('line', 'mission-map-coordinate-tick')
  if (axis === 'longitude') {
    tick.setAttribute('x1', x.toFixed(2))
    tick.setAttribute('x2', x.toFixed(2))
    tick.setAttribute('y1', edge === 'start' ? '0' : String(y - 6))
    tick.setAttribute('y2', edge === 'start' ? '6' : String(y))
  } else {
    tick.setAttribute('x1', edge === 'start' ? '0' : String(x - 6))
    tick.setAttribute('x2', edge === 'start' ? '6' : String(x))
    tick.setAttribute('y1', y.toFixed(2))
    tick.setAttribute('y2', y.toFixed(2))
  }
  fragment.append(tick)

  const label = createSvgElement('text', 'mission-map-coordinate-label')
  label.setAttribute('x', x.toFixed(2))
  label.setAttribute('y', y.toFixed(2))
  label.setAttribute('text-anchor', anchor)
  label.textContent = text
  fragment.append(label)
}

const appendPath = (fragment, className, coordinates, attributes = {}) => {
  if (coordinates.length < 2) {
    return
  }

  const path = createSvgElement('path', className)
  path.setAttribute('d', coordinates.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(' '))
  Object.entries(attributes).forEach(([name, value]) => {
    path.setAttribute(name, String(value))
  })
  fragment.append(path)
}

// Satellites don't carry a per-asset minimum-elevation setting the way
// ground stations do (that's a ground-station-only configuration field), so
// their visibility circle uses the geometric horizon (0 degrees elevation)
// -- the largest area within which the satellite could theoretically be
// seen above the local horizon at all.
const SATELLITE_FOOTPRINT_ELEVATION_DEGREES = 0

const renderMapOverlay = (
  overlayGroup,
  view,
  width,
  height,
  assets,
  satelliteTracks,
  activeAssetId,
  showGroundStationVisibility,
  showSatelliteVisibility,
  showGroundTracks,
  groundTrackWindowHours,
  renderOptions = {},
) => {
  if (!overlayGroup || width <= 0 || height <= 0) {
    return
  }

  const {
    renderGrid = true,
    renderStatic = true,
    renderSatelliteFootprints = true,
    renderGroundTrackPaths = true,
  } = renderOptions
  const projectPoint = (coordinate) => project(coordinate[0], coordinate[1], view, width, height)
  const toWorldPoint = (coordinate) => ({ x: coordinate[0], y: -coordinate[1] })
  const gridFragment = document.createDocumentFragment()
  const staticFragment = document.createDocumentFragment()
  const satelliteVisibilityFragment = document.createDocumentFragment()
  const groundTrackFragment = document.createDocumentFragment()
  const {
    minimumLongitude,
    maximumLongitude,
    minimumLatitude,
    maximumLatitude,
  } = getVisibleGeographicBounds(view, width, height)

  if (renderGrid) {
    const longitudeValues = getGridValues(
      minimumLongitude,
      maximumLongitude,
      getNiceGridStep(maximumLongitude - minimumLongitude),
    )
    const latitudeValues = getGridValues(
      minimumLatitude,
      maximumLatitude,
      getNiceGridStep(maximumLatitude - minimumLatitude),
    )

    longitudeValues.forEach((longitude) => {
      const start = projectPoint([longitude, minimumLatitude])
      const end = projectPoint([longitude, maximumLatitude])
      appendPath(gridFragment, 'mission-map-coordinate-grid-line', [start, end])
      const x = projectPoint([longitude, 0]).x
      if (x > 34 && x < width - 34) {
        const label = formatGridCoordinate(longitude, 'E', 'W')
        appendGridLabel(gridFragment, label, x, 14, 'middle', 'longitude', 'start')
        appendGridLabel(gridFragment, label, x, height - 5, 'middle', 'longitude', 'end')
      }
    })

    latitudeValues.forEach((latitude) => {
      const start = projectPoint([minimumLongitude, latitude])
      const end = projectPoint([maximumLongitude, latitude])
      appendPath(gridFragment, 'mission-map-coordinate-grid-line', [start, end])
      const y = projectPoint([0, latitude]).y
      if (y > 22 && y < height - 22) {
        const label = formatGridCoordinate(latitude, 'N', 'S')
        appendGridLabel(gridFragment, label, 5, y + 3, 'start', 'latitude', 'start')
        appendGridLabel(gridFragment, label, width - 5, y + 3, 'end', 'latitude', 'end')
      }
    })
  }

  const allSatelliteAssets = assets.filter((asset) => asset.markerType === 'satellite')
  const selectedSatelliteAssets = allSatelliteAssets.filter((asset) => (
    Number.isFinite(asset.altitude)
  ))
  const referenceSatellite = showGroundStationVisibility
    ? (
      selectedSatelliteAssets.find((asset) => asset.id === activeAssetId)
      ?? selectedSatelliteAssets[0]
      ?? null
    )
    : null
  // Stationary reference altitude for the visibility footprint: the orbit's
  // mean altitude across its whole propagated track, not the live altitude
  // at the current playhead time. Using the live value made the footprint
  // circle resize on every timeline tick (and on eccentric orbits, visibly
  // pulse); the track's mean altitude is a stable stand-in for "the orbit
  // height" instead. Falls back to the live altitude if no track is
  // available yet.
  const referenceOrbitAltitudeMeters = showGroundStationVisibility && referenceSatellite
    ? (
      computeMeanTrackAltitudeMeters(satelliteTracks[referenceSatellite.name])
      ?? referenceSatellite.altitude
    )
    : null

  if (renderStatic && showGroundStationVisibility && referenceSatellite && Number.isFinite(referenceOrbitAltitudeMeters)) {
    assets
      .filter((asset) => (
        asset.markerType === 'ground-station'
        && Number.isFinite(asset.minLinkElevation)
      ))
      .forEach((groundStation) => {
        const footprintAngle = calculateElevationFootprintAngle(
          referenceOrbitAltitudeMeters,
          groundStation.minLinkElevation,
          // Correct for Earth's oblateness at the ground station's own
          // latitude instead of assuming a uniform mean-radius sphere (see
          // geocentricEarthRadiusMeters).
          geocentricEarthRadiusMeters(groundStation.latitude),
        )
        const ring = buildGeodesicCircle(
          groundStation.latitude,
          groundStation.longitude,
          footprintAngle,
        )

        const isActiveStation = groundStation.id === activeAssetId
        splitCoordinatesAtAntimeridian(ring)
          .flatMap((segment) => clipPolylineToLatitudeRange(
            segment,
            -MAX_LATITUDE,
            MAX_LATITUDE,
          ))
          .forEach((segment) => {
            appendPath(
              staticFragment,
              isActiveStation
                ? 'mission-map-elevation-footprint mission-map-elevation-footprint--active'
                : 'mission-map-elevation-footprint',
              segment.map(toWorldPoint),
            )
          })
      })
  }

  // Satellite visibility circles: unlike the ground-station footprints
  // above (which stay put -- ground stations don't move), these are
  // "fixed to" each satellite, i.e. re-centered on its current propagated
  // ground-track position every frame so the circle travels along with the
  // marker. The radius still comes from the orbit's mean altitude rather
  // than the live interpolated altitude, for the same reason ground-station
  // footprints do: it keeps the circle a stable size instead of pulsing on
  // every timeline tick for eccentric orbits.
  if (renderSatelliteFootprints && showSatelliteVisibility) {
    selectedSatelliteAssets.forEach((satellite) => {
      const satelliteAltitudeMeters = (
        computeMeanTrackAltitudeMeters(satelliteTracks[satellite.name])
        ?? satellite.altitude
      )

      if (!Number.isFinite(satelliteAltitudeMeters)) {
        return
      }

      const footprintAngle = calculateElevationFootprintAngle(
        satelliteAltitudeMeters,
        SATELLITE_FOOTPRINT_ELEVATION_DEGREES,
        geocentricEarthRadiusMeters(satellite.latitude),
      )
      const ring = buildGeodesicCircle(
        satellite.latitude,
        satellite.longitude,
        footprintAngle,
        SATELLITE_VISIBILITY_POINT_COUNT,
      )

      const isActiveSatellite = satellite.id === activeAssetId
      splitCoordinatesAtAntimeridian(ring)
        .flatMap((segment) => clipPolylineToLatitudeRange(
          segment,
          -MAX_LATITUDE,
          MAX_LATITUDE,
        ))
        .forEach((segment) => {
          appendPath(
            satelliteVisibilityFragment,
            isActiveSatellite
              ? 'mission-map-satellite-footprint mission-map-satellite-footprint--active'
              : 'mission-map-satellite-footprint',
            segment.map(toWorldPoint),
          )
        })
    })
  }

  if (renderGroundTrackPaths && showGroundTracks) {
    allSatelliteAssets.forEach((satellite) => {
      // Center the windowed track on this satellite's own live (interpolated)
      // position timestamp, so each satellite's "current pass" window tracks
      // its own playhead position rather than a single shared reference time.
      const windowedTrack = clipTrackToTimeWindow(
        satelliteTracks[satellite.name],
        satellite.timestamp,
        groundTrackWindowHours,
      )
      const isActiveSatellite = satellite.id === activeAssetId
      const segments = splitTrackAtAntimeridian(windowedTrack)
        .flatMap((segment) => clipPolylineToLatitudeRange(
          segment,
          -MAX_LATITUDE,
          MAX_LATITUDE,
        ))

      segments.forEach((segment) => {
        appendPath(
          groundTrackFragment,
          isActiveSatellite
            ? 'mission-map-track-path mission-map-orbit-path mission-map-orbit-path--active'
            : 'mission-map-track-path mission-map-orbit-path',
          segment.map(toWorldPoint),
        )
      })
    })
  }

  const ensureLayer = (className) => {
    let layer = overlayGroup.querySelector(`:scope > .${className}`)
    if (!layer) {
      layer = createSvgElement('g', className)
      overlayGroup.append(layer)
    }
    return layer
  }

  const gridLayer = ensureLayer('mission-map-overlay-grid')
  const staticLayer = ensureLayer('mission-map-overlay-static')
  const satelliteVisibilityLayer = ensureLayer('mission-map-overlay-dynamic')
  const groundTrackLayer = ensureLayer('mission-map-overlay-ground-tracks')
  const overlayTransform = worldGroupTransform(view, width, height)
  staticLayer.setAttribute('transform', overlayTransform)
  satelliteVisibilityLayer.setAttribute('transform', overlayTransform)
  groundTrackLayer.setAttribute('transform', overlayTransform)
  if (renderGrid) {
    gridLayer.replaceChildren(gridFragment)
  }
  if (renderStatic) {
    staticLayer.replaceChildren(staticFragment)
  }
  if (renderSatelliteFootprints) {
    satelliteVisibilityLayer.replaceChildren(satelliteVisibilityFragment)
  }
  if (renderGroundTrackPaths) {
    groundTrackLayer.replaceChildren(groundTrackFragment)
  }
}

const assetTimestampFormatters = {
  local: new Intl.DateTimeFormat([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
  utc: new Intl.DateTimeFormat([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  }),
}

const formatAssetTimestamp = (value, timeMode) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return '—'
  }

  const formatted = assetTimestampFormatters[timeMode === 'utc' ? 'utc' : 'local'].format(date)
  return `${formatted} ${timeMode === 'local' ? 'Local' : 'UTC'}`
}

const syncAssetPopupContent = (container, asset, timeMode) => {
  const heading = document.createElement('strong')
  heading.className = 'mission-map-popup-name'
  heading.textContent = asset.name.toUpperCase()

  const type = document.createElement('span')
  type.className = 'mission-map-popup-type'
  type.textContent = asset.type

  const details = document.createElement('dl')
  details.className = 'mission-map-popup-grid'
  const appendDetail = (label, value) => {
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    details.append(term, description)
  }

  appendDetail('Latitude', formatCoordinate(asset.latitude, 'N', 'S'))
  appendDetail('Longitude', formatCoordinate(asset.longitude, 'E', 'W'))
  if (asset.markerType === 'ground-station') {
    appendDetail(
      'Min. Elevation',
      Number.isFinite(asset.minLinkElevation)
        ? `${asset.minLinkElevation.toFixed(1)}°`
        : '—',
    )
  } else {
    appendDetail(
      'Altitude',
      Number.isFinite(asset.altitude) ? `${(asset.altitude / 1000).toFixed(1)} km` : '—',
    )
    appendDetail('Track Time', formatAssetTimestamp(asset.timestamp, timeMode))
  }

  container.replaceChildren(heading, type, details)
}

// Positions the popup using the marker's last computed screen coordinates
// (see positionMarkerRecord below) rather than recomputing them from a
// `view` passed in by the caller. This matters because showPopup/hidePopup
// (wired up once, when a marker is first created) close over whatever
// `view` happened to be current at creation time -- if this function were
// called with that captured `view` again later (e.g. from a mouseenter
// handler that fires long after the map has been panned/zoomed), it would
// reposition using stale pan/zoom state. Reading lastX/lastY instead always
// reflects the most recent real render, which runs on every pan/zoom/resize
// regardless of whether a popup is open.
const positionAssetPopup = (markerRecord, containerWidth) => {
  const { lastX: x, lastY: y } = markerRecord
  const popupElement = markerRecord.popup.element
  const showBelow = y < 150
  popupElement.classList.toggle('mission-map-asset-popup--below', showBelow)
  const clampedX = Math.max(105, Math.min(containerWidth - 105, x))
  popupElement.style.left = `${clampedX}px`
  popupElement.style.top = `${showBelow ? y + 15 : y - 15}px`
}

const positionMarkerRecord = (markerRecord, view, width, height) => {
  const longitude = normalizeSignedLongitude(markerRecord.asset.longitude)
  const { x, y } = project(longitude, markerRecord.asset.latitude, view, width, height)
  markerRecord.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`
  markerRecord.lastX = x
  markerRecord.lastY = y

  if (!markerRecord.popup.isOpen) {
    return
  }

  positionAssetPopup(markerRecord, width)
}

const syncAssetMarkers = (
  markersContainer,
  markers,
  assets,
  activeAssetId,
  activeAssetIdRef,
  onSelectAssetRef,
  timeMode,
  view,
  width,
  height,
  getSize,
) => {
  const visibleAssetIds = new Set(assets.map((asset) => asset.id))

  markers.forEach(({ element, popup }, assetId) => {
    if (!visibleAssetIds.has(assetId)) {
      popup.element.remove()
      element.remove()
      markers.delete(assetId)
    }
  })

  assets.forEach((asset) => {
    let markerRecord = markers.get(asset.id)

    if (!markerRecord) {
      const element = document.createElement('button')
      element.type = 'button'
      element.setAttribute('aria-label', `${asset.name} on map`)
      const label = document.createElement('span')
      label.className = 'mission-map-marker-label'
      label.textContent = asset.name
      element.append(label)
      // Clicking an already-selected marker deselects it, mirroring the
      // Visible Assets sidebar card's toggle behavior, instead of always
      // forcing a selection. Reads activeAssetIdRef.current (not the
      // `activeAssetId` parameter above) because this listener is attached
      // once at marker-creation time -- a captured plain value would go
      // stale the moment the selection changes after that, the same class
      // of bug fixed elsewhere in this file via refs.
      element.addEventListener('click', () => {
        const nextAssetId = activeAssetIdRef.current === asset.id ? null : asset.id
        onSelectAssetRef.current(nextAssetId)
      })

      const popupContent = document.createElement('div')
      popupContent.className = 'mission-map-popup-content'
      const popupElement = document.createElement('div')
      popupElement.className = 'mission-map-asset-popup'
      popupElement.append(popupContent)
      const popup = { element: popupElement, isOpen: false }

      markerRecord = { asset, element, popup, popupContent, timeMode }
      const showPopup = () => {
        syncAssetPopupContent(popupContent, markerRecord.asset, markerRecord.timeMode)
        popup.isOpen = true
        markersContainer.append(popupElement)
        // Uses the marker's already-current last-rendered position (see
        // positionAssetPopup) instead of calling positionMarkerRecord with
        // this closure's captured `view`/`width`/`height` -- those are
        // frozen at whatever they were when this marker was first created,
        // which goes stale (and visibly "teleports" the marker) the moment
        // the map is panned or zoomed afterward. getSize() is still called
        // fresh here since container width can change independently of view.
        positionAssetPopup(markerRecord, getSize().width)
      }
      const hidePopup = () => {
        popup.isOpen = false
        popupElement.remove()
      }
      element.addEventListener('mouseenter', showPopup)
      element.addEventListener('mouseleave', hidePopup)
      element.addEventListener('focus', showPopup)
      element.addEventListener('blur', hidePopup)
      markersContainer.append(element)
      markers.set(asset.id, markerRecord)
    }

    markerRecord.asset = asset
    markerRecord.timeMode = timeMode
    markerRecord.element.classList.add('mission-map-marker')
    markerRecord.element.classList.remove(
      'mission-map-marker--ground-station',
      'mission-map-marker--satellite',
    )
    markerRecord.element.classList.add(`mission-map-marker--${asset.markerType}`)
    markerRecord.element.classList.toggle(
      'mission-map-marker--active',
      activeAssetId === asset.id,
    )
    if (markerRecord.popup.isOpen) {
      syncAssetPopupContent(markerRecord.popupContent, asset, timeMode)
    }
    positionMarkerRecord(markerRecord, view, width, height)
  })
}

const MissionMap = memo(forwardRef(function MissionMap({
  assets,
  satelliteTracks,
  activeAssetId,
  onSelectAsset,
  timeMode = 'utc',
  heightPx = 380,
  showGroundStationVisibility = true,
  showSatelliteVisibility = true,
  showGroundTracks = true,
  groundTrackWindowHours = 0,
}, forwardedRef) {
  // Below this height there isn't room for the informational overlays
  // (legend, fit-to-selection buttons, coordinate readout, scale bar, grid
  // labels) without them overlapping each other, so they're hidden while
  // the panel is this short. The zoom/fullscreen controls stay available
  // so a person can still expand the map for full detail.
  const isCompact = heightPx < 140
  const mapShellRef = useRef(null)
  const mapContainerRef = useRef(null)
  const svgRef = useRef(null)
  const worldGroupRef = useRef(null)
  const overlayGroupRef = useRef(null)
  const wheelHintRef = useRef(null)
  const scaleBarRef = useRef(null)
  const viewRef = useRef({ centerLongitude: 0, centerLatitude: 0, zoom: 0 })
  const minZoomRef = useRef(computeFitWorldZoom(1, 1))
  const worldOutlinesRef = useRef([])
  const mapReadyRef = useRef(false)
  const overlayInteractionSnapshotRef = useRef(null)
  const renderFrameRef = useRef(null)
  const lastSatelliteVisibilityRenderRef = useRef(0)
  const lastGroundTrackRenderRef = useRef(0)
  const markersRef = useRef(new Map())
  const assetsRef = useRef(assets)
  const satelliteTracksRef = useRef(satelliteTracks)
  const activeAssetIdRef = useRef(activeAssetId)
  const timeModeRef = useRef(timeMode)
  const onSelectAssetRef = useRef(onSelectAsset)
  const showGroundStationVisibilityRef = useRef(showGroundStationVisibility)
  const showSatelliteVisibilityRef = useRef(showSatelliteVisibility)
  const showGroundTracksRef = useRef(showGroundTracks)
  const groundTrackWindowHoursRef = useRef(groundTrackWindowHours)
  const [mapStatus, setMapStatus] = useState('loading')
  const [worldPaths, setWorldPaths] = useState([])

  useImperativeHandle(forwardedRef, () => ({
    setHeight(nextHeightPx) {
      if (!mapShellRef.current || !Number.isFinite(nextHeightPx)) {
        return
      }
      mapShellRef.current.style.height = `${nextHeightPx}px`
      mapShellRef.current.classList.toggle('mission-map-shell--compact', nextHeightPx < 140)
    },
    setPlayheadTime(timestamp) {
      if (!Number.isFinite(timestamp)) {
        return
      }

      const nextAssets = assetsRef.current.map((asset) => {
        if (asset.markerType !== 'satellite') {
          return asset
        }

        const position = interpolateTrackPosition(
          satelliteTracksRef.current[asset.name],
          timestamp,
        )
        return position ? { ...asset, ...position } : asset
      })
      assetsRef.current = nextAssets
      const now = (typeof performance !== 'undefined' ? performance : Date).now()
      const redrawSatelliteVisibility = (
        showSatelliteVisibilityRef.current
        && now - lastSatelliteVisibilityRenderRef.current >= SATELLITE_VISIBILITY_REDRAW_MS
      )
      const redrawGroundTracks = (
        showGroundTracksRef.current
        && now - lastGroundTrackRenderRef.current >= GROUND_TRACK_REDRAW_MS
      )
      if (redrawSatelliteVisibility) {
        lastSatelliteVisibilityRenderRef.current = now
      }
      if (redrawGroundTracks) {
        lastGroundTrackRenderRef.current = now
      }
      renderFrameRef.current?.({
        renderSatelliteFootprints: redrawSatelliteVisibility,
        renderGroundTrackPaths: redrawGroundTracks,
        markersOnly: !redrawSatelliteVisibility && !redrawGroundTracks,
      })
    },
  }), [])

  // This MUST be useLayoutEffect, not useEffect: the render-triggering
  // effect further below (the one that calls renderFrameRef.current?.() for
  // assets/satelliteTracks/activeAssetId/timeMode) is itself a
  // useLayoutEffect, and layout effects always run before ANY passive
  // effect within the same commit -- regardless of declaration order across
  // effect types. If this ref-sync stayed a plain useEffect, every
  // assets/activeAssetId change would render with the PREVIOUS commit's
  // stale ref values (the passive write hasn't happened yet when the layout
  // effect reads it), permanently lagging the map one selection change
  // behind -- exactly the "select something and it doesn't show up until
  // you deselect it" symptom. Being a layout effect itself and declared
  // before that other layout effect (React runs a component's layout
  // effects in declaration order) guarantees the refs are fresh by the time
  // it reads them.
  useLayoutEffect(() => {
    assetsRef.current = assets
    satelliteTracksRef.current = satelliteTracks
    activeAssetIdRef.current = activeAssetId
    timeModeRef.current = timeMode
    onSelectAssetRef.current = onSelectAsset
    showGroundStationVisibilityRef.current = showGroundStationVisibility
    showSatelliteVisibilityRef.current = showSatelliteVisibility
    showGroundTracksRef.current = showGroundTracks
    groundTrackWindowHoursRef.current = groundTrackWindowHours
  }, [
    activeAssetId,
    assets,
    groundTrackWindowHours,
    onSelectAsset,
    satelliteTracks,
    showGroundStationVisibility,
    showGroundTracks,
    showSatelliteVisibility,
    timeMode,
  ])

  // The visibility-circle/ground-track toggles change rarely (a person
  // flipping a switch), unlike assets/satelliteTracks/activeAssetId/timeMode
  // above which change up to ~60x/second during timeline playback and need
  // the synchronous useLayoutEffect further below to stay paint-ordered. A
  // plain useEffect is fine here: layout effects (including the ref-sync one
  // above) always run before ANY passive effect in the same commit, so by
  // the time this runs, every *Ref.current is already fresh regardless of
  // effect declaration order.
  useEffect(() => {
    if (!mapReadyRef.current) {
      return
    }
    renderFrameRef.current?.()
  }, [showGroundStationVisibility, showSatelliteVisibility, showGroundTracks, groundTrackWindowHours])

  useEffect(() => {
    const controller = new AbortController()
    loadWorldOutlines(WORLD_OUTLINES_URL, { signal: controller.signal })
      .then((paths) => {
        worldOutlinesRef.current = paths
        setWorldPaths(paths)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Failed to load world map outlines.', error)
          setMapStatus('error')
        }
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const container = mapContainerRef.current
    const svg = svgRef.current
    if (!container || !svg || worldPaths.length === 0) {
      return undefined
    }

    const markers = markersRef.current
    const getSize = () => ({
      width: container.clientWidth,
      height: container.clientHeight,
    })

    const renderFrame = ({
      markersOnly = false,
      viewOnly = false,
      renderSatelliteFootprints,
      renderGroundTrackPaths,
    } = {}) => {
      const { width, height } = getSize()
      if (width <= 0 || height <= 0) {
        return
      }

      const view = viewRef.current
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      if (worldGroupRef.current) {
        worldGroupRef.current.setAttribute('transform', worldGroupTransform(view, width, height))
      }
      const overlayTransform = worldGroupTransform(view, width, height)
      overlayGroupRef.current
        ?.querySelector(':scope > .mission-map-overlay-static')
        ?.setAttribute('transform', overlayTransform)
      overlayGroupRef.current
        ?.querySelector(':scope > .mission-map-overlay-dynamic')
        ?.setAttribute('transform', overlayTransform)
      overlayGroupRef.current
        ?.querySelector(':scope > .mission-map-overlay-ground-tracks')
        ?.setAttribute('transform', overlayTransform)

      const overlayData = overlayInteractionSnapshotRef.current ?? {
        assets: assetsRef.current,
        satelliteTracks: satelliteTracksRef.current,
        activeAssetId: activeAssetIdRef.current,
      }
      if (!markersOnly) {
        renderMapOverlay(
          overlayGroupRef.current,
          view,
          width,
          height,
          overlayData.assets,
          overlayData.satelliteTracks,
          overlayData.activeAssetId,
          showGroundStationVisibilityRef.current,
          showSatelliteVisibilityRef.current,
          showGroundTracksRef.current,
          groundTrackWindowHoursRef.current,
          viewOnly
            ? {
              renderGrid: true,
              renderStatic: false,
              renderSatelliteFootprints: false,
              renderGroundTrackPaths: false,
            }
            : renderSatelliteFootprints !== undefined || renderGroundTrackPaths !== undefined
              ? {
                renderGrid: false,
                renderStatic: false,
                renderSatelliteFootprints: Boolean(renderSatelliteFootprints),
                renderGroundTrackPaths: Boolean(renderGroundTrackPaths),
              }
              : undefined,
        )
      }
      syncAssetMarkers(
        container,
        markers,
        overlayData.assets,
        overlayData.activeAssetId,
        activeAssetIdRef,
        onSelectAssetRef,
        timeModeRef.current,
        view,
        width,
        height,
        getSize,
      )

      if (scaleBarRef.current) {
        const metrics = computeScaleBar(view)
        if (metrics) {
          scaleBarRef.current.style.width = `${metrics.widthPx}px`
          scaleBarRef.current.textContent = metrics.label
          scaleBarRef.current.style.visibility = 'visible'
        } else {
          scaleBarRef.current.style.visibility = 'hidden'
        }
      }
    }
    renderFrameRef.current = renderFrame

    let renderQueued = false
    let queuedFullRender = false
    const scheduleRender = ({ full = false } = {}) => {
      queuedFullRender ||= full
      if (renderQueued) {
        return
      }
      renderQueued = true
      window.requestAnimationFrame(() => {
        renderQueued = false
        const renderFullFrame = queuedFullRender
        queuedFullRender = false
        renderFrame(renderFullFrame ? undefined : { viewOnly: true })
      })
    }

    const applyView = (nextView) => {
      const { width, height } = getSize()
      viewRef.current = clampView(nextView, width, height, minZoomRef.current)
      scheduleRender()
    }

    const easeToView = (target, duration = EASE_DURATION_MS) => {
      const { width, height } = getSize()
      const clampedTarget = clampView(target, width, height, minZoomRef.current)
      animateView(viewRef, clampedTarget, duration, scheduleRender)
    }

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = getSize()
      minZoomRef.current = computeFitWorldZoom(width, height)
      applyView(viewRef.current)
    })
    resizeObserver.observe(container)

    // --- Pan / zoom interaction ---------------------------------------
    const activePointers = new Map()
    let interactionMode = null
    let panStart = null
    let pinchStart = null
    // Tracks whether the current single-pointer gesture turns out to be a
    // genuine click (not a pan/drag) that lands on empty map background
    // (not a marker or its popup) -- used to clear the selected asset,
    // mirroring the sidebar card's click-to-toggle. BACKGROUND_CLICK_SLOP_PX
    // tolerates the tiny pointer jitter real clicks always have.
    const BACKGROUND_CLICK_SLOP_PX = 4
    let clickCandidate = null

    const pointerCenter = () => {
      const points = [...activePointers.values()]
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }
    }

    const beginInteractionSnapshot = () => {
      overlayInteractionSnapshotRef.current = {
        assets: assetsRef.current,
        satelliteTracks: satelliteTracksRef.current,
        activeAssetId: activeAssetIdRef.current,
      }
    }

    const endInteractionSnapshot = () => {
      overlayInteractionSnapshotRef.current = null
      scheduleRender({ full: true })
    }

    const recomputeInteractionMode = () => {
      const { width, height } = getSize()
      if (activePointers.size === 1) {
        const [point] = activePointers.values()
        interactionMode = 'pan'
        panStart = { x: point.x, y: point.y, view: { ...viewRef.current } }
        pinchStart = null
      } else if (activePointers.size >= 2) {
        const points = [...activePointers.values()]
        const [first, second] = points
        const distance = Math.hypot(second.x - first.x, second.y - first.y)
        const center = pointerCenter()
        const anchor = unproject(center.x, center.y, viewRef.current, width, height)
        interactionMode = 'pinch'
        pinchStart = {
          distance: Math.max(1, distance),
          anchorLongitude: anchor.longitude,
          anchorLatitude: anchor.latitude,
          view: { ...viewRef.current },
        }
        panStart = null
      } else {
        interactionMode = null
        panStart = null
        pinchStart = null
      }
    }

    const handlePointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }

      container.setPointerCapture(event.pointerId)
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (activePointers.size === 1) {
        beginInteractionSnapshot()
        clickCandidate = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          target: event.target,
        }
      } else {
        // A second pointer joined -- this is a pinch, not a click.
        clickCandidate = null
      }
      recomputeInteractionMode()
    }

    const handlePointerMove = (event) => {
      if (!activePointers.has(event.pointerId)) {
        return
      }
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (
        clickCandidate
        && clickCandidate.pointerId === event.pointerId
        && Math.hypot(
          event.clientX - clickCandidate.startX,
          event.clientY - clickCandidate.startY,
        ) > BACKGROUND_CLICK_SLOP_PX
      ) {
        clickCandidate = null
      }

      const { width, height } = getSize()

      if (interactionMode === 'pan' && panStart) {
        const scale = scaleForZoom(panStart.view.zoom)
        const [point] = activePointers.values()
        applyView({
          centerLongitude: panStart.view.centerLongitude - ((point.x - panStart.x) / scale),
          centerLatitude: panStart.view.centerLatitude + ((point.y - panStart.y) / scale),
          zoom: panStart.view.zoom,
        })
      } else if (interactionMode === 'pinch' && pinchStart) {
        const points = [...activePointers.values()]
        const [first, second] = points
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        const center = pointerCenter()
        const zoom = pinchStart.view.zoom + Math.log2(distance / pinchStart.distance)
        const scale = scaleForZoom(zoom)
        applyView({
          centerLongitude: pinchStart.anchorLongitude - ((center.x - (width / 2)) / scale),
          centerLatitude: pinchStart.anchorLatitude + ((center.y - (height / 2)) / scale),
          zoom,
        })
      }
    }

    const handlePointerUp = (event) => {
      if (!activePointers.has(event.pointerId)) {
        return
      }

      // A genuine click (not a pan/drag, per BACKGROUND_CLICK_SLOP_PX) that
      // lands on empty map background -- not a marker or its popup, which
      // handle their own selection -- clears the current selection. This is
      // the map-side counterpart to clicking an already-active sidebar card
      // or marker to deselect it. Uses clickCandidate.target (captured at
      // pointerdown) rather than this event's own target: container.
      // setPointerCapture() during pointerdown retargets every later
      // pointer event for that pointerId to the capturing element itself
      // (container), so event.target here would always be container --
      // never the marker actually under the cursor.
      if (
        clickCandidate
        && clickCandidate.pointerId === event.pointerId
        && !clickCandidate.target?.closest?.('.mission-map-marker, .mission-map-asset-popup')
      ) {
        onSelectAssetRef.current(null)
      }
      clickCandidate = null

      activePointers.delete(event.pointerId)
      if (container.hasPointerCapture?.(event.pointerId)) {
        container.releasePointerCapture(event.pointerId)
      }
      recomputeInteractionMode()
      if (activePointers.size === 0) {
        endInteractionSnapshot()
      }
    }

    let wheelHintTimeoutId = null

    const zoomAroundPoint = (screenX, screenY, zoomDelta, duration = 0) => {
      const { width, height } = getSize()
      const currentView = viewRef.current
      const anchor = unproject(screenX, screenY, currentView, width, height)
      const targetZoom = currentView.zoom + zoomDelta
      const targetScale = scaleForZoom(targetZoom)
      const targetView = {
        centerLongitude: anchor.longitude - ((screenX - (width / 2)) / targetScale),
        centerLatitude: anchor.latitude + ((screenY - (height / 2)) / targetScale),
        zoom: targetZoom,
      }

      if (duration > 0) {
        easeToView(targetView, duration)
      } else {
        applyView(targetView)
      }
    }

    // Only treat the wheel gesture as map-zoom when a modifier key is held
    // (event.ctrlKey is also what browsers set automatically for a trackpad
    // pinch gesture) or ordinary metaKey+wheel on a mouse. Plain wheel
    // scrolling is left alone so the page can still scroll normally while
    // the cursor happens to be over the map -- otherwise a large map panel
    // traps every scroll gesture that passes over it. Dedicated zoom
    // in/out buttons remain available regardless.
    const handleWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        if (wheelHintRef.current) {
          wheelHintRef.current.classList.add('mission-map-wheel-hint--visible')
          window.clearTimeout(wheelHintTimeoutId)
          wheelHintTimeoutId = window.setTimeout(() => {
            wheelHintRef.current?.classList.remove('mission-map-wheel-hint--visible')
          }, 1400)
        }
        return
      }
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      const direction = event.deltaY > 0 ? -1 : 1
      zoomAroundPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        direction * WHEEL_ZOOM_STEP,
      )
    }

    const handleDoubleClick = (event) => {
      const rect = container.getBoundingClientRect()
      zoomAroundPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        BUTTON_ZOOM_STEP,
        EASE_DURATION_MS,
      )
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerup', handlePointerUp)
    container.addEventListener('pointercancel', handlePointerUp)
    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('dblclick', handleDoubleClick)

    // Expose imperative handles used by the fit / zoom / fullscreen buttons.
    container.__missionMapControls = {
      applyView,
      easeToView,
      zoomAroundPoint,
      getSize,
      getMinZoom: () => minZoomRef.current,
    }

    const { width: initialWidth, height: initialHeight } = getSize()
    minZoomRef.current = computeFitWorldZoom(initialWidth, initialHeight)
    viewRef.current = clampView(
      { centerLongitude: 0, centerLatitude: 0, zoom: minZoomRef.current },
      initialWidth,
      initialHeight,
      minZoomRef.current,
    )
    mapReadyRef.current = true
    setMapStatus('ready')
    renderFrame()

    return () => {
      window.clearTimeout(wheelHintTimeoutId)
      resizeObserver.disconnect()
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerup', handlePointerUp)
      container.removeEventListener('pointercancel', handlePointerUp)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('dblclick', handleDoubleClick)
      renderFrameRef.current = null
      markers.forEach(({ element, popup }) => {
        popup.element.remove()
        element.remove()
      })
      markers.clear()
      overlayInteractionSnapshotRef.current = null
      mapReadyRef.current = false
    }
  }, [worldPaths])

  // useLayoutEffect (not useEffect) is required here: this does the actual
  // imperative DOM write for marker/overlay positions on every React asset
  // update. Playback frames use setPlayheadTime above and avoid React commits;
  // this effect keeps ordinary selection/data commits synchronous with paint.
  useLayoutEffect(() => {
    if (!mapReadyRef.current) {
      return
    }
    renderFrameRef.current?.()
  }, [activeAssetId, assets, satelliteTracks, timeMode])

  const handleShowWorld = () => {
    const controls = mapContainerRef.current?.__missionMapControls
    if (!controls || !mapReadyRef.current) {
      return
    }
    const { width, height } = controls.getSize()
    const minZoom = computeFitWorldZoom(width, height)
    controls.easeToView({ centerLongitude: 0, centerLatitude: 0, zoom: minZoom })
  }

  const handleFitSelectedAssets = () => {
    const controls = mapContainerRef.current?.__missionMapControls
    if (!controls || !mapReadyRef.current) {
      return
    }

    if (assets.length === 0) {
      handleShowWorld()
      return
    }

    const { width, height } = controls.getSize()

    if (assets.length === 1) {
      const [asset] = assets
      controls.easeToView({
        centerLongitude: normalizeSignedLongitude(asset.longitude),
        centerLatitude: asset.latitude,
        zoom: asset.markerType === 'ground-station' ? 6 : 4,
      })
      return
    }

    const longitudes = assets.map((asset) => normalizeSignedLongitude(asset.longitude))
    const latitudes = assets.map((asset) => asset.latitude)
    const target = computeFitBoundsView(
      {
        minLongitude: Math.min(...longitudes),
        maxLongitude: Math.max(...longitudes),
        minLatitude: Math.min(...latitudes),
        maxLatitude: Math.max(...latitudes),
      },
      width,
      height,
      { padding: { top: 70, right: 110, bottom: 70, left: 70 }, maxZoom: 6.5, minZoom: controls.getMinZoom() },
    )
    controls.easeToView(target)
  }

  const handleZoomBy = (delta) => {
    const controls = mapContainerRef.current?.__missionMapControls
    if (!controls || !mapReadyRef.current) {
      return
    }
    const { width, height } = controls.getSize()
    controls.zoomAroundPoint(width / 2, height / 2, delta, EASE_DURATION_MS)
  }

  const handleToggleFullscreen = () => {
    if (!mapShellRef.current) {
      return
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      mapShellRef.current.requestFullscreen?.()
    }
  }

  const selectedSatelliteAssets = assets.filter((asset) => (
    asset.markerType === 'satellite'
    && Number.isFinite(asset.altitude)
  ))
  const coverageReferenceSatellite = (
    selectedSatelliteAssets.find((asset) => asset.id === activeAssetId)
    ?? selectedSatelliteAssets[0]
    ?? null
  )
  const hasPropagatedOrbit = Boolean(
    showGroundTracks
    && selectedSatelliteAssets.some((asset) => (
      (satelliteTracks[asset.name] ?? []).length >= 2
    )),
  )
  const hasElevationFootprint = Boolean(
    showGroundStationVisibility
    && coverageReferenceSatellite
    && assets.some((asset) => (
      asset.markerType === 'ground-station'
      && Number.isFinite(asset.minLinkElevation)
    )),
  )
  const hasSatelliteFootprint = Boolean(
    showSatelliteVisibility
    && selectedSatelliteAssets.length > 0,
  )

  return (
    <div
      ref={mapShellRef}
      className={`mission-map-shell${isCompact ? ' mission-map-shell--compact' : ''}`}
      style={{ height: `${heightPx}px` }}
    >
      <div
        ref={mapContainerRef}
        className="mission-map"
        aria-label="Interactive equirectangular map of selected mission assets"
      >
        <svg ref={svgRef} className="mission-map-canvas" aria-hidden="true">
          <g ref={worldGroupRef}>
            {worldPaths.map((path) => (
              <path key={path.id ?? path.d} className="mission-map-world-outline" d={path.d} />
            ))}
          </g>
          <g ref={overlayGroupRef} />
        </svg>
      </div>
      <span
        ref={wheelHintRef}
        className="mission-map-wheel-hint"
        aria-hidden="true"
      >
        Hold Ctrl (⌘ on Mac) + scroll to zoom the map
      </span>
      <div className="mission-map-fit-controls">
        <button
          type="button"
          className="mission-map-fit-control"
          onClick={handleShowWorld}
          disabled={mapStatus !== 'ready'}
        >
          Show whole world
        </button>
        <button
          type="button"
          className="mission-map-fit-control"
          onClick={handleFitSelectedAssets}
          disabled={mapStatus !== 'ready' || assets.length === 0}
        >
          Fit selected
        </button>
      </div>
      <div className="mission-map-navigation-controls" role="group" aria-label="Zoom controls">
        <button
          type="button"
          className="mission-map-nav-control"
          onClick={() => handleZoomBy(BUTTON_ZOOM_STEP)}
          disabled={mapStatus !== 'ready'}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="mission-map-nav-control"
          onClick={() => handleZoomBy(-BUTTON_ZOOM_STEP)}
          disabled={mapStatus !== 'ready'}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="mission-map-nav-control"
          onClick={handleToggleFullscreen}
          disabled={mapStatus !== 'ready'}
          aria-label="Toggle fullscreen"
        >
          ⛶
        </button>
      </div>
      <div ref={scaleBarRef} className="mission-map-scale-bar" aria-hidden="true" />
      <span className="mission-map-attribution">World outlines: Natural Earth</span>
      {mapStatus === 'ready' && (hasPropagatedOrbit || hasElevationFootprint || hasSatelliteFootprint) && (
        <div className="mission-map-legend" aria-label="Map overlay legend">
          {hasPropagatedOrbit && (
            <span className="mission-map-legend-item">
              <span className="mission-map-legend-line" aria-hidden="true"></span>
              Propagated orbit
            </span>
          )}
          {hasElevationFootprint && (
            <span className="mission-map-legend-item">
              <span className="mission-map-legend-circle" aria-hidden="true"></span>
              Ground station visibility
            </span>
          )}
          {hasSatelliteFootprint && (
            <span className="mission-map-legend-item">
              <span className="mission-map-legend-circle mission-map-legend-circle--satellite" aria-hidden="true"></span>
              Satellite visibility
            </span>
          )}
        </div>
      )}
      {mapStatus === 'loading' && (
        <div className="mission-map-state" role="status">Loading map...</div>
      )}
      {mapStatus === 'error' && (
        <div className="mission-map-state mission-map-state--error" role="alert">
          Map outlines could not be loaded.
        </div>
      )}
      {mapStatus === 'ready' && assets.length === 0 && (
        <div className="mission-map-state mission-map-state--empty">
          Select a ground station or propagate a satellite to show it on the map.
        </div>
      )}
    </div>
  )
}))

export default MissionMap
