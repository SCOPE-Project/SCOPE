import { memo } from 'react'

import { formatTimelineItemDuration, getBackendDataDownlinkMb } from '../../domain/format.js'
import { getOverviewControlTooltip, getScheduleToggleState, getScheduleToggleTitle } from '../../domain/assets.js'

const TimelineTooltip = memo(function TimelineTooltip({
  item,
  pinned,
  formatTimelineDateTime,
  handleLinkOverride,
  hideTimelineTooltip,
  openTimelineTradeOffView,
  overridingLinkId,
  sessionId,
  tradeOffsCalculated,
}) {
  return (
      <>
        <div className="timeline-hover-tooltip-header">
          <strong>{item.kind === 'link' ? `Link ID: ${item.linkId}` : item.label}</strong>
          {item.tradeOffId ? (
            <span className="timeline-hover-tooltip-pill">{item.tradeOffId}</span>
          ) : item.kind === 'activity' ? (
            <span className="timeline-hover-tooltip-pill timeline-hover-tooltip-pill--activity">
              Priority
            </span>
          ) : null}
        </div>
        <span>{item.detail}</span>
        <span>Start: {formatTimelineDateTime(item.startTime)}</span>
        <span>End: {formatTimelineDateTime(item.endTime)}</span>
        <span>Duration: {formatTimelineItemDuration(item)}</span>
        {item.recommended && <span>Auto-scheduled by the backend</span>}
        {item.overrideState && item.overrideState !== 'auto' && <span>Override: {item.overrideState}</span>}
        {Number.isFinite(getBackendDataDownlinkMb(item)) && getBackendDataDownlinkMb(item) > 0 && (
          <span>Data downlink: {(getBackendDataDownlinkMb(item) / 1000).toFixed(2)} GB</span>
        )}
        {Number.isFinite(item.score) && <span>Backend score: {item.score.toFixed(2)}</span>}
        {item.rejectionReason && !item.blockMessage && <span>{item.rejectionReason}</span>}
        {item.blockMessage && <span>{item.blockMessage}</span>}
        {item.kind === 'link' && item.tradeOffId && (
          <span>Trade-Off relation: {item.tradeOffId}</span>
        )}
        {pinned && item.kind === 'link' && (
          <div className="timeline-link-popup-actions">
            {item.tradeOffId && (
            <button
              type="button"
              className="timeline-link-popup-tradeoff-button"
              onClick={() => {
                hideTimelineTooltip(true)
                openTimelineTradeOffView(
                  item.tradeOffId,
                  item.optionId ?? item.linkId,
                  item.linkId,
                  false,
                )
              }}
            >
              Show Trade-Off
            </button>
            )}
            <div className="timeline-link-popup-status-row">
              <span>Schedule controls</span>
            </div>
            {sessionId && tradeOffsCalculated && item.isSchedulable ? (
              <div
                className="timeline-link-popup-controls"
                role="group"
                aria-label={`Schedule controls for ${item.linkId}`}
              >
                {[
                  { state: 'auto', label: 'A' },
                  { state: 'pinned', label: 'P' },
                  { state: 'excluded', label: 'X' },
                ].map((control) => (
                  <button
                    key={control.state}
                    type="button"
                    className={`timeline-link-popup-control timeline-link-popup-control--${control.state} ${item.overrideState === control.state ? 'timeline-link-popup-control--active' : ''}`}
                    onClick={() => handleLinkOverride({
                      ...item,
                      optionId: item.optionId ?? item.linkId,
                      tradeOffGroupId: item.tradeOffGroupId ?? item.tradeOffId,
                    }, control.state)}
                    disabled={Boolean(overridingLinkId)}
                    aria-pressed={item.overrideState === control.state}
                    title={getOverviewControlTooltip(control.state)}
                  >
                    {control.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`timeline-link-popup-control timeline-link-popup-schedule-toggle ${item.isScheduled ? 'timeline-link-popup-schedule-toggle--scheduled' : 'timeline-link-popup-schedule-toggle--unscheduled'}`}
                  onClick={() => handleLinkOverride({
                    ...item,
                    optionId: item.optionId ?? item.linkId,
                    tradeOffGroupId: item.tradeOffGroupId ?? item.tradeOffId,
                  }, getScheduleToggleState(item.isScheduled))}
                  disabled={Boolean(overridingLinkId)}
                  aria-pressed={item.isScheduled}
                  aria-label={item.isScheduled
                    ? `Scheduled. Click to unschedule ${item.linkId}`
                    : `Unscheduled. Click to schedule ${item.linkId}`}
                  title={getScheduleToggleTitle(item.isScheduled)}
                >
                  {item.isScheduled ? 'Scheduled' : 'Unscheduled'}
                </button>
              </div>
            ) : (
              <span className="timeline-link-popup-unavailable">
                {!item.isSchedulable
                  ? 'This link is blocked or ineligible and cannot be scheduled.'
                  : 'Calculate Trade-Offs to enable schedule controls.'}
              </span>
            )}
            {overridingLinkId === item.linkId && (
              <span className="timeline-link-popup-saving" role="status">Updating backend schedule…</span>
            )}
          </div>
        )}
        <span className="timeline-hover-tooltip-note">
          {pinned
            ? 'Click the bar again or close this popup.'
            : 'Click the bar to open schedule controls.'}
        </span>
      </>
  )
})

export default TimelineTooltip
