# core/scheduling/forward_simulator.py
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict

from core.models.scheduling import (
    LinkBlock,
    OverrideState,
    TradeOffGroup,
    ConflictStructure,
    SatelliteBufferConfig,
    BufferEventType,
    BufferProfilePoint,
    BufferOverflowEvent,
    SatelliteBufferProfile,
    ScheduledLinkStatus,
)
from core.scheduling.strategy import BaseScoringRule, BaseScheduler, BufferUrgencyScoringRule, get_scoring_rule
from core.models.activities import Activity


def _ensure_utc(dt: datetime) -> datetime:
    """Helper to ensure all datetimes are UTC aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class ForwardSimulationScheduler(BaseScheduler):
    """
    Multi-Pass Dynamic Greedy Forward Simulation Scheduler.
    Steps chronologically through scenario events, updating satellite buffer state D(t),
    evaluating payload inflows and downlink offloads, and applying scoring rules.
    """

    def solve(
        self,
        candidate_links: Dict[str, LinkBlock],
        user_overrides: Dict[str, OverrideState],
        satellite_configs: Dict[str, SatelliteBufferConfig],
        conflict_structure: ConflictStructure,
        asset_schedules: Dict[str, List[Activity]],
        scoring_rule: Optional[BaseScoringRule] = None,
        scenario_start: Optional[datetime] = None,
        scenario_end: Optional[datetime] = None,
    ) -> Tuple[Dict[str, ScheduledLinkStatus], Dict[str, SatelliteBufferProfile]]:
        if scoring_rule is None:
            scoring_rule = BufferUrgencyScoringRule()

        # 1. Validate Scenario Time Horizon Bounds [T_start, T_end]
        if scenario_start is None or scenario_end is None:
            raise ValueError(
                "Forward simulation requires explicit scenario_start and scenario_end boundaries. "
                "No fallback horizon expansion is permitted."
            )

        scenario_start = _ensure_utc(scenario_start)
        scenario_end = _ensure_utc(scenario_end)

        if scenario_end <= scenario_start:
            raise ValueError(
                f"scenario_end ({scenario_end.isoformat()}) must be strictly after scenario_start ({scenario_start.isoformat()})."
            )


        # 2. Initialize State Tracking for Satellites
        current_buffer: Dict[str, float] = {
            sat: cfg.initial_level_mb for sat, cfg in satellite_configs.items()
        }
        peak_buffer: Dict[str, float] = {
            sat: cfg.initial_level_mb for sat, cfg in satellite_configs.items()
        }
        total_generated: Dict[str, float] = defaultdict(float)
        total_downlinked: Dict[str, float] = defaultdict(float)
        total_lost: Dict[str, float] = defaultdict(float)

        profile_points: Dict[str, List[BufferProfilePoint]] = defaultdict(list)
        overflow_events: Dict[str, List[BufferOverflowEvent]] = defaultdict(list)

        # Record scenario start points
        for sat, config in satellite_configs.items():
            init_pct = (config.initial_level_mb / config.capacity_mb * 100.0) if config.capacity_mb > 0 else 0.0
            profile_points[sat].append(
                BufferProfilePoint(
                    timestamp=scenario_start,
                    level_mb=config.initial_level_mb,
                    percentage=round(init_pct, 2),
                    event_type=BufferEventType.SCENARIO_START,
                )
            )

        # 3. Build Unified Chronological Event Queue within Scenario Horizon
        events = []

        # Filter and add SatOS Payload activities overlapping [scenario_start, scenario_end]
        for sat_name, activities in asset_schedules.items():
            if sat_name in satellite_configs:
                for act in activities:
                    if not act.start_event or getattr(act.start_event, "timestamp", None) is None:
                        continue
                    if not act.end_event or getattr(act.end_event, "timestamp", None) is None:
                        continue
                    act_start = _ensure_utc(act.start_event.timestamp)
                    act_end = _ensure_utc(act.end_event.timestamp)

                    # Only ingest activities that overlap with the scenario time horizon
                    if act_start < scenario_end and act_end > scenario_start:
                        # Clamp activity interval to scenario boundaries
                        clamped_start = max(act_start, scenario_start)
                        clamped_end = min(act_end, scenario_end)
                        events.append({
                            "type": "PAYLOAD",
                            "start_time": clamped_start,
                            "end_time": clamped_end,
                            "satellite_name": sat_name,
                            "activity": act,
                        })

        # Add Trade-Off Groups
        for tradeoff_id, group in conflict_structure.trade_off_groups.items():
            events.append({
                "type": "TRADEOFF_GROUP",
                "start_time": group.start_time,
                "end_time": group.end_time,
                "tradeoff_id": tradeoff_id,
                "group": group,
            })

        # Sort events chronologically by start_time
        events.sort(key=lambda e: e["start_time"])

        # 4. Output Plan Maps
        current_plan: Dict[str, ScheduledLinkStatus] = {}

        # Initialize unavailable or ineligible links in current_plan immediately
        for lid, link in candidate_links.items():
            if not link.is_available or not link.is_eligible:
                current_plan[lid] = ScheduledLinkStatus(
                    link=link,
                    is_scheduled=False,
                    override_state=user_overrides.get(lid, OverrideState.AUTO),
                    tradeoff_id=None,
                    useful_data_offloaded_mb=0.0,
                    rejection_reason=link.ineligibility_reason or "Unavailable link",
                )

        # 5. Simulation Execution Loop
        for event in events:
            if event["type"] == "PAYLOAD":
                sat_name = event["satellite_name"]
                config = satellite_configs[sat_name]
                act = event["activity"]
                start_t = event["start_time"]
                end_t = event["end_time"]

                duration_sec = max(0.0, (end_t - start_t).total_seconds())
                gen_data = duration_sec * config.payload_generation_rate_mbps
                total_generated[sat_name] += gen_data

                # Record start point
                curr_pct = (current_buffer[sat_name] / config.capacity_mb * 100.0) if config.capacity_mb > 0 else 0.0
                profile_points[sat_name].append(
                    BufferProfilePoint(
                        timestamp=start_t,
                        level_mb=round(current_buffer[sat_name], 2),
                        percentage=round(curr_pct, 2),
                        event_type=BufferEventType.PAYLOAD_START,
                        associated_id=str(act.uuid),
                    )
                )

                new_level = current_buffer[sat_name] + gen_data
                if new_level > config.capacity_mb:
                    lost_data = new_level - config.capacity_mb
                    total_lost[sat_name] += lost_data
                    current_buffer[sat_name] = config.capacity_mb
                    overflow_events[sat_name].append(
                        BufferOverflowEvent(
                            start_time=start_t,
                            end_time=end_t,
                            lost_data_mb=round(lost_data, 2),
                            satellite_name=sat_name,
                        )
                    )
                else:
                    current_buffer[sat_name] = new_level

                peak_buffer[sat_name] = max(peak_buffer[sat_name], current_buffer[sat_name])
                end_pct = (current_buffer[sat_name] / config.capacity_mb * 100.0) if config.capacity_mb > 0 else 0.0
                profile_points[sat_name].append(
                    BufferProfilePoint(
                        timestamp=end_t,
                        level_mb=round(current_buffer[sat_name], 2),
                        percentage=round(end_pct, 2),
                        event_type=BufferEventType.PAYLOAD_END,
                        associated_id=str(act.uuid),
                    )
                )

            elif event["type"] == "TRADEOFF_GROUP":
                tradeoff_id = event["tradeoff_id"]
                group: TradeOffGroup = event["group"]
                group_link_ids = group.link_ids
                group_links = [candidate_links[lid] for lid in group_link_ids if lid in candidate_links]

                if not group_links:
                    continue

                pinned_links = [l for l in group_links if user_overrides.get(l.link_id) == OverrideState.PINNED]
                excluded_link_ids = {l.link_id for l in group_links if user_overrides.get(l.link_id) == OverrideState.EXCLUDED}

                scheduled_link_ids: Set[str] = set()

                # Schedule PINNED links (honoring mutual exclusion if multiple pinned links conflict)
                for p_link in pinned_links:
                    pid = p_link.link_id
                    conflicts = conflict_structure.adjacency_list.get(pid, set())
                    if not any(conflict_id in scheduled_link_ids for conflict_id in conflicts):
                        scheduled_link_ids.add(pid)

                # For AUTO links, compute scores via injected BaseScoringRule
                unassigned_links = [
                    l for l in group_links 
                    if l.link_id not in scheduled_link_ids and l.link_id not in excluded_link_ids
                ]

                link_scores = {}
                for l in unassigned_links:
                    sat_name = l.satellite_name
                    config = satellite_configs[sat_name]
                    curr_buf = current_buffer[sat_name]
                    score, useful_offload = scoring_rule.compute_score(l, curr_buf, config)
                    link_scores[l.link_id] = (score, useful_offload)

                # Sort unassigned links by score descending
                sorted_unassigned = sorted(
                    unassigned_links,
                    key=lambda l: link_scores[l.link_id][0],
                    reverse=True
                )

                # Greedily allocate non-conflicting links
                for candidate in sorted_unassigned:
                    cid = candidate.link_id
                    conflicts = conflict_structure.adjacency_list.get(cid, set())

                    if not any(conflict_id in scheduled_link_ids for conflict_id in conflicts):
                        scheduled_link_ids.add(cid)

                # Update Plan Status and Deduct Buffer for Winners
                for l in group_links:
                    lid = l.link_id
                    sat_name = l.satellite_name
                    config = satellite_configs[sat_name]
                    override = user_overrides.get(lid, OverrideState.AUTO)

                    # Obtain the computed score for this candidate link
                    if lid in link_scores:
                        score_val, _ = link_scores[lid]
                    else:
                        score_val, _ = scoring_rule.compute_score(l, current_buffer[sat_name], config)

                    if lid in scheduled_link_ids:
                        _, useful_offload = scoring_rule.compute_score(l, current_buffer[sat_name], config)
                        total_downlinked[sat_name] += useful_offload

                        # Record profile points
                        start_pct = (current_buffer[sat_name] / config.capacity_mb * 100.0) if config.capacity_mb > 0 else 0.0
                        profile_points[sat_name].append(
                            BufferProfilePoint(
                                timestamp=l.start_time,
                                level_mb=round(current_buffer[sat_name], 2),
                                percentage=round(start_pct, 2),
                                event_type=BufferEventType.DOWNLINK_START,
                                associated_id=lid,
                            )
                        )

                        current_buffer[sat_name] = max(0.0, current_buffer[sat_name] - useful_offload)
                        end_pct = (current_buffer[sat_name] / config.capacity_mb * 100.0) if config.capacity_mb > 0 else 0.0
                        profile_points[sat_name].append(
                            BufferProfilePoint(
                                timestamp=l.end_time,
                                level_mb=round(current_buffer[sat_name], 2),
                                percentage=round(end_pct, 2),
                                event_type=BufferEventType.DOWNLINK_END,
                                associated_id=lid,
                            )
                        )

                        current_plan[lid] = ScheduledLinkStatus(
                            link=l,
                            is_scheduled=True,
                            override_state=override,
                            tradeoff_id=tradeoff_id,
                            score=round(score_val, 2),
                            useful_data_offloaded_mb=round(useful_offload, 2),
                            rejection_reason=None,
                        )
                    else:
                        if override == OverrideState.EXCLUDED:
                            reason = "Excluded by operator"
                        elif any(user_overrides.get(cid) == OverrideState.PINNED for cid in conflict_structure.adjacency_list.get(lid, set())):
                            reason = "Conflicts with an operator-pinned link"
                        else:
                            reason = "Lost trade-off to higher-scoring candidate"

                        current_plan[lid] = ScheduledLinkStatus(
                            link=l,
                            is_scheduled=False,
                            override_state=override,
                            tradeoff_id=tradeoff_id,
                            score=round(score_val, 2),
                            useful_data_offloaded_mb=0.0,
                            rejection_reason=reason,
                        )

        # 6. Assemble Satellite Profiles
        satellite_buffer_profiles: Dict[str, SatelliteBufferProfile] = {}
        for sat, config in satellite_configs.items():
            pts = sorted(profile_points[sat], key=lambda p: p.timestamp)
            satellite_buffer_profiles[sat] = SatelliteBufferProfile(
                satellite_name=sat,
                capacity_mb=config.capacity_mb,
                profile_points=pts,
                overflow_events=overflow_events[sat],
                total_generated_mb=round(total_generated[sat], 2),
                total_downlinked_mb=round(total_downlinked[sat], 2),
                total_lost_mb=round(total_lost[sat], 2),
                final_level_mb=round(current_buffer[sat], 2),
                peak_level_mb=round(peak_buffer[sat], 2),
            )

        return current_plan, satellite_buffer_profiles


# Convenience function delegating to ForwardSimulationScheduler
def run_forward_simulation(
    candidate_links: Dict[str, LinkBlock],
    user_overrides: Dict[str, OverrideState],
    satellite_configs: Dict[str, SatelliteBufferConfig],
    conflict_structure: ConflictStructure,
    asset_schedules: Dict[str, List[Activity]],
    scoring_rule: Optional[BaseScoringRule] = None,
    urgency_alpha: float = 2.0,
    scoring_strategy: str = "buffer_overflow_avoidance",
    scenario_start: Optional[datetime] = None,
    scenario_end: Optional[datetime] = None,
) -> Tuple[Dict[str, ScheduledLinkStatus], Dict[str, SatelliteBufferProfile]]:
    if scoring_rule is None:
        scoring_rule = get_scoring_rule(scoring_strategy, urgency_alpha=urgency_alpha)
    scheduler = ForwardSimulationScheduler()
    return scheduler.solve(
        candidate_links=candidate_links,
        user_overrides=user_overrides,
        satellite_configs=satellite_configs,
        conflict_structure=conflict_structure,
        asset_schedules=asset_schedules,
        scoring_rule=scoring_rule,
        scenario_start=scenario_start,
        scenario_end=scenario_end,
    )
