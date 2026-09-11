import { useEffect, useState } from 'react'
import { getCountdownNow, subscribeCountdownClock } from '../components/countdownClock.js'

// Subscribes to the shared ticker instead of lifting a per-second clock into
// App state: a tick then re-renders only the countdown cells, leaving the
// timeline, map and the rest of the table untouched.
//
// The Overview T- column shows seconds, but re-rendering every single one
// of them is unnecessary churn -- so it only re-renders every 20 seconds,
// even though the shared clock underneath still ticks once a second for
// any other subscriber.
export const COUNTDOWN_REFRESH_INTERVAL_MS = 20000

export const usePeriodicCountdownNow = (intervalMs) => {
  const [nowMs, setNowMs] = useState(getCountdownNow)

  useEffect(() => subscribeCountdownClock((tickNowMs) => {
    setNowMs((current) => (
      Math.floor(tickNowMs / intervalMs) === Math.floor(current / intervalMs) ? current : tickNowMs
    ))
  }), [intervalMs])

  return nowMs
}

