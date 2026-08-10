import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import { MaptoolkitLogoControl } from '@maptoolkit/maplibre-gl-logo'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  buildGeodesicCircle,
  calculateElevationFootprintAngle,
  clipPolylineToLatitudeRange,
  splitCoordinatesAtAntimeridian,
  splitTrackAtAntimeridian,
} from './mapGeometry.js'

const MAPTOOLKIT_STYLE_URL = (
  import.meta.env.VITE_MAPTOOLKIT_STYLE_URL?.trim()
  || 'https://styles.maptoolkit.org/summer.json'
)
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const MAX_MERCATOR_LATITUDE = 85.05112878
const MIN_MAP_ZOOM = -1.2

const fitMapToGlobe = (map, animate = true) => {
  const container = map.getContainer()
  const availableSize = Math.max(
    1,
    Math.min(container.clientWidth, container.clientHeight) - 40,
  )
  const globeZoom = Math.max(
    map.getMinZoom(),
    Math.min(0, Math.log2(availableSize / 512)),
  )

  map.easeTo({
    center: [0, 0],
    zoom: globeZoom,
    bearing: 0,
    pitch: 0,
    duration: animate ? 650 : 0,
  })
}

const fitMapToAssets = (map, assets, animate = true) => {
  if (assets.length === 0) {
    fitMapToGlobe(map, animate)
    return
  }

  if (assets.length === 1) {
    map.easeTo({
      center: [assets[0].longitude, assets[0].latitude],
      zoom: assets[0].markerType === 'ground-station' ? 4 : 2.8,
      duration: animate ? 600 : 0,
    })
    return
  }

  const longitudes = assets.map((asset) => asset.longitude)
  const minLongitude = Math.min(...longitudes)
  const maxLongitude = Math.max(...longitudes)
  const latitudes = assets.map((asset) => asset.latitude)

  map.fitBounds(
    [
      [minLongitude, Math.min(...latitudes)],
      [maxLongitude, Math.max(...latitudes)],
    ],
    {
      padding: { top: 70, right: 110, bottom: 70, left: 70 },
      maxZoom: 4.5,
      duration: animate ? 650 : 0,
    },
  )
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

const latitudeToMercatorY = (latitude) => {
  const latitudeRadians = latitude * Math.PI / 180
  return (
    1
    - (Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI)
  ) / 2
}

const mercatorYToLatitude = (mercatorY) => (
  Math.atan(Math.sinh(Math.PI * (1 - (2 * mercatorY)))) * 180 / Math.PI
)

const getVisibleGeographicBounds = (map, width, height) => {
  const center = map.getCenter()
  const worldSize = 512 * (2 ** map.getZoom())
  const longitudeHalfSpan = (width / 2) * 360 / worldSize
  const centerMercatorY = latitudeToMercatorY(center.lat)
  const mercatorYHalfSpan = (height / 2) / worldSize

  return {
    minimumLongitude: Math.max(-180, center.lng - longitudeHalfSpan),
    maximumLongitude: Math.min(180, center.lng + longitudeHalfSpan),
    minimumLatitude: Math.max(
      -MAX_MERCATOR_LATITUDE,
      mercatorYToLatitude(centerMercatorY + mercatorYHalfSpan),
    ),
    maximumLatitude: Math.min(
      MAX_MERCATOR_LATITUDE,
      mercatorYToLatitude(centerMercatorY - mercatorYHalfSpan),
    ),
  }
}

const createSvgElement = (name, className) => {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  element.setAttribute('class', className)
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

const renderMapOverlays = (map, overlay, assets, satelliteTracks, activeAssetId) => {
  if (!overlay) {
    return
  }

  const width = map.getContainer().clientWidth
  const height = map.getContainer().clientHeight
  if (width <= 0 || height <= 0) {
    return
  }
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const fragment = document.createDocumentFragment()
  const {
    minimumLongitude,
    maximumLongitude,
    minimumLatitude,
    maximumLatitude,
  } = getVisibleGeographicBounds(map, width, height)
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
    const start = map.project([longitude, minimumLatitude])
    const end = map.project([longitude, maximumLatitude])
    appendPath(
      fragment,
      'mission-map-coordinate-grid-line',
      [start, end],
      {
        'data-coordinate-axis': 'longitude',
        'data-coordinate-degrees': longitude,
      },
    )
    const x = map.project([longitude, 0]).x
    if (x > 34 && x < width - 34) {
      const label = formatGridCoordinate(longitude, 'E', 'W')
      appendGridLabel(fragment, label, x, 14, 'middle', 'longitude', 'start')
      appendGridLabel(fragment, label, x, height - 5, 'middle', 'longitude', 'end')
    }
  })

  latitudeValues.forEach((latitude) => {
    const start = map.project([minimumLongitude, latitude])
    const end = map.project([maximumLongitude, latitude])
    appendPath(
      fragment,
      'mission-map-coordinate-grid-line',
      [start, end],
      {
        'data-coordinate-axis': 'latitude',
        'data-coordinate-degrees': latitude,
      },
    )
    const y = map.project([0, latitude]).y
    if (y > 22 && y < height - 22) {
      const label = formatGridCoordinate(latitude, 'N', 'S')
      appendGridLabel(fragment, label, 5, y + 3, 'start', 'latitude', 'start')
      appendGridLabel(fragment, label, width - 5, y + 3, 'end', 'latitude', 'end')
    }
  })
  const selectedSatelliteNames = assets
    .filter((asset) => asset.markerType === 'satellite')
    .map((asset) => asset.name)
  const selectedSatelliteAssets = assets.filter((asset) => (
    asset.markerType === 'satellite'
    && Number.isFinite(asset.altitude)
  ))
  const referenceSatellite = (
    selectedSatelliteAssets.find((asset) => asset.id === activeAssetId)
    ?? selectedSatelliteAssets[0]
    ?? null
  )

  if (referenceSatellite) {
    assets
      .filter((asset) => (
        asset.markerType === 'ground-station'
        && Number.isFinite(asset.minLinkElevation)
      ))
      .forEach((groundStation) => {
        const footprintAngle = calculateElevationFootprintAngle(
          referenceSatellite.altitude,
          groundStation.minLinkElevation,
        )
        const ring = buildGeodesicCircle(
          groundStation.latitude,
          groundStation.longitude,
          footprintAngle,
        )

        if (ring.length === 0) {
          return
        }

        splitCoordinatesAtAntimeridian(ring)
          .flatMap((segment) => clipPolylineToLatitudeRange(
            segment,
            -MAX_MERCATOR_LATITUDE,
            MAX_MERCATOR_LATITUDE,
          ))
          .forEach((segment) => {
            appendPath(
              fragment,
              'mission-map-elevation-footprint',
              segment.map((coordinate) => map.project(coordinate)),
              {
                'data-ground-station': groundStation.name,
                'data-minimum-elevation': groundStation.minLinkElevation,
                'data-reference-satellite': referenceSatellite.name,
              },
            )
          })
      })
  }

  selectedSatelliteNames.forEach((satelliteName) => {
    const segments = splitTrackAtAntimeridian(satelliteTracks[satelliteName] ?? [])
      .flatMap((segment) => clipPolylineToLatitudeRange(
        segment,
        -MAX_MERCATOR_LATITUDE,
        MAX_MERCATOR_LATITUDE,
      ))

    segments.forEach((segment) => {
      appendPath(
        fragment,
        'mission-map-track-path mission-map-orbit-path',
        segment.map((coordinate) => map.project(coordinate)),
        { 'data-satellite': satelliteName },
      )
    })
  })

  overlay.replaceChildren(fragment)
}

