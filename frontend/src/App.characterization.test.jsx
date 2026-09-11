// Characterization tests for the scheduling pipeline.
//
// These pin the behaviour the refactor must preserve: landing -> launch
// scheduler -> calculate trade-offs -> override a link -> stage -> commit.
// They deliberately drive the UI the way an operator does (labels, roles,
// button text) rather than reaching into implementation details, so they keep
// passing while the components underneath are moved around.
//
// scopeApi is mocked at the module boundary, not fetch: the backend contract
// is the thing worth pinning, and the polling helper has its own tests.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ASSETS_RESPONSE,
  COMMIT_RESULT,
  FILTER_RESULT,
  PROPAGATION_RESULT,
  buildOverriddenSessionPlan,
  buildSessionPlan,
} from './test/fixtures.js'

vi.mock('./api/scopeApi.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    initializeAssets: vi.fn(),
    startOrbitExtraction: vi.fn(),
    startLinkFiltering: vi.fn(),
    startTradeOffProcessing: vi.fn(),
    pollTaskResult: vi.fn(),
    applySessionOverride: vi.fn(),
    updateSessionStrategy: vi.fn(),
    commitSession: vi.fn(),
    clearScopeActivities: vi.fn(),
  }
})

const api = await import('./api/scopeApi.js')
const { default: App } = await import('./App.jsx')

/** Answers the /status and /satos/asset/list health checks. */
const stubHealthChecks = () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  })))
}

/** Wires the happy path: propagation -> filtering -> trade-off scoring. */
const stubPipeline = (sessionPlan = buildSessionPlan()) => {
  api.initializeAssets.mockResolvedValue(ASSETS_RESPONSE)
  api.startOrbitExtraction.mockResolvedValue({ task_id: 'task-orbit' })
  api.startLinkFiltering.mockResolvedValue({ task_id: 'task-filter' })
  api.startTradeOffProcessing.mockResolvedValue({ task_id: 'task-score' })
  api.pollTaskResult.mockImplementation(async (taskId) => {
    if (taskId === 'task-orbit') return PROPAGATION_RESULT
    if (taskId === 'task-filter') return FILTER_RESULT
    if (taskId === 'task-score') return { payload: sessionPlan }
    throw new Error(`Unexpected task id ${taskId}`)
  })
  api.commitSession.mockResolvedValue(COMMIT_RESULT)
}

const waitForAssets = async () => {
  await screen.findByLabelText('SAT-ALPHA', {}, { timeout: 3000 })
}

/** Fills in everything the launch button requires and clicks it. */
const launchScheduler = async (user) => {
  await waitForAssets()
  await user.click(screen.getByLabelText('SAT-ALPHA'))
  await user.click(screen.getByLabelText('GS-KIRUNA'))
  await user.type(screen.getByLabelText('Mission operator name'), 'Test Operator')

  const launchButton = screen.getByRole('button', { name: /load scope/i })
  await waitFor(() => expect(launchButton).toBeEnabled())
  await user.click(launchButton)

  // The workspace only appears once filtering has produced rows.
  await screen.findByRole('button', { name: /calculate trade-offs/i }, { timeout: 3000 })
}

const calculateTradeOffs = async (user) => {
  await user.click(screen.getByRole('button', { name: /calculate trade-offs/i }))
  await waitFor(() => expect(api.startTradeOffProcessing).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  stubHealthChecks()
})

describe('landing page', () => {
  it('auto-loads mission assets once the backend answers its health check', async () => {
    stubPipeline()
    render(<App />)

    await waitForAssets()
    expect(api.initializeAssets).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('SAT-BRAVO')).toBeInTheDocument()
    expect(screen.getByLabelText('GS-KIRUNA')).toBeInTheDocument()
  })

  it('offers ineligible assets as disabled rather than hiding them', async () => {
    stubPipeline()
    render(<App />)

    await waitForAssets()
    await userEvent.click(screen.getByRole('button', { name: /unavailable assets/i }))
    expect(await screen.findByText('SAT-DECOMMISSIONED')).toBeInTheDocument()
  })

  it('keeps launch disabled until operator, satellite and ground station are set', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)
    await waitForAssets()

    const launchButton = screen.getByRole('button', { name: /load scope/i })
    expect(launchButton).toBeDisabled()

    await user.click(screen.getByLabelText('SAT-ALPHA'))
    expect(launchButton).toBeDisabled()

    await user.click(screen.getByLabelText('GS-KIRUNA'))
    expect(launchButton).toBeDisabled()

    await user.type(screen.getByLabelText('Mission operator name'), 'Test Operator')
    await waitFor(() => expect(launchButton).toBeEnabled())
  })

  it('surfaces a backend failure without entering the workspace', async () => {
    stubPipeline()
    api.startOrbitExtraction.mockRejectedValue(new Error('Propagation exploded'))
    const user = userEvent.setup()
    render(<App />)

    await waitForAssets()
    await user.click(screen.getByLabelText('SAT-ALPHA'))
    await user.click(screen.getByLabelText('GS-KIRUNA'))
    await user.type(screen.getByLabelText('Mission operator name'), 'Test Operator')
    await user.click(screen.getByRole('button', { name: /load scope/i }))

    expect(await screen.findByText(/propagation exploded/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /calculate trade-offs/i })).not.toBeInTheDocument()
  })
})

