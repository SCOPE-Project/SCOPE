#!/usr/bin/env node
// Regenerates public/world/countries-110m.json, the pre-built world outline
// layer used by the mission map's equirectangular base map.
//
// Why this is pre-built instead of shipping raw GeoJSON to the browser:
// country polygons that cross the +-180 degree antimeridian (Russia, Fiji,
// the Aleutian tail of the USA, ...) or wrap around a pole (Antarctica)
// need proper geometric clipping/closing to render correctly on a flat
// map. Doing that by naively connecting raw ring coordinates draws a
// straight line clear across the map for any such country. d3-geo's
// antimeridian clipping (used here via geoPath) already solves this
// correctly, so we run it once at build time and ship plain, ready-to-draw
// SVG path strings -- no geometry library needed at runtime.
//
// Run with: npm run build:world-outlines

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const worldAtlasPath = path.resolve(
  projectRoot,
  'node_modules/world-atlas/countries-110m.json',
)
const outputPath = path.resolve(
  projectRoot,
  'public/world/countries-110m.json',
)
// Round source coordinates to ~1km precision -- matches the 110m
// (1:110,000,000) resolution of the source data, so this discards no real
// detail while keeping the shipped file small.
const COORDINATE_PRECISION = 2

const roundRing = (ring) => ring.map(([lon, lat]) => [
  Math.round(lon * (10 ** COORDINATE_PRECISION)) / (10 ** COORDINATE_PRECISION),
  Math.round(lat * (10 ** COORDINATE_PRECISION)) / (10 ** COORDINATE_PRECISION),
])

const roundGeometry = (geometry) => {
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(roundRing) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((polygon) => polygon.map(roundRing)) }
  }
  return geometry
}

const world = JSON.parse(fs.readFileSync(worldAtlasPath, 'utf8'))
const countries = feature(world, world.objects.countries)

// World-space convention used by the frontend: x = longitude (degrees),
// y = -latitude (degrees), so the static SVG layer can be repositioned for
// pan/zoom with a single `transform` attribute (see
// equirectangularProjection.worldGroupTransform). geoEquirectangular's raw
// projection is [lambda, phi] in radians; scale=180/PI converts to degrees,
// and the y-axis is negated by d3 to match screen conventions (north up).
const projection = geoEquirectangular()
  .scale(180 / Math.PI)
  .translate([0, 0])
  .rotate([0, 0])
  .precision(0.1)

const pathGenerator = geoPath(projection).digits(COORDINATE_PRECISION)

const paths = countries.features
  .map((feature_) => ({
    id: feature_.properties?.name ?? null,
    d: pathGenerator({ ...feature_, geometry: roundGeometry(feature_.geometry) }),
  }))
  .filter((path) => typeof path.d === 'string' && path.d.length > 0)

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify({ paths }))

console.log(`Wrote ${paths.length} country outlines to ${path.relative(projectRoot, outputPath)}`)
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`)
