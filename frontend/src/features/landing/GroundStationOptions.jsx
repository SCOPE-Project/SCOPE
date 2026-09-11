import { memo } from 'react'

import { getAssetWarningMessage } from '../../domain/assets.js'

const GroundStationOptions = memo(function GroundStationOptions({
  configDisabled,
  groundStationAssets,
  renderAssetWarning,
  selectedGroundStations,
  toggleGroundStation,
}) {
  return (
      <div className="checkbox-list">
        {groundStationAssets.map((asset) => (
          (() => {
            const warningMessage = getAssetWarningMessage(asset)

            return (
          <label
            key={asset.name}
            className={`checkbox-row ${asset.eligible && !configDisabled ? '' : 'checkbox-row--disabled'}`}
          >
            <input
              type="checkbox"
              checked={selectedGroundStations.includes(asset.name)}
              onChange={() => toggleGroundStation(asset.name)}
              disabled={!asset.eligible || configDisabled}
            />
            <span className="asset-name">{asset.name}</span>
            {!asset.eligible && warningMessage && renderAssetWarning(warningMessage)}
          </label>
            )
          })()
        ))}
        {groundStationAssets.length === 0 && (
          !configDisabled ? <p>No ground-station assets available.</p> : null
        )}
      </div>
  )
})

export default GroundStationOptions
