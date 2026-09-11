import { memo } from 'react'

import { getAssetWarningMessage } from '../../domain/assets.js'

const SatelliteOptions = memo(function SatelliteOptions({
  configDisabled,
  renderAssetWarning,
  satelliteAssets,
  selectedSatellites,
  toggleSatellite,
}) {
  return (
      <div className="checkbox-list">
        {satelliteAssets.map((asset) => (
          (() => {
            const warningMessage = getAssetWarningMessage(asset)

            return (
          <label
            key={asset.name}
            className={`checkbox-row ${asset.eligible && !configDisabled ? '' : 'checkbox-row--disabled'}`}
          >
            <input
              type="checkbox"
              checked={selectedSatellites.includes(asset.name)}
              onChange={() => toggleSatellite(asset.name)}
              disabled={!asset.eligible || configDisabled}
            />
            <span className="asset-name">{asset.name}</span>
            {!asset.eligible && warningMessage && renderAssetWarning(warningMessage)}
          </label>
            )
          })()
        ))}
        {satelliteAssets.length === 0 && (
          !configDisabled ? <p>No satellite assets available.</p> : null
        )}
      </div>
  )
})

export default SatelliteOptions
