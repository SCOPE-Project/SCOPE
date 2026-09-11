import { memo } from 'react'

import { getAssetWarningMessage } from '../../domain/assets.js'

const UnavailableAssets = memo(function UnavailableAssets({
  configDisabled,
  renderAssetWarning,
  unavailableAssets,
}) {
  return (
      <div className="checkbox-list">
        {unavailableAssets.map((asset) => (
          (() => {
            const warningMessage = getAssetWarningMessage(asset)

            return (
          <div
            key={asset.name}
            className="checkbox-row checkbox-row--disabled checkbox-row--static"
          >
            <span className="asset-name">{asset.name}</span>
            {warningMessage && renderAssetWarning(warningMessage)}
          </div>
            )
          })()
        ))}
        {unavailableAssets.length === 0 && (
          <p>{configDisabled ? 'Unavailable assets will appear here after the mission asset load.' : 'No unclassified assets.'}</p>
        )}
      </div>
  )
})

export default UnavailableAssets