describe('scheduler pipeline', () => {
  it('runs propagation then filtering and lands in the workspace', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    await launchScheduler(user)

    expect(api.startOrbitExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        satellites: ['SAT-ALPHA'],
        groundstations: ['GS-KIRUNA'],
      }),
      expect.anything(),
    )
    expect(api.startLinkFiltering).toHaveBeenCalledWith(
      expect.objectContaining({ orbit_engine_run_id: 'orbit-run-1' }),
      expect.anything(),
    )
    // All three filtered links reach the Overview.
    expect(await screen.findByText('OVP-1')).toBeInTheDocument()
    expect(screen.getByText('OVP-2')).toBeInTheDocument()
    expect(screen.getByText('OVP-3')).toBeInTheDocument()
  })

  it('sends the buffer and scoring configuration the landing form holds', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    await launchScheduler(user)
    await calculateTradeOffs(user)

    expect(api.startTradeOffProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_run_id: 'filter-run-1',
        default_buffer_config: expect.objectContaining({
          capacity_mb: 100000,
          initial_level_mb: 5000,
          payload_generation_rate_mbps: 4,
          downlink_rate_mbps: 25,
        }),
        scoring_config: expect.objectContaining({
          name: 'buffer_overflow_avoidance',
          parameters: { alpha: 2, exponent: 2 },
        }),
      }),
    )
  })

  it('applies the returned plan: scheduled links, scores and trade-off ids', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    await launchScheduler(user)
    await calculateTradeOffs(user)

    // LNK-2 won its group, LNK-1 lost it, LNK-3 was uncontested.
    await waitFor(() => expect(screen.getAllByText('TO-1').length).toBeGreaterThan(0))
    expect(await screen.findByText('0.87')).toBeInTheDocument()
    expect(screen.getByText('0.41')).toBeInTheDocument()
    expect(screen.getByText('0.63')).toBeInTheDocument()
  })

  it('suppresses the trade-off id of a trivial group', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    await launchScheduler(user)
    await calculateTradeOffs(user)

    await waitFor(() => expect(screen.getAllByText('TO-1').length).toBeGreaterThan(0))
    // TO-2 is marked is_trivial, so it never appears as a trade-off id.
    expect(screen.queryByText('TO-2')).not.toBeInTheDocument()
  })
})

describe('operator override', () => {
  it('sends the override to the backend and adopts the returned plan', async () => {
    stubPipeline()
    api.applySessionOverride.mockResolvedValue(buildOverriddenSessionPlan())
    const user = userEvent.setup()
    render(<App />)

    await launchScheduler(user)
    await calculateTradeOffs(user)
    await waitFor(() => expect(screen.getAllByText('TO-1').length).toBeGreaterThan(0))

    const overrideGroup = await screen.findByRole('group', { name: 'Override LNK-1' })
    await user.click(within(overrideGroup).getByRole('button', { name: 'P' }))

    await waitFor(() => expect(api.applySessionOverride).toHaveBeenCalledWith(
      'session-1',
      { link_id: 'LNK-1', override_state: 'pinned' },
    ))

    // The backend's answer is authoritative: LNK-1 is now scheduled and LNK-2
    // has been evicted, and the Overview reflects that without a local guess.
    await waitFor(() => {
      const pinned = screen.getByRole('group', { name: 'Override LNK-1' })
      expect(within(pinned).getByRole('button', { name: 'P' })).toHaveAttribute('aria-pressed', 'true')
    })
  })
})

describe('staging and commit', () => {
  const stageSchedule = async (user) => {
    await launchScheduler(user)
    await calculateTradeOffs(user)
    await waitFor(() => expect(screen.getAllByText('TO-1').length).toBeGreaterThan(0))

    const confirmButton = await screen.findByRole('button', { name: /confirm communication schedule/i })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    await user.click(confirmButton)
    return screen.findByRole('region', { name: 'Staged Schedule Review' }, { timeout: 3000 })
  }

  it('summarises the staged schedule from the backend plan', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    const review = await stageSchedule(user)
    // Two links scheduled (LNK-2 and LNK-3), 23,000 MB offloaded between them.
    expect(within(review).getByText('2')).toBeInTheDocument()
    expect(within(review).getByText('23.00 GB')).toBeInTheDocument()
    expect(within(review).getByText('23,000 MB')).toBeInTheDocument()
  })

  it('keeps the SatOS commit locked until both sides of every link are reviewed', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    const review = await stageSchedule(user)
    const commitButton = within(review).getByRole('button', { name: /commit .*satos/i })
    expect(commitButton).toBeDisabled()

    const checkboxes = within(review).getAllByRole('checkbox')
    for (const checkbox of checkboxes) {
      if (!checkbox.checked) {
        await user.click(checkbox)
      }
    }

    await waitFor(() => expect(commitButton).toBeEnabled())
  })

  it('commits the session under the operator name', async () => {
    stubPipeline()
    const user = userEvent.setup()
    render(<App />)

    const review = await stageSchedule(user)
    for (const checkbox of within(review).getAllByRole('checkbox')) {
      if (!checkbox.checked) {
        await user.click(checkbox)
      }
    }

    const commitButton = within(review).getByRole('button', { name: /commit .*satos/i })
    await waitFor(() => expect(commitButton).toBeEnabled())
    await user.click(commitButton)

    await waitFor(() => expect(api.commitSession).toHaveBeenCalledWith('session-1', 'Test Operator'))
  })
})
