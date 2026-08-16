// World outlines are shipped as pre-built SVG path strings (produced by
// `npm run build:world-outlines`, see scripts/build-world-outlines.mjs),
// defined in "world space" (x = longitude, y = -latitude). Because the
// equirectangular projection is a pure affine transform, these paths are
// positioned entirely through the SVG `transform` attribute on their parent
// group -- see equirectangularProjection.worldGroupTransform.
//
// The paths are pre-cut at the +-180 degree antimeridian (and, for
// pole-enclosing landmasses like Antarctica, correctly closed along the
// pole edge) using d3-geo at data-prep time. Building this client-side from
// raw GeoJSON rings without that cut is what previously drew a straight
// line clear across the map for any country whose ring coordinates cross
// +-180 within a single ring (Russia, Fiji, the Aleutians, ...) -- do not
// reintroduce a naive ring-to-path conversion here.

const isValidOutlinePath = (path) => (
  Boolean(path) && typeof path.d === 'string' && path.d.length > 0
)

export const parseWorldOutlines = (data) => (
  (data?.paths ?? []).filter(isValidOutlinePath)
)

export const loadWorldOutlines = async (url, { signal } = {}) => {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Failed to load world map outlines (${response.status})`)
  }

  const data = await response.json()
  return parseWorldOutlines(data)
}
