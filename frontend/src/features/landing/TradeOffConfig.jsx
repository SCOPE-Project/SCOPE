import { memo } from 'react'

import { TRADE_OFF_STRATEGIES } from '../../config/constants.js'

const TradeOffConfig = memo(function TradeOffConfig({
  disabled,
  scoringAlpha,
  scoringExponent,
  setScoringAlpha,
  setScoringExponent,
  setTradeOffStrategy,
  tradeOffConfigValid,
  tradeOffStrategy,
}) {
  return (
      <div className={`scheduling-config ${disabled ? 'scheduling-config--disabled' : ''}`}>
        <label className="filter-field">
          <span>Scoring Strategy</span>
          <select
            value={tradeOffStrategy}
            disabled={disabled}
            onChange={(event) => setTradeOffStrategy(event.target.value)}
            className="filter-input scheduling-config-select"
          >
            {TRADE_OFF_STRATEGIES.map((strategy) => (
              <option key={strategy.value} value={strategy.value}>{strategy.label}</option>
            ))}
          </select>
        </label>
        {tradeOffStrategy === 'buffer_overflow_avoidance' && (
          <div className="scheduling-config-grid scheduling-config-grid--parameters">
            <label className="filter-field">
              <span>Urgency Alpha</span>
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={scoringAlpha}
                disabled={disabled}
                aria-invalid={!tradeOffConfigValid}
                onChange={(event) => setScoringAlpha(event.target.value)}
                className="filter-input"
              />
            </label>
            <label className="filter-field">
              <span>Urgency Exponent</span>
              <input
                type="number"
                min="0.001"
                step="0.1"
                inputMode="decimal"
                value={scoringExponent}
                disabled={disabled}
                aria-invalid={!tradeOffConfigValid}
                onChange={(event) => setScoringExponent(event.target.value)}
                className="filter-input"
              />
            </label>
          </div>
        )}
        <p className="scheduling-config-note">
          Applied by the backend the next time Calculate Trade-Offs runs.
        </p>
        {!tradeOffConfigValid && (
          <p className="filter-error">Alpha must be zero or greater and exponent must be positive.</p>
        )}
      </div>
  )
})

export default TradeOffConfig