const formatAssetTimestamp = (value, timeMode) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return '—'
  }

  const formatted = new Intl.DateTimeFormat([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(timeMode === 'utc' ? { timeZone: 'UTC' } : {}),
  }).format(date)
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

const syncAssetMarkers = (
  map,
  markers,
  assets,
  activeAssetId,
  onSelectAssetRef,
  timeMode,
) => {
  const visibleAssetIds = new Set(assets.map((asset) => asset.id))

  markers.forEach(({ marker, popup }, assetId) => {
    if (!visibleAssetIds.has(assetId)) {
      popup.remove()
      marker.remove()
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
      element.addEventListener('click', () => onSelectAssetRef.current(asset.id))

      const popupContent = document.createElement('div')
      popupContent.className = 'mission-map-popup-content'
      const popup = new maplibregl.Popup({
        className: 'mission-map-asset-popup',
        closeButton: false,
        closeOnClick: false,
        offset: 15,
      })
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([asset.longitude, asset.latitude])
        .addTo(map)
      markerRecord = { asset, element, marker, popup, popupContent, timeMode }
      const showPopup = () => {
        syncAssetPopupContent(
          markerRecord.popupContent,
          markerRecord.asset,
          markerRecord.timeMode,
        )
        markerRecord.popup
          .setLngLat(markerRecord.marker.getLngLat())
          .setDOMContent(markerRecord.popupContent)
          .addTo(map)
      }
      const hidePopup = () => markerRecord.popup.remove()
      element.addEventListener('mouseenter', showPopup)
      element.addEventListener('mouseleave', hidePopup)
      element.addEventListener('focus', showPopup)
      element.addEventListener('blur', hidePopup)
      markers.set(asset.id, markerRecord)
    }

    markerRecord.asset = asset
    markerRecord.timeMode = timeMode
    markerRecord.marker.setLngLat([asset.longitude, asset.latitude])
    if (markerRecord.popup.isOpen()) {
      markerRecord.popup.setLngLat([asset.longitude, asset.latitude])
      syncAssetPopupContent(markerRecord.popupContent, asset, timeMode)
    }
    markerRecord.element.classList.add('maplibregl-marker', 'mission-map-marker')
    markerRecord.element.classList.remove(
      'mission-map-marker--ground-station',
      'mission-map-marker--satellite',
    )
    markerRecord.element.classList.add(`mission-map-marker--${asset.markerType}`)
    markerRecord.element.classList.toggle(
      'mission-map-marker--active',
      activeAssetId === asset.id,
    )
  })
}

