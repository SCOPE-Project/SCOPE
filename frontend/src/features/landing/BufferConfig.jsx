import { memo } from 'react'

const BufferConfig = memo(function BufferConfig({
  disabled,
  bufferConfigValid,
  dataCapacityGb,
  dataDownlinkRateMbps,
  dataGenerationMbps,
  dataStartFillGb,
  setDataCapacityGb,
  setDataDownlinkRateMbps,
  setDataGenerationMbps,
  setDataStartFillGb,
}) {
  return (
      <div className={`scheduling-config ${disabled ? 'scheduling-config--disabled' : ''}`}>
        <div className="scheduling-config-grid">
          <label className="filter-field">
            <span>Capacity</span>
            <div className="filter-input-shell">
              <input
                type="number"
                min="0.001"
                step="10"
                inputMode="decimal"
                value={dataCapacityGb}
                disabled={disabled}
                aria-invalid={!bufferConfigValid}
                onChange={(event) => setDataCapacityGb(event.target.value)}
                className="filter-input"
              />
              <span className="filter-input-unit">GB</span>
            </div>
          </label>
          <label className="filter-field">
            <span>Initial Fill</span>
            <div className="filter-input-shell">
              <input
                type="number"
                min="0"
                step="10"
                inputMode="decimal"
                value={dataStartFillGb}
                disabled={disabled}
                aria-invalid={!bufferConfigValid}
                onChange={(event) => setDataStartFillGb(event.target.value)}
                className="filter-input"
              />
              <span className="filter-input-unit">GB</span>
            </div>
          </label>
          <label className="filter-field">
            <span>Payload Generation</span>
            <div className="filter-input-shell">
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={dataGenerationMbps}
                disabled={disabled}
                aria-invalid={!bufferConfigValid}
                onChange={(event) => setDataGenerationMbps(event.target.value)}
                className="filter-input"
              />
              <span className="filter-input-unit">MB/s</span>
            </div>
          </label>
          <label className="filter-field">
            <span>Downlink Rate</span>
            <div className="filter-input-shell">
              <input
                type="number"
                min="0.001"
                step="0.1"
                inputMode="decimal"
                value={dataDownlinkRateMbps}
                disabled={disabled}
                aria-invalid={!bufferConfigValid}
                onChange={(event) => setDataDownlinkRateMbps(event.target.value)}
                className="filter-input"
              />
              <span className="filter-input-unit">MB/s</span>
            </div>
          </label>
        </div>
        <p className="scheduling-config-note">
          Backend defaults for selected satellites. The downlink rate is also used when filtering links.
        </p>
        {!bufferConfigValid && (
          <p className="filter-error">
            Capacity and downlink rate must be positive; initial fill must be between zero and capacity.
          </p>
        )}
      </div>
  )
})

export default BufferConfig
