# Frontend Refactoring Plan

**Baseline:** commit `a7feedb` · React 19 · Vite 8 · Vitest 1.6
**Scope:** `frontend/src/` — primarily `App.jsx` and `index.css`

---

## Executive Summary

| Metric | Value |
| :--- | :--- |
| `App.jsx` | 7,516 lines in a single `App()` component |
| `index.css` | 6,621 lines, 840 class selectors, one global namespace |
| Hooks in `App()` | 92 `useState`, 30 `useRef`, 22 `useMemo`, 15 `useEffect`, 2 `useCallback` |
| Component test coverage | 0 — Vitest has no DOM environment |

The codebase is not badly written. The inline comments are unusually good: they explain *why* rather than *what* (the divider-resize rule, why `confirmedStagingLinks` namespaces the satellite and ground-station sides separately, why the playhead effect deliberately omits `timelinePlaying` from its dependencies). The pure modules under `components/` are clean and each has a test sibling. `MissionMap.jsx` is well-built and should not be touched.

The problem is scale, confined to two files. This plan decomposes them in five ordered phases without introducing a new architecture — it applies the pattern already established in `components/` and `schedulingModel.js` to the rest of the code.

---

## 1. Diagnosis

### 1.1 7,516 lines carry zero test coverage
Vitest runs without a DOM environment, so only `schedulingModel.js`, `mapGeometry.js`, `equirectangularProjection.js`, `overpassCountdown.js` and `worldMap.js` are testable. Every tested line lives outside `App.jsx`.

### 1.2 Impossible states are representable
`launchingScheduler`/`schedulerLaunched`, `calculatingTradeOffs`/`tradeOffsCalculated`, and `confirmingSchedule`/`confirmationSuccess`/`scheduleCommitted` are boolean pairs encoding one linear pipeline. Nothing prevents both halves of a pair being true simultaneously.

### 1.3 Every keystroke re-renders 7,516 lines
92 state hooks against 2 `useCallback` calls means the whole tree re-evaluates on any state change, and every handler identity churns. Commit `f9ab283` ("reduce re-renders") addressed a symptom of this. Component splitting is the structural fix.

### 1.4 Roughly 1,300 lines of pure logic are trapped inside the component
`buildTimelineModel` (224 lines), `buildCurrentScheduleItems`, `buildDayBands`, `buildDataVolumePolyline` and eighteen `format*` helpers are defined in the component body. They take explicit inputs and return values — already pure, but unreachable from a test.

### 1.5 Five ESLint errors on `main`, and CI does not run lint
`frontend-ci.yml` runs `npm run build` and `npm run test:run` only. One error is a `react-hooks/preserve-manual-memoization` flag on `commitSummary`'s dependencies — a genuine memoization hazard, not a style nit.

### 1.6 An entire panel is dead code
`TRADE_OFF_PANEL_ENABLED` is `false`, so `tradeOffPanelNode` (lines 5641–5852) never renders and its slot assignment at line 314 is already conditional. ~212 lines of JSX plus four CSS selectors can be deleted outright.

---

## 2. Target Structure

```
src/
  api/            scopeApi.js                     unchanged
  config/         constants.js                    new — timeline, buffer, panel defaults
  domain/         pure functions, one test file each
                  schedulingModel.js              exists — keep growing it
                  timelineModel.js                new
                  dataVolumeModel.js              new
                  planningWindow.js               new
                  assets.js                       new
                  stagingModel.js                 new
                  format.js                       new
  state/          one hook per slice of App state
                  useMissionAssets.js             new
                  usePlanningWindow.js            new
                  useSchedulerRun.js              new — useReducer state machine
                  useSessionPlan.js               new
                  useTimelineView.js              new
                  usePanelLayout.js               new
                  useStagingReview.js             new
  features/
    landing/      LandingPage.jsx, AssetPicker.jsx, PlanningWindowForm.jsx,
                  LinkFilters.jsx, BufferConfig.jsx, ExtractionProgress.jsx
    workspace/    WorkspaceLayout.jsx, PanelFrame.jsx, PanelResizer.jsx
    overview/     OverviewPanel.jsx
    timeline/     TimelinePanel.jsx, TimelineRow.jsx, TimelineBar.jsx,
                  TimelineRuler.jsx, TimelineControls.jsx,
                  TimelineTooltip.jsx, DataVolumeChart.jsx
    map/          MapPanel.jsx — thin wrapper over MissionMap
    staging/      StagingReviewPanel.jsx
  components/     shared dumb UI + existing pure modules
                  MissionMap.jsx                  DO NOT TOUCH
                  TimeInput.jsx, SectionToggle.jsx, Chevron.jsx,
                  OverpassCountdownCell.jsx
  styles/         tokens.css + one sheet per feature
  App.jsx         ~80 lines: shell, header, portals, view switch
```

