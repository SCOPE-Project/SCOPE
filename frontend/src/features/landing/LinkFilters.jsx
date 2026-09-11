import { memo } from 'react'

const LinkFilters = memo(function LinkFilters({
  disabled,
  linkFiltersValid,
  minimumLinkElevationFilterDeg,
  minimumPeakElevationFilterDeg,
  setMinimumLinkElevationFilterDeg,
  setMinimumPeakElevationFilterDeg,
}) {
  return (
      <div className="filter-grid">
        <label className="filter-field">
          <span>Minimum Link Elevation</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0"
              max="90"
              step="0.1"
              inputMode="decimal"
              placeholder="Optional"
              value={minimumLinkElevationFilterDeg}
              disabled={disabled}
              onChange={(event) => setMinimumLinkElevationFilterDeg(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">°</span>
          </div>
        </label>
        <label className="filter-field">
          <span>Minimum Peak Elevation</span>
          <div className="filter-input-shell">
            <input
              type="number"
              min="0"
              max="90"
              step="0.1"
              inputMode="decimal"
              placeholder="Optional"
              value={minimumPeakElevationFilterDeg}
              disabled={disabled}
              onChange={(event) => setMinimumPeakElevationFilterDeg(event.target.value)}
              className="filter-input"
            />
            <span className="filter-input-unit">°</span>
          </div>
        </label>
        {!linkFiltersValid && (
          <p className="filter-error">
            Optional filter values must stay between 0° and 90°.
          </p>
        )}
      </div>
  )
})

export default LinkFilters
