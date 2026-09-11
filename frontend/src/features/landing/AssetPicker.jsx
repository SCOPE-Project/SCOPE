import { memo } from 'react'

const AssetPicker = memo(function AssetPicker({
  configDisabled,
  expandedSections,
  renderGroundStationOptionsContent,
  renderSatelliteOptionsContent,
  renderSectionChevron,
  renderUnavailableAssetsContent,
  toggleSection,
}) {
  return (
      <div className="landing-assets-panel">
        <div className="landing-assets-group">
          <button
            type="button"
            className="section-toggle"
            onClick={() => toggleSection('satellites')}
            disabled={configDisabled}
          >
            <span>Satellites</span>
            <span className="section-toggle-icon" aria-hidden="true">
              {renderSectionChevron(expandedSections.satellites)}
            </span>
          </button>
          {expandedSections.satellites && renderSatelliteOptionsContent(configDisabled)}
        </div>
        <div className="landing-assets-group">
          <button
            type="button"
            className="section-toggle"
            onClick={() => toggleSection('groundStations')}
            disabled={configDisabled}
          >
            <span>Ground Stations</span>
            <span className="section-toggle-icon" aria-hidden="true">
              {renderSectionChevron(expandedSections.groundStations)}
            </span>
          </button>
          {expandedSections.groundStations && renderGroundStationOptionsContent(configDisabled)}
        </div>
        <div className="landing-assets-group">
          <button
            type="button"
            className="section-toggle"
            onClick={() => toggleSection('unavailableAssets')}
            disabled={configDisabled}
          >
            <span>Unavailable Assets</span>
            <span className="section-toggle-icon" aria-hidden="true">
              {renderSectionChevron(expandedSections.unavailableAssets)}
            </span>
          </button>
          {expandedSections.unavailableAssets && renderUnavailableAssetsContent(configDisabled)}
        </div>
      </div>
  )
})

export default AssetPicker