---

## 3. Extraction Map

Line ranges as of `a7feedb`. Order within a phase is free; order *between* phases is not.

| App.jsx | Lines | What it is | Destination | Kind |
| :--- | ---: | :--- | :--- | :--- |
| 31–101 | 70 | Timeline, buffer, panel, strategy constants | `config/constants.js` | pure |
| 104–186 | 83 | Planning-window presets, date/time parse & format | `domain/planningWindow.js` | pure |
| 669–878 | 210 | Duration, elevation, timestamp, GB formatters | `domain/format.js` | pure |
| 775–834 | 60 | `buildCurrentScheduleItems` | `domain/schedulingModel.js` | pure |
| 879–1070 | 192 | Timeline label formatters, `buildDayBands` | `domain/timelineModel.js` | pure |
| 1071–1294 | 224 | `buildTimelineModel` + `buildAssetGroup` | `domain/timelineModel.js` | pure |
| 2762–3226 | 465 | Data-volume model, series, polyline builder | `domain/dataVolumeModel.js` | pure |
| 2179–2515 | 337 | Asset filtering, selection, map-asset derivation | `domain/assets.js` + `state/useMissionAssets.js` | state |
| 1518–1597 | 80 | Planning time-mode, shift, reset handlers | `state/usePlanningWindow.js` | state |
| 1640–2027 | 388 | Launch, propagate, filter, score, terminate | `state/useSchedulerRun.js` | state |
| 2028–2178 | 151 | Staging confirm keys, commit to SatOS | `state/useStagingReview.js` | state |
| 3227–3909 | 683 | Playhead, zoom, wheel, scroll-sync, playback | `state/useTimelineView.js` | state |
| 4087–4328 | 242 | Panel resize, drag-to-swap, keyboard resize | `state/usePanelLayout.js` | state |
| 3910–4086 | 177 | Timeline tooltip content + warnings | `features/timeline/TimelineTooltip.jsx` | view |
| 4329–4600 | 272 | Panel chrome, trade-off pill, timeline bar, chevron | `features/workspace/PanelFrame.jsx`, `timeline/TimelineBar.jsx` | view |
| 4602–4735 | 134 | Time combobox input, planning quick-actions | `components/TimeInput.jsx` | view |
| 4736–5164 | 429 | Extraction progress, landing config sections | `features/landing/*` | view |
| 5165–5332 | 168 | Landing view | `features/landing/LandingPage.jsx` | view |
| 5333–5640 | 308 | Overview table panel | `features/overview/OverviewPanel.jsx` | view |
| 5641–5852 | 212 | Trade-off panel — flag is `false` | **delete** | remove |
| 5853–6078 | 226 | Map panel chrome and layer toggles | `features/map/MapPanel.jsx` | view |
| 6079–6775 | 697 | Timeline panel: ruler, rows, controls, data volume | `features/timeline/*` | view |
| 6776–7091 | 316 | Staged review, dual-sided confirm, SatOS commit | `features/staging/StagingReviewPanel.jsx` | view |
| 7092–7412 | 321 | Slot assignment, resizers, workspace grid | `features/workspace/WorkspaceLayout.jsx` | view |
| 7413–7516 | 104 | Shell, header, tooltip portals, lock overlay | `App.jsx` (stays) | view |

---

## Phase 0 — Make It Verifiable

**Blocks everything. Do not skip.** Refactoring 7,516 untested lines is unfalsifiable; this phase buys the ability to know whether the next four broke anything.

- Fix the five ESLint errors; add `npm run lint` to `frontend-ci.yml` as a required step.
- Add `jsdom` and `@testing-library/react`; set `test.environment` in `vite.config.js`.
- Delete the trade-off panel (5641–5852), its slot branch at line 314, and its four CSS selectors.
- Write characterization tests for the flows later phases touch: landing → launch scheduler → calculate trade-offs → override a link → stage → commit. Mock `scopeApi` at the module boundary, not `fetch`.

**Acceptance criteria**
- CI fails on a newly introduced lint error.
- A test renders `<App />` and reaches the workspace view.
- Each of the five pipeline stages has at least one passing test.

