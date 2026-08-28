# Frontend Data Sourcing and Display Logic Audit

## Executive Summary

This document presents a comprehensive audit of all data, flags, labels, calculations, defaults, and visual states presented to the user across the SCOPE frontend application.

The primary objective is to identify:
1. **Data items sourced authoritatively from backend data structures vs. values generated or derived by frontend internal logic.**
2. **Implicit defaults, synthetic labels, fallbacks, or heuristic displays that are presented to the operator without explicit indication that they originate on the frontend.**

---

## High-Level Summary Matrix

| UI Component / View | Display Item | Source of Data | Authority / Generation Logic |
| :--- | :--- | :--- | :--- |
| **Overview Table** | Link ID | Backend (`LinkBlock.link_id`) | Sourced from backend, but **masked to `—` by frontend** if the row is ineligible ([`App.jsx:825-831`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L825-L831)). |
| **Overview Table** | Status Badges (`Recommended`, `Eligible`, `Blocked`, `Ineligible`) | Derived in Frontend | Based on backend `is_eligible`, `eligibility_status`, `is_scheduled`, and `override_state === 'auto'` ([`App.jsx:5444-5454`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L5444-L5454)). |
| **Overview Table** | T- Column (Countdown) | **Pure Frontend** | Real-time countdown against **client browser wall clock** (`Date.now()`) ([`overpassCountdown.js`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/overpassCountdown.js)). |
| **Overview Table** | Overpass / Sat / GS IDs | Backend (`LinkBlock`) | Authoritative backend strings. |
| **Overview Table** | Start / End Timestamps | Backend (`LinkBlock`) | Timestamps from backend; formatted in UTC/Local with frontend day-offset rollover (`+1`, `+2`) ([`App.jsx:759-763`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L759-L763)). |
| **Overview Table** | Duration & Max Elevation | Backend (`LinkBlock`) | Formatted by frontend helpers (`formatDurationFromSeconds`, `formatElevation`). |
| **Overview Table** | Buffer Level Before | Backend Profile Point | Looked up by frontend from `satellite_buffer_profiles` at `event_type === 'downlink_start'` ([`App.jsx:2592-2605`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L2592-L2605)). |
| **Overview Table** | Trade-Off ID | Backend (`ScheduledLinkStatus`) | Backend ID; **suppressed to `—` by frontend** if the group is marked `is_trivial: true` ([`App.jsx:1939-1945`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L1939-L1945)). |
| **Overview Table** | Score | Backend (`ScheduledLinkStatus`) | Formatted to 2 decimal places (`score.toFixed(2)`). |
| **Overview Table** | Data Downlink | Backend (`ScheduledLinkStatus`) | Shows `useful_data_offloaded_mb` when scheduled, otherwise `—`. |
| **Overview Table** | Blocked Tooltip Text | Mixed / Frontend Fallback | Uses `rejection_reason` if present; otherwise generates synthetic string: `"${row.overpassId} is blocked because a scheduled activity on the current schedule has priority."` ([`App.jsx:4542-4551`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L4542-L4551)). |
| **Trade-Off Cards** | Group Title & Options | Backend (`TradeOffGroup`) | Sourced from `trade_off_groups` (filtered to non-trivial groups). |
| **Trade-Off Cards** | Resource Label | Derived in Frontend | Concatenation: `[...satellites, ...groundstations].join(' · ')` ([`schedulingModel.js:121-124`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js#L121-L124)). |
| **Trade-Off Cards** | Conflict Reason | Mixed / **Frontend Fallback** | Looks up pair `leftId:rightId` in `sessionPlan.conflict_reasons`. **If empty, falls back to:** `"The backend identified mutually exclusive communication links."` ([`schedulingModel.js:107`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js#L107)). |
| **Trade-Off Cards** | Pass Capacity vs Data Downlink | Backend | Card displays both `estimated_data_capacity_mb` (pass capacity) and `useful_data_offloaded_mb` (downlink). |
| **Map View** | Satellite Live Position / Altitude | **Frontend Interpolation** | Calculated in frontend via `interpolateTrackPosition` between discrete points in `global_tracks` for playhead time. |
| **Map View** | Ground Station Visibility Circles | **Frontend Computation** | Radius computed by geodesic trigonometry. **Implicit Fallback:** Uses first selected satellite (`selectedSatelliteAssets[0]`) mean altitude if no satellite is active ([`MissionMap.jsx:280-297`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/MissionMap.jsx#L280-L297)). |
| **Map View** | Satellite Visibility Circles | **Frontend Computation** | Calculated by frontend assuming 0° elevation horizon angle ([`MissionMap.jsx:198`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/MissionMap.jsx#L198)). |
| **Map View** | Ground Tracks | Backend + Frontend Window | Geometry from `global_tracks`, clipped by frontend to `groundTrackWindowHours` (default 6h) ([`MissionMap.jsx:394-398`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/MissionMap.jsx#L394-L398)). |
| **Timeline View** | Track Hierarchy & Lanes | Derived in Frontend | Layout engine arranges asset groups and counterpart rows; header row aggregates scheduled links. |
| **Timeline View** | Bar Visual Variants | Derived in Frontend | Colors mapped based on `overrideState`, `isScheduled`, `scheduleBlocked`. |
| **Timeline View** | Data Volume Buffer Profile | Backend Profile Points | Plotted from `satellite_buffer_profiles`. |
| **Timeline View** | Data Volume Flags | Derived in Frontend | `"Buffer full"` if `overflow_events.length > 0`; `"X GB lost"` if `total_lost_mb > 0` ([`App.jsx:6253-6260`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L6253-L6260)). |
| **Staged Review** | KPI Aggregations | Derived in Frontend | Total scheduled links, total offloaded GB, total duration summed across scheduled rows ([`schedulingModel.js`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js)). |
| **Staged Review** | Activity Name String | **Pure Frontend Template** | Synthetic name: `` `DOWNLINK_${linkId}_${link.satId}-${link.gsId}` `` ([`App.jsx:6775, 6871`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L6775)). |
| **Staged Review** | Initiator Badge | **Hardcoded Frontend String** | Badge reads `"SCOPE_Scheduler"` ([`App.jsx:6781, 6877`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L6781)). |
| **Staged Review** | Dual-Sided Confirmation | Pure Frontend State | UI checkboxes tracking per-link review on sat and GS sides before commit unlock. |
| **Landing & Config** | Buffer & Rate Defaults | Frontend Constants | Capacity=100GB, StartFill=5GB, GenRate=4MB/s, Downlink=25MB/s, Strategy=`buffer_overflow_avoidance`, Alpha=2, Exponent=2 ([`App.jsx:69-75`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L69-L75)). |
| **Landing & Config** | Planning Window Preset | Frontend Clock Preset | Rounded to next hour boundary from current system clock ([`App.jsx:146-160`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L146-L160)). |

---

## Detailed Findings by Subsystem

### 1. Overview Table

1. **Status Badge Logic (`Recommended` / `Eligible` / `Blocked` / `Ineligible`)**:
   - The backend provides raw booleans and status tokens: `is_eligible` (`bool`), `eligibility_status` (`string`), `is_scheduled` (`bool`), and `override_state` (`'auto' | 'pinned' | 'excluded'`).
   - The status badge is computed in frontend:
     ```javascript
     const isRecommendedRow = tradeOffsCalculated && row.isScheduled && row.overrideState === 'auto'
     ```
   - When `isRecommendedRow` is true, the UI renders a green **"Recommended"** badge.
   - When ineligible or blocked by baseline activity, it displays **"Ineligible"** or **"Blocked"**.
   - Otherwise, it displays **"Eligible"**.

2. **Ineligible Link ID Masking**:
   - Even though the backend generates a valid `link_id` for every candidate pass (e.g. `L-0005`), the frontend helper `getOverviewDisplayLinkId(row)` ([`App.jsx:825-831`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L825-L831)) replaces the Link ID with an em-dash (`—`) if `rowStatus === 'ineligible'`.
   - *Impact*: The user cannot see the underlying Link ID of an ineligible pass in the table.

3. **Real-Time Countdown Column (`T-`)**:
   - The countdown (`T-01:23:45`, `In pass`, `Elapsed`) is calculated entirely by client JavaScript ([`overpassCountdown.js`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/overpassCountdown.js)) by comparing `row.startTime` / `row.endTime` against the browser's wall clock `Date.now()`.
   - *Impact*: It is derived from client-side time, not a backend telemetry ticker.

4. **Synthetic Schedule Block Message**:
   - When a link is blocked by a baseline activity, the hover tooltip displays `row.rejectionReason` if provided by the backend.
   - If `rejectionReason` is null, [`getScheduleBlockMessage`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L4542-L4551) creates a fallback sentence:
     ```javascript
     `${row.overpassId} is blocked because a scheduled activity on the current schedule has priority.`
     ```

5. **Buffer Level Before Pass**:
   - The Overview table column "Buffer level before" is populated by matching the link's `link_id` against the `downlink_start` event points in the backend `satellite_buffer_profiles`. If trade-offs have not been calculated or if no profile point matches, it renders `—`.

---

### 2. Trade-Off Cards and Trade-Off Drawer

1. **Conflict Reason Fallback String**:
   - In [`schedulingModel.js:93-108`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js#L93-L108), the frontend attempts to read conflict descriptions from `sessionPlan.conflict_reasons` for each pair of conflicting links (`${leftId}:${rightId}`).
   - If no conflict reason is found for the group, it falls back to:
     ```javascript
     'The backend identified mutually exclusive communication links.'
     ```
   - *Ambiguity*: This generic string looks like an official backend message to the operator, but is hardcoded in the frontend.

2. **Suppression of Trivial Trade-Off Groups**:
   - The backend marks isolated links that have no mutual exclusivity conflicts with `is_trivial: true`.
   - The frontend filters out all trivial groups from the Trade-Off panel and drawer ([`schedulingModel.js:116`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js#L116)) and replaces their `tradeOffId` with `—` in the Overview table.

3. **Pass Capacity vs. Useful Data Downlink**:
   - Each option card clearly presents two distinct metrics:
     - **Pass capacity**: Theoretical maximum carry capacity if buffer were full (`LinkBlock.estimated_data_capacity_mb`).
     - **Data Downlink**: Actual data transferred given buffer state and schedule (`ScheduledLinkStatus.useful_data_offloaded_mb`). If unscheduled, shows `—`.

---

### 3. Mission Map

1. **Satellite Live Position & Altitude Interpolation**:
   - The backend returns discrete ephemeris track points in `propagationResult.global_tracks` at regular time steps (e.g. 30s or 60s intervals).
   - All intermediate positions, latitude/longitude, and altitude shown in the map sidebar and popup are **interpolated in client memory** using linear geocentric interpolation ([`mapGeometry.js`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/mapGeometry.js)).

2. **Ground Station Visibility Footprint Geometry & Satellite Fallback**:
   - The ground station elevation circles are calculated using spherical geodesic trigonometry in frontend ([`MissionMap.jsx:300-337`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/MissionMap.jsx#L300-L337)).
   - **Crucial Unadvertised Logic**: Computing the visible circle of a ground station requires a target satellite altitude. The frontend resolves this via:
     ```javascript
     const referenceSatellite = showGroundStationVisibility
       ? (selectedSatelliteAssets.find((asset) => asset.id === activeAssetId)
          ?? selectedSatelliteAssets[0]
          ?? null)
       : null
     ```
   - **Finding**: If multiple satellites with differing orbital altitudes (e.g., 400 km vs. 800 km) are loaded and the operator has not actively clicked one, the map draws the ground station circles using the **mean altitude of the first satellite in the list**. The user is not informed which satellite altitude is currently serving as the footprint reference.

3. **Satellite Horizon Circle (0° Footprint)**:
   - Satellite visibility circles assume a fixed 0° elevation horizon (`SATELLITE_FOOTPRINT_ELEVATION_DEGREES = 0`).

4. **Ground Track Time Windowing**:
   - The continuous orbit curves shown on the map are clipped to a configurable window (default 6 hours) centered on each satellite's current playhead time ([`MissionMap.jsx:394-398`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/components/MissionMap.jsx#L394-L398)).

---

### 4. Timeline and Buffer Telemetry

1. **Asset-Centric Grouping Hierarchy**:
   - The backend provides a flat list of links and schedule statuses.
   - The two-tier hierarchical tree (Satellites / Ground Stations -> Asset Groups -> Counterpart Rows -> Scheduled Link Bars) is generated entirely by [`buildTimelineModel`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L1075-L1398).
   - Counterpart sub-rows are dynamically created only if at least one pass exists in the window.

2. **Data Volume Sub-row Flags**:
   - Under expanded satellites, the buffer telemetry graph renders:
     - A `"Buffer full"` badge if `profile.overflow_events.length > 0`.
     - An `"X GB lost"` badge if `profile.total_lost_mb > 0`.
     - Capacity reference line and downlink step blocks.
   - While the underlying telemetry points come from `sessionPlan.satellite_buffer_profiles`, the SVG curve construction and badge conditions are evaluated client-side.

---

### 5. Staged Schedule Review & SatOS Commit Panel

1. **Synthetic Activity Naming**:
   - In the Staged Review table, the "Activity Name" column displays:
     ```javascript
     `DOWNLINK_${linkId}_${link.satId}-${link.gsId}`
     ```
   - This string is constructed by client JSX template formatting ([`App.jsx:6775, 6871`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L6775)).

2. **Hardcoded Initiator Badge**:
   - In the review table, the "Initiator" column renders a static badge reading **`SCOPE_Scheduler`** ([`App.jsx:6781, 6877`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L6781)).

3. **Dual-Sided Link Confirmation Gate**:
   - The requirement to check off every scheduled link on both its satellite card and its ground station card is a frontend safety barrier before unlocking the commit button.

---

### 6. Initial Configuration Defaults and Pre-loaded Values

The frontend supplies default configuration values on launch that override backend defaults:

1. **Buffer Parameters**:
   - Capacity: `100 GB` (`DEFAULT_DATA_CAPACITY_GB`)
   - Initial Fill: `5 GB` (`DEFAULT_DATA_START_FILL_GB`)
   - Payload Generation: `4 MB/s` (`DEFAULT_DATA_GENERATION_MBPS`)
   - Downlink Transmission Rate: `25 MB/s` (`DEFAULT_DOWNLINK_RATE_MBPS`)
2. **Trade-Off Scoring Parameters**:
   - Strategy: `buffer_overflow_avoidance`
   - Urgency Alpha: `2.0` (`DEFAULT_SCORING_ALPHA`)
   - Urgency Exponent: `2.0` (`DEFAULT_SCORING_EXPONENT`)
3. **Planning Time Window**:
   - Automatically initializes to the next full hour from the client clock (`start = roundUpToNextHour(now)`), with a duration of 1 hour.

---

## Specific Findings & Recommendations

### 1. Ambiguous / Implicit Frontend Displays
- **Ground Station Visibility Footprint Reference**: When multiple satellites exist and none is active, ground station footprints silently use the altitude of `selectedSatelliteAssets[0]`.
  - *Recommendation*: Add a label or subtitle in the map sidebar or footprint legend indicating: `Footprint based on [Sat-Name] (XXX km)`.
- **Generic Conflict Reason**: If the backend does not populate `conflict_reasons[pair]`, the fallback string `"The backend identified mutually exclusive communication links."` is shown.
  - *Recommendation*: Ensure the backend always emits specific conflict reasons (e.g. GS contention, satellite transmitter contention, or baseline activity overlap).
- **Ineligible Link ID Masking**: Displaying `—` for ineligible links conceals the link ID generated by the filter pipeline.
  - *Recommendation*: Consider showing the link ID with an "Ineligible" badge or muted text styling rather than masking it.

### 2. Codebase Discrepancy (Regression Note)
- **`buildCommitSummary` Export**:
  - In recent branch merges (commit `4f05b84`), `buildCommitSummary` was removed from [`frontend/src/schedulingModel.js`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/schedulingModel.js) while [`frontend/src/App.jsx:22`](file:///c:/Users/chris/Documents/Studium/Module_Master/SoftwaresystemeRaumfahrtanwendungen/SCOPE/frontend/src/App.jsx#L22) still imports and executes it.
  - *Action needed*: Restore the export of `buildCommitSummary` in `schedulingModel.js` so that the Staging Review panel functions without runtime exceptions.
