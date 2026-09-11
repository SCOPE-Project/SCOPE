import { describe, expect, it } from 'vitest'

import {
  INITIAL_SCHEDULER_STATE,
  SCHEDULER_STAGE,
  SCHEDULER_STATUS,
  schedulerReducer,
} from './useSchedulerRun.js'

const run = (actions, from = INITIAL_SCHEDULER_STATE) =>
  actions.reduce(schedulerReducer, from)

// The flags App reads, derived the same way the hook derives them.
const flags = (state) => ({
  launchingScheduler: state.status === SCHEDULER_STATUS.purging
    || state.status === SCHEDULER_STATUS.propagating
    || state.status === SCHEDULER_STATUS.filtering,
  calculatingTradeOffs: state.status === SCHEDULER_STATUS.scoring,
  schedulerLaunched: state.stage !== SCHEDULER_STAGE.unplanned,
  tradeOffsCalculated: state.stage === SCHEDULER_STAGE.scored,
})

describe('schedulerReducer', () => {
  it('starts idle and unplanned', () => {
    expect(flags(INITIAL_SCHEDULER_STATE)).toEqual({
      launchingScheduler: false,
      calculatingTradeOffs: false,
      schedulerLaunched: false,
      tradeOffsCalculated: false,
    })
  })

  it('enters propagation on launch, or purging when clearing SatOS first', () => {
    expect(run([{ type: 'runStarted' }]).status).toBe(SCHEDULER_STATUS.propagating)
    expect(run([{ type: 'runStarted', purging: true }]).status).toBe(SCHEDULER_STATUS.purging)
    expect(run([{ type: 'runStarted', purging: true }]).statusLabel)
      .toMatch(/Purging/)
  })

  it('walks propagation to filtering to links-ready', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'stageEntered', status: SCHEDULER_STATUS.filtering },
      { type: 'linksReady' },
    ])
    expect(state.status).toBe(SCHEDULER_STATUS.idle)
    expect(state.stage).toBe(SCHEDULER_STAGE.launched)
    expect(state.progress).toBe(100)
    expect(state.statusLabel).toBe('Completed')
  })

  it('never reports in-flight and finished at the same time', () => {
    // The old boolean pairs allowed launchingScheduler && schedulerLaunched
    // to disagree with reality; status and stage cannot.
    const states = [
      run([{ type: 'runStarted' }]),
      run([{ type: 'runStarted' }, { type: 'linksReady' }]),
      run([{ type: 'runStarted' }, { type: 'linksReady' }, { type: 'scoringStarted' }]),
      run([{ type: 'runStarted' }, { type: 'linksReady' }, { type: 'scoringStarted' }, { type: 'scored' }]),
    ]
    states.forEach((state) => {
      const f = flags(state)
      expect(f.launchingScheduler && f.calculatingTradeOffs).toBe(false)
    })
  })

  it('leaves no stage flag set after an abort', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'stageEntered', status: SCHEDULER_STATUS.filtering },
      { type: 'runFailed', aborted: true },
    ])
    expect(flags(state)).toEqual({
      launchingScheduler: false,
      calculatingTradeOffs: false,
      schedulerLaunched: false,
      tradeOffsCalculated: false,
    })
    // An abort is the operator's own doing, so it is not surfaced as an error.
    expect(state.failure).toBeNull()
    expect(state.statusLabel).toBe('Stopped waiting')
  })

  it('records a real failure but still clears every stage flag', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'runFailed', error: 'Propagation exploded' },
    ])
    expect(state.statusLabel).toBe('Failed')
    expect(state.failure).toBe('Propagation exploded')
    expect(flags(state).schedulerLaunched).toBe(false)
  })

  it('keeps the filtered links when only scoring fails', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'linksReady' },
      { type: 'scoringStarted' },
      { type: 'scoringFailed' },
    ])
    // Adjusting the buffer configuration and scoring again must stay possible.
    expect(flags(state).schedulerLaunched).toBe(true)
    expect(flags(state).tradeOffsCalculated).toBe(false)
    expect(flags(state).calculatingTradeOffs).toBe(false)
  })

  it('discards the previous run\'s score when a new run starts', () => {
    const scored = run([
      { type: 'runStarted' },
      { type: 'linksReady' },
      { type: 'scoringStarted' },
      { type: 'scored' },
    ])
    expect(flags(scored).tradeOffsCalculated).toBe(true)

    const relaunched = schedulerReducer(scored, { type: 'runStarted' })
    expect(flags(relaunched).tradeOffsCalculated).toBe(false)
    expect(relaunched.messages).toEqual([])
    expect(relaunched.progress).toBe(0)
  })

  it('collapses a repeated poll message', () => {
    const message = { id: 'a', text: 'Filtering: working' }
    const state = run([
      { type: 'runStarted' },
      { type: 'messageAppended', message },
      { type: 'messageAppended', message: { id: 'b', text: 'Filtering: working' } },
      { type: 'messageAppended', message: { id: 'c', text: 'Filtering: done' } },
    ])
    expect(state.messages.map((entry) => entry.text)).toEqual([
      'Filtering: working',
      'Filtering: done',
    ])
  })

  it('ignores a non-finite progress report', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'progressReported', progress: 40 },
      { type: 'progressReported', progress: Number.NaN },
    ])
    expect(state.progress).toBe(40)
  })

  it('returns to the initial state on reset', () => {
    const state = run([
      { type: 'runStarted' },
      { type: 'linksReady' },
      { type: 'scored' },
      { type: 'reset' },
    ])
    expect(state).toEqual(INITIAL_SCHEDULER_STATE)
  })

  it('ignores an unknown action', () => {
    const started = run([{ type: 'runStarted' }])
    expect(schedulerReducer(started, { type: 'nonsense' })).toBe(started)
  })
})
