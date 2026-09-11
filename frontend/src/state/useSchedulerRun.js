import { useCallback, useMemo, useReducer } from 'react'

// The scheduling pipeline as one state machine.
//
// It used to be six booleans -- launchingScheduler/schedulerLaunched,
// calculatingTradeOffs/tradeOffsCalculated -- plus a status string and a
// progress number, each set independently. Nothing stopped a pair from being
// true at once, and "which stage are we in" had to be inferred by reading
// three of them together.
//
// Two orthogonal facts replace them:
//
//   status  what the pipeline is doing RIGHT NOW. Returns to 'idle' when the
//           run ends, however it ends.
//   stage   how far the pipeline has GOT. Monotonic within a run, and it
//           survives status going back to 'idle' -- that is the distinction
//           the old `schedulerLaunched`/`tradeOffsCalculated` pair encoded.
//
// Every legacy flag is derived from those two, so consumers read one enum
// rather than combining booleans.

export const SCHEDULER_STATUS = {
  idle: 'idle',
  purging: 'purging',
  propagating: 'propagating',
  filtering: 'filtering',
  scoring: 'scoring',
}

export const SCHEDULER_STAGE = {
  // Nothing has run, or the last run failed and left nothing usable.
  unplanned: 'unplanned',
  // A run is under way or has completed: the workspace may open, but no
  // scored session exists yet.
  launched: 'launched',
  // The backend scored a session: overrides and commit become available.
  scored: 'scored',
}

// Progress is reported per stage by the backend; these map each stage onto its
// slice of the single bar the operator sees.
export const STAGE_PROGRESS_SPAN = {
  propagation: { start: 0, span: 65 },
  filtering: { start: 65, span: 35 },
  scoring: { start: 0, span: 100 },
}

export const INITIAL_SCHEDULER_STATE = {
  status: SCHEDULER_STATUS.idle,
  stage: SCHEDULER_STAGE.unplanned,
  progress: 0,
  statusLabel: 'Not started',
  messages: [],
  failure: null,
}

export const schedulerReducer = (state, action) => {
  switch (action.type) {
    case 'reset':
      return INITIAL_SCHEDULER_STATE

    case 'runStarted':
      // A new run always discards the previous run's outcome: keeping the old
      // stage would leave stale trade-off controls enabled over fresh links.
      return {
        ...INITIAL_SCHEDULER_STATE,
        stage: SCHEDULER_STAGE.launched,
        status: action.purging ? SCHEDULER_STATUS.purging : SCHEDULER_STATUS.propagating,
        statusLabel: action.purging ? 'SatOS: Purging SCOPE activities' : 'Queued',
        messages: action.messages ?? [],
      }

    case 'stageEntered':
      return {
        ...state,
        status: action.status,
        statusLabel: action.statusLabel ?? state.statusLabel,
        progress: action.progress ?? state.progress,
      }

    case 'progressReported':
      return {
        ...state,
        statusLabel: action.statusLabel ?? state.statusLabel,
        progress: Number.isFinite(action.progress) ? action.progress : state.progress,
      }

    case 'messageAppended': {
      // The poller reports the same message on every tick while a stage runs;
      // collapsing repeats keeps the log readable.
      const last = state.messages[state.messages.length - 1]
      if (last?.text === action.message.text) {
        return state
      }
      return { ...state, messages: [...state.messages, action.message] }
    }

    case 'messagesReplaced':
      return { ...state, messages: action.messages }

    case 'linksReady':
      return {
        ...state,
        status: SCHEDULER_STATUS.idle,
        stage: SCHEDULER_STAGE.launched,
        statusLabel: 'Completed',
        progress: 100,
        failure: null,
      }

    case 'scoringStarted':
      return { ...state, status: SCHEDULER_STATUS.scoring, failure: null }

    case 'scored':
      return {
        ...state,
        status: SCHEDULER_STATUS.idle,
        stage: SCHEDULER_STAGE.scored,
        failure: null,
      }

    case 'scoringFailed':
      // Scoring failing does not invalidate the filtered links: the operator
      // can adjust the buffer configuration and score the same run again.
      return { ...state, status: SCHEDULER_STATUS.idle, failure: action.error ?? null }

    case 'runFailed':
      return {
        ...state,
        status: SCHEDULER_STATUS.idle,
        stage: SCHEDULER_STAGE.unplanned,
        statusLabel: action.aborted ? 'Stopped waiting' : 'Failed',
        failure: action.aborted ? null : (action.error ?? null),
      }

    default:
      return state
  }
}

export const useSchedulerRun = () => {
  const [state, dispatch] = useReducer(schedulerReducer, INITIAL_SCHEDULER_STATE)

  const derived = useMemo(() => ({
    // In-flight: the landing page swaps Load SCOPE for Terminate on this.
    launchingScheduler: state.status === SCHEDULER_STATUS.purging
      || state.status === SCHEDULER_STATUS.propagating
      || state.status === SCHEDULER_STATUS.filtering,
    calculatingTradeOffs: state.status === SCHEDULER_STATUS.scoring,
    // Reached: these survive the run finishing.
    schedulerLaunched: state.stage !== SCHEDULER_STAGE.unplanned,
    tradeOffsCalculated: state.stage === SCHEDULER_STAGE.scored,
  }), [state.status, state.stage])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { ...state, ...derived, dispatch, reset }
}
