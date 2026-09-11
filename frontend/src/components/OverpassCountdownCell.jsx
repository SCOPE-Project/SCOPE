import { formatOverpassCountdown } from './overpassCountdown.js'
import {
  COUNTDOWN_REFRESH_INTERVAL_MS,
  usePeriodicCountdownNow,
} from '../state/usePeriodicCountdownNow.js'

export default function OverpassCountdownCell({ startTime, endTime }) {
  const nowMs = usePeriodicCountdownNow(COUNTDOWN_REFRESH_INTERVAL_MS)
  const { label, state } = formatOverpassCountdown(startTime, endTime, nowMs, { includeSeconds: true })

  return (
    <span
      className={`overview-countdown-cell overview-countdown-cell--${state}`}
      title={state === 'future' ? `Time until AOS at ${startTime}` : undefined}
    >
      {label}
    </span>
  )
}