---

## Phase 1 — Pure Functions Out

**~1,300 lines · near-zero risk.** Everything tagged *pure* in the extraction map. These functions already take explicit inputs; moving them is mechanical. Each move lands with its own test file, matching the convention `components/` already uses. Do `domain/format.js` first — widest fan-in, proves the pattern cheaply.

> **Carry the comments.** The explanatory comments must travel with the code they explain. The note above `buildTimelineModel` about links appearing twice under a shared `linkId`, and the one on `usefulDataOffloadedMb` about never substituting a locally derived estimate, encode decisions that cost someone real debugging. Losing them is the single biggest risk in a mechanical split.

**Acceptance criteria**
- `App.jsx` under 6,200 lines with no behavior change.
- Every new `domain/*.js` has a sibling `*.test.js`.
- No `domain/` module imports from `react`.

---

## Phase 2 — State Into Slice Hooks

**~1,880 lines · the real design work.** Group the 92 state hooks by lifecycle, one hook per slice. Most are straightforward lifts. One is not:

`useSchedulerRun` should be a `useReducer` with an explicit status — `idle`, `propagating`, `filtering`, `scoring`, `ready`, `failed` — rather than the current boolean pairs. This collapses roughly ten state variables plus their effects and abort handling into one machine and makes the impossible states unrepresentable. It also gives the extraction-progress UI a single value to switch on instead of inferring the stage from three booleans.

Hooks return objects, not tuples. Test them with `renderHook`.

**Acceptance criteria**
- `App()` holds fewer than 15 direct `useState` calls.
- Scheduler stage is one enum, read in exactly one place per consumer.
- Aborting mid-run leaves no stage flag set.

---

## Phase 3 — Split the JSX

**~3,000 lines · where prop drilling bites.** The seams are already cut: the four `*PanelNode` constants and eighteen `render*` helpers each become a file. Because they currently close over the whole component scope, extraction forces you to name real dependencies — that *is* the value of the phase, and also where it gets uncomfortable.

Handle the drilling with two or three narrow contexts (scheduler, timeline view, layout), not one god-context. Wrap each panel in `memo` as it lands; that is where the re-render win is realized.

**Order:** map → overview → staging → workspace → timeline. Timeline last: largest, and depends on the most.

**Acceptance criteria**
- `App.jsx` under 150 lines.
- No file in `features/` exceeds 400 lines.
- Typing in a landing filter re-renders no panel component.

---

## Phase 4 — CSS Alongside

**6,621 lines · incremental only.** Not a separate big-bang pass. As each panel is extracted in Phase 3, move its selectors into a sheet beside it. The `:root` token block becomes shared `styles/tokens.css`. New components get CSS Modules; existing global class names stay global until their panel moves.

The 840 selectors are already informally namespaced (`timeline-`, `staging-`, `landing-`, `panel-`), so the split is mostly a grep away.

**Acceptance criteria**
- No sheet exceeds 800 lines.
- `tokens.css` is the only file defining custom properties.
- Production CSS bundle size within 5% of baseline.

---

## 4. Deliberately Out of Scope

| Non-goal | Rationale |
| :--- | :--- |
| **Do not touch `MissionMap.jsx`** | Its imperative SVG behind `memo`/`forwardRef`, with refs mirroring props, is a deliberate choice for 60fps redraws. It is the one part already built the way the rest should be. |
| **No TypeScript in the same pass** | Queue it immediately after. The OpenAPI schema and `backend-compatibility-check.mjs` already exist; generated types would attack the backend-authoritative-vs-frontend-derived confusion catalogued in the data-sourcing audit. |
| **No state library** | Hooks plus two or three contexts suffice for two views. Revisit only if Phase 3 proves the drilling genuinely painful. |
| **No router** | `view` is a two-value switch between landing and workspace. A router adds a dependency and URL semantics nobody has asked for. |

---

## 5. Known Collateral Damage

`docs/Frontend_Data_Sourcing_and_Logic_Audit.md` cites `App.jsx` by line number throughout — `App.jsx:825-831`, `App.jsx:5444-5454`, `App.jsx:6253-6260`, and a dozen more. Every one of those goes stale the moment Phase 1 lands.

Convert them to module and function references as part of the work. That audit is the only written record of which displayed values are backend-authoritative and which are frontend inventions; if its references quietly stop resolving, it becomes fiction that still reads as truth.
