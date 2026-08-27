// One shared 1 Hz ticker for every countdown on screen.
//
// The timeline playback loop deliberately avoids React state during animation
// (it writes to the DOM directly) because re-rendering App at high frequency is
// expensive. A countdown column must not undo that: instead of lifting a
// per-second clock into App state, each countdown cell subscribes here, so a
// tick re-renders only those small cells. Exactly one interval runs, and only
// while at least one countdown is mounted.

const subscribers = new Set()
let intervalId = null
let currentNowMs = Date.now()

const tick = () => {
  currentNowMs = Date.now()
  subscribers.forEach((notify) => notify(currentNowMs))
}

export const getCountdownNow = () => currentNowMs

export const subscribeCountdownClock = (notify) => {
  subscribers.add(notify)

  if (intervalId === null) {
    intervalId = setInterval(tick, 1000)
  }

  return () => {
    subscribers.delete(notify)

    if (subscribers.size === 0 && intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}