export default function MissionMap({
  assets,
  satelliteTracks,
  activeAssetId,
  onSelectAsset,
  timeMode = 'utc',
}) {
  const mapContainerRef = useRef(null)
  const trackOverlayRef = useRef(null)
  const coordinateReadoutRef = useRef(null)
  const mapRef = useRef(null)
  const mapReadyRef = useRef(false)
  const mapDragActiveRef = useRef(false)
  const markersRef = useRef(new Map())
  const assetsRef = useRef(assets)
  const satelliteTracksRef = useRef(satelliteTracks)
  const activeAssetIdRef = useRef(activeAssetId)
  const timeModeRef = useRef(timeMode)
  const onSelectAssetRef = useRef(onSelectAsset)
  const previousAssetIdsRef = useRef('')
  const [mapStatus, setMapStatus] = useState('loading')

  useEffect(() => {
    assetsRef.current = assets
    satelliteTracksRef.current = satelliteTracks
    activeAssetIdRef.current = activeAssetId
    timeModeRef.current = timeMode
    onSelectAssetRef.current = onSelectAsset
  }, [activeAssetId, assets, onSelectAsset, satelliteTracks, timeMode])

  useEffect(() => {
    if (!mapContainerRef.current) {
      return undefined
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAPTOOLKIT_STYLE_URL,
      center: [0, 0],
      zoom: -0.5,
      minZoom: MIN_MAP_ZOOM,
      renderWorldCopies: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      attributionControl: { compact: true },
    })
    const markers = markersRef.current
    const renderTracks = () => {
      if (mapDragActiveRef.current) {
        return
      }

      renderMapOverlays(
        map,
        trackOverlayRef.current,
        assetsRef.current,
        satelliteTracksRef.current,
        activeAssetIdRef.current,
      )
    }

    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-right')
    map.addControl(new MaptoolkitLogoControl({ position: 'bottom-left' }))
    map.on('move', renderTracks)
    map.on('resize', renderTracks)
    map.on('dragstart', () => {
      mapDragActiveRef.current = true
    })
    map.on('dragend', () => {
      mapDragActiveRef.current = false
      renderTracks()
    })

    map.once('style.load', () => {
      mapReadyRef.current = true
      syncAssetMarkers(
        map,
        markers,
        assetsRef.current,
        activeAssetIdRef.current,
        onSelectAssetRef,
        timeModeRef.current,
      )
      renderTracks()
      fitMapToAssets(map, assetsRef.current, false)
      previousAssetIdsRef.current = assetsRef.current.map((asset) => asset.id).sort().join('|')
      setMapStatus('ready')
    })

    map.on('error', (event) => {
      if (!mapReadyRef.current) {
        console.error('MapLibre failed to load the Maptoolkit style.', event.error)
        setMapStatus('error')
      }
    })
    map.on('mousemove', (event) => {
      if (coordinateReadoutRef.current) {
        coordinateReadoutRef.current.textContent = [
          `Lat ${formatCoordinate(event.lngLat.lat, 'N', 'S', 4)}`,
          `Lon ${formatCoordinate(event.lngLat.lng, 'E', 'W', 4)}`,
        ].join(' · ')
      }
    })
    map.on('mouseout', () => {
      if (coordinateReadoutRef.current) {
        coordinateReadoutRef.current.textContent = 'Move the crosshair over the map'
      }
    })

    return () => {
      markers.forEach(({ marker, popup }) => {
        popup.remove()
        marker.remove()
      })
      markers.clear()
      mapDragActiveRef.current = false
      mapReadyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) {
      return
    }

    syncAssetMarkers(
      map,
      markersRef.current,
      assets,
      activeAssetId,
      onSelectAssetRef,
      timeMode,
    )
    if (!mapDragActiveRef.current) {
      renderMapOverlays(
        map,
        trackOverlayRef.current,
        assets,
        satelliteTracks,
        activeAssetId,
      )
    }

    const assetIds = assets.map((asset) => asset.id).sort().join('|')
    if (assetIds !== previousAssetIdsRef.current) {
      fitMapToAssets(map, assets)
      previousAssetIdsRef.current = assetIds
    }
  }, [activeAssetId, assets, satelliteTracks, timeMode])

  const handleFitSelectedAssets = () => {
    if (mapRef.current && mapReadyRef.current) {
      fitMapToAssets(mapRef.current, assets)
    }
  }

  const handleShowGlobe = () => {
    if (mapRef.current && mapReadyRef.current) {
      fitMapToGlobe(mapRef.current)
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
  const hasPropagatedOrbit = selectedSatelliteAssets.some((asset) => (
    (satelliteTracks[asset.name] ?? []).length >= 2
  ))
  const hasElevationFootprint = Boolean(
    coverageReferenceSatellite
    && assets.some((asset) => (
      asset.markerType === 'ground-station'
      && Number.isFinite(asset.minLinkElevation)
    )),
  )

  return (
    <div className="mission-map-shell">
      <div
        ref={mapContainerRef}
        className="mission-map"
        aria-label="Interactive map of selected mission assets"
      />
      <svg
        ref={trackOverlayRef}
        className="mission-map-track-overlay"
        aria-hidden="true"
      />
      <output
        ref={coordinateReadoutRef}
        className="mission-map-coordinate-readout"
        aria-label="Map cursor coordinates"
      >
        Move the crosshair over the map
      </output>
      <div className="mission-map-fit-controls">
        <button
          type="button"
          className="mission-map-fit-control"
          onClick={handleShowGlobe}
          disabled={mapStatus !== 'ready'}
        >
          Show globe
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
      {mapStatus === 'ready' && (hasPropagatedOrbit || hasElevationFootprint) && (
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
              Min. elevation footprint ({coverageReferenceSatellite.name})
            </span>
          )}
        </div>
      )}
      {mapStatus === 'loading' && (
        <div className="mission-map-state" role="status">Loading map...</div>
      )}
      {mapStatus === 'error' && (
        <div className="mission-map-state mission-map-state--error" role="alert">
          Map tiles could not be loaded. Check the Maptoolkit connection.
        </div>
      )}
      {mapStatus === 'ready' && assets.length === 0 && (
        <div className="mission-map-state mission-map-state--empty">
          Select a ground station or propagate a satellite to show it on the map.
        </div>
      )}
    </div>
  )
}
