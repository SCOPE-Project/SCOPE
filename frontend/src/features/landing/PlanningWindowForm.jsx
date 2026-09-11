import { memo } from 'react'

const PlanningWindowForm = memo(function PlanningWindowForm({
  disabled,
  handlePlanningTimeModeChange,
  planningTimeMode,
  planningWindowComplete,
  planningWindowEndDate,
  planningWindowEndTime,
  planningWindowInPast,
  planningWindowStartDate,
  planningWindowStartTime,
  planningWindowValid,
  renderPlanningTimeActions,
  renderTimeInput,
  setPlanningWindowEndDate,
  setPlanningWindowEndTime,
  setPlanningWindowStartDate,
  setPlanningWindowStartTime,
}) {
  return (
      <div className={`time-window-panel ${disabled ? 'time-window-panel--disabled' : ''}`}>
        <div className="time-window-header">
          <div className="time-window-zone-toggle" role="group" aria-label="Planning interval time zone">
            <button
              type="button"
              className={`time-window-zone-button ${planningTimeMode === 'utc' ? 'time-window-zone-button--active' : ''}`}
              onClick={() => handlePlanningTimeModeChange('utc')}
              aria-pressed={planningTimeMode === 'utc'}
              disabled={disabled}
            >
              UTC
            </button>
            <button
              type="button"
              className={`time-window-zone-button ${planningTimeMode === 'local' ? 'time-window-zone-button--active' : ''}`}
              onClick={() => handlePlanningTimeModeChange('local')}
              aria-pressed={planningTimeMode === 'local'}
              disabled={disabled}
            >
              Local
            </button>
          </div>
        </div>
        <div className="time-window-row">
          <label className="time-window-field">
            <span>Start Date</span>
            <input
              type="date"
              value={planningWindowStartDate}
              disabled={disabled}
              onChange={(event) => {
                setPlanningWindowStartDate(event.target.value)
                event.target.blur()
              }}
              className="time-window-input"
            />
          </label>
          <label className="time-window-field time-window-field--time">
            <span>Start Time</span>
            {renderTimeInput('start', planningWindowStartTime, setPlanningWindowStartTime, disabled)}
          </label>
        </div>
        {renderPlanningTimeActions('start', disabled)}
        <div className="time-window-row">
          <label className="time-window-field">
            <span>End Date</span>
            <input
              type="date"
              value={planningWindowEndDate}
              disabled={disabled}
              onChange={(event) => {
                setPlanningWindowEndDate(event.target.value)
                event.target.blur()
              }}
              className="time-window-input"
            />
          </label>
          <label className="time-window-field time-window-field--time">
            <span>End Time</span>
            {renderTimeInput('end', planningWindowEndTime, setPlanningWindowEndTime, disabled)}
          </label>
        </div>
        {renderPlanningTimeActions('end', disabled)}
        {planningWindowComplete && !planningWindowValid && (
          <p className="time-window-error">
            Enter a valid time window with an end time after the start time.
          </p>
        )}
        {planningWindowInPast && (
          <p className="time-window-warning">
            Warning: This Planning Time Window lies in the past.
          </p>
        )}
      </div>
  )
})

export default PlanningWindowForm
