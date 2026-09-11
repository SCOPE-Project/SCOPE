import { memo } from 'react'

// The quick-adjust row under each planning time field: set to now, reset to
// the preset, and step by hours or days.
//
// `target` is 'start' or 'end'; every control acts on that end of the window
// only, which is why the label is derived rather than passed.
const PlanningTimeActions = memo(function PlanningTimeActions({
  target,
  disabled,
  handleResetPlanningTime,
  handleSetCurrentPlanningTime,
  handleShiftPlanningTime,
}) {
  const targetLabel = target === 'start' ? 'Start' : 'End'

  return (
    <div className="time-window-quick-actions" role="group" aria-label={`${targetLabel} time presets`}>
      <div className="time-window-quick-primary">
        <button
          type="button"
          className="time-window-quick-button time-window-quick-button--current"
          disabled={disabled}
          onClick={() => handleSetCurrentPlanningTime(target)}
        >
          Set current time
        </button>
        <button
          type="button"
          className="time-window-quick-button time-window-quick-button--reset"
          disabled={disabled}
          onClick={() => handleResetPlanningTime(target)}
        >
          Reset
        </button>
      </div>
      <div className="time-window-adjustment-row">
        <span className="time-window-adjustment-label">Hours</span>
        <div className="time-window-stepper" role="group" aria-label={`${targetLabel} hour adjustments`}>
          <button
            type="button"
            className="time-window-quick-button"
            disabled={disabled}
            onClick={() => handleShiftPlanningTime(target, -60)}
          >
            -1h
          </button>
          <button
            type="button"
            className="time-window-quick-button"
            disabled={disabled}
            onClick={() => handleShiftPlanningTime(target, 60)}
          >
            +1h
          </button>
        </div>
      </div>
      <div className="time-window-adjustment-row">
        <span className="time-window-adjustment-label">Days</span>
        <div className="time-window-stepper" role="group" aria-label={`${targetLabel} day adjustments`}>
          <button
            type="button"
            className="time-window-quick-button"
            disabled={disabled}
            onClick={() => handleShiftPlanningTime(target, -24 * 60)}
          >
            -1 day
          </button>
          <button
            type="button"
            className="time-window-quick-button"
            disabled={disabled}
            onClick={() => handleShiftPlanningTime(target, 24 * 60)}
          >
            +1 day
          </button>
        </div>
      </div>
    </div>
  )
})

export default PlanningTimeActions
