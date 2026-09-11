import { memo } from 'react'

const AssetWarning = memo(function AssetWarning({
  message,
  hideWarningTooltip,
  moveWarningTooltip,
  showWarningTooltip,
}) {
  return (
      <span
        className="asset-warning"
        title={message}
        tabIndex={0}
        aria-label={message}
        onMouseEnter={(event) => showWarningTooltip(message, event)}
        onMouseMove={moveWarningTooltip}
        onMouseLeave={hideWarningTooltip}
        onFocus={(event) => showWarningTooltip(message, event)}
        onBlur={hideWarningTooltip}
      >
        <svg
          className="asset-warning-icon"
          viewBox="0 0 24 24"
          focusable="false"
          aria-hidden="true"
        >
          <path
            d="M12 3 1.8 20.5c-.4.7.1 1.5.9 1.5h18.6c.8 0 1.3-.8.9-1.5L12 3Z"
            fill="currentColor"
          />
          <path
            d="M12 8.2c.5 0 .9.4.9.9v5.7a.9.9 0 1 1-1.8 0V9.1c0-.5.4-.9.9-.9Zm0 10a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z"
            fill="#fff"
          />
        </svg>
      </span>
  )
})

export default AssetWarning
