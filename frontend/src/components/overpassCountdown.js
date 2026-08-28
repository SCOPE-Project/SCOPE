// Countdown from "now" to an overpass, in the T-minus form used in operations.
//
// Kept free of React so it can be unit tested directly, and so the caller
// decides how often "now" is re-read.

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const pad = (value) => String(value).padStart(2, '0')

// Ceiling rather than floor: while any part of a second is left the pass has
// not started yet, so the readout must not already show T-00:00:00.
//
// `includeSeconds: false` drops the seconds component even below a day. Use
// it whenever the caller only re-reads "now" once a minute (the Overview
// column does, to cut re-renders) -- a seconds digit that never actually
// ticks would just be a stale, misleading number sitting on screen.
export const formatCountdownDelta = (deltaMs, { includeSeconds = true } = {}) => {
  const totalSeconds = Math.max(0, Math.ceil(deltaMs / SECOND_MS))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const hoursMinutes = `${pad(hours)}:${pad(minutes)}`

  // Seconds are dropped beyond a day: they are noise at that range and the
  // column is too narrow to carry them.
  if (days > 0) {
    return `${days}d ${hoursMinutes}`
  }

  return includeSeconds ? `${hoursMinutes}:${pad(seconds)}` : hoursMinutes
}

/**
 * @param {string} startTime ISO timestamp of AOS
 * @param {string} endTime   ISO timestamp of LOS
 * @param {number} nowMs     current epoch milliseconds
 * @param {{includeSeconds?: boolean}} [options] forwarded to formatCountdownDelta
 * @returns {{label: string, state: 'future'|'active'|'past'|'unknown', deltaMs: number|null}}
 */
export const formatOverpassCountdown = (startTime, endTime, nowMs, options = {}) => {
  const startMs = Date.parse(startTime)

  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    return { label: '\u2014', state: 'unknown', deltaMs: null }
  }

  const endMs = Date.parse(endTime)

  if (Number.isFinite(endMs) && nowMs >= endMs) {
    return { label: 'Elapsed', state: 'past', deltaMs: startMs - nowMs }
  }

  if (nowMs >= startMs) {
    return { label: 'In pass', state: 'active', deltaMs: startMs - nowMs }
  }

  return {
    label: `T-${formatCountdownDelta(startMs - nowMs, options)}`,
    state: 'future',
    deltaMs: startMs - nowMs,
  }
}

export const COUNTDOWN_UNITS = { SECOND_MS, MINUTE_MS, HOUR_MS, DAY_MS }
