import { memo } from 'react'

// A text field with a dropdown of common times. `menuKey` identifies which
// of the two window ends this instance edits, so only one menu is open at a
// time across the form.
const TimeInput = memo(function TimeInput({
  menuKey,
  value,
  setValue,
  disabled,
  activeTimeMenu,
  formatTimeTextInput,
  getSelectableTimeOptions,
  setActiveTimeMenu,
}) {
  return (
      <div
        className={`time-window-dropdown ${activeTimeMenu === menuKey ? 'time-window-dropdown--open' : ''}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setActiveTimeMenu(null)
          }
        }}
      >
        <div className="time-window-input-shell">
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            value={value}
            maxLength={5}
            disabled={disabled}
            onFocus={() => {
              if (!disabled) {
                setActiveTimeMenu(menuKey)
              }
            }}
            onChange={(event) => setValue(formatTimeTextInput(event.target.value, value))}
            className="time-window-input time-window-input--combo"
          />
          <button
            type="button"
            className="time-window-input-toggle"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!disabled) {
                setActiveTimeMenu((current) => (current === menuKey ? null : menuKey))
              }
            }}
            aria-haspopup="listbox"
            aria-expanded={activeTimeMenu === menuKey}
            aria-label={`Toggle ${menuKey} time suggestions`}
          >
            <span className="time-window-select-arrow" aria-hidden="true">▾</span>
          </button>
        </div>
        {activeTimeMenu === menuKey && !disabled && (
          <div className="time-window-select-menu" role="listbox" aria-label={`${menuKey} time`}>
            {getSelectableTimeOptions(menuKey).map((timeValue) => (
              <button
                key={`${menuKey}-${timeValue}`}
                type="button"
                role="option"
                aria-selected={value === timeValue}
                className={`time-window-select-option ${value === timeValue ? 'time-window-select-option--selected' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setValue(timeValue)
                  setActiveTimeMenu(null)
                }}
              >
                {timeValue}
              </button>
            ))}
          </div>
        )}
      </div>
  )
})

export default TimeInput
