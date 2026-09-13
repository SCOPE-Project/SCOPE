# app/services/scheduling_service.py
import uuid
from dataclasses import replace
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Any

from core.models.scheduling import (
    DEFAULT_BUFFER_CAPACITY_MB,
    DEFAULT_BUFFER_INITIAL_LEVEL_MB,
    DEFAULT_DOWNLINK_RATE_MBPS,
    DEFAULT_PAYLOAD_GENERATION_RATE_MBPS,
    LinkBlock,
    OverrideState,
    SatelliteBufferConfig,
    SchedulingSession,
)
from core.models.activities import Activity
from core.scheduling.conflict_builder import build_conflict_structure
from core.scheduling.forward_simulator import ForwardSimulationScheduler
from core.scheduling.strategy import BaseScheduler, BaseScoringRule, get_scoring_rule
from app.models.scheduling import (
    CommitResponseDTO,
    SatelliteBufferConfigDTO,
    SatelliteBufferOverrideDTO,
    merge_buffer_config,
)
from app.repositories.scheduling_session_repository import SchedulingSessionRepository

_default_scheduler: BaseScheduler = ForwardSimulationScheduler()


class SessionNotFoundError(ValueError):
    """Raised when a scheduling session id is unknown (a ValueError for existing callers)."""


def create_session(
    filter_run_id: str,
    candidate_links: List[LinkBlock],
    scenario_start: datetime,
    scenario_end: datetime,
    asset_schedules: Optional[Dict[str, List[Activity]]] = None,
    satellite_configs: Optional[Dict[str, SatelliteBufferConfig]] = None,
    default_capacity_mb: float = DEFAULT_BUFFER_CAPACITY_MB,
    default_initial_level_mb: float = DEFAULT_BUFFER_INITIAL_LEVEL_MB,
    default_payload_generation_rate_mbps: float = DEFAULT_PAYLOAD_GENERATION_RATE_MBPS,
    default_downlink_rate_mbps: float = DEFAULT_DOWNLINK_RATE_MBPS,
    scoring_strategy: str = "buffer_overflow_avoidance",
    scoring_parameters: Optional[Dict[str, Any]] = None,
    scoring_rule: Optional[BaseScoringRule] = None,
    session_id: Optional[str] = None,
    scheduler: Optional[BaseScheduler] = None,
) -> SchedulingSession:
    """
    Creates a new SchedulingSession from candidate links, builds the conflict graph,
    and computes the initial forward simulation schedule.
    """
    if scenario_start is None or scenario_end is None:
        raise ValueError("create_session requires explicit scenario_start and scenario_end.")

    if session_id is None:
        session_id = str(uuid.uuid4())

    resolved_satellite_configs: Dict[str, SatelliteBufferConfig] = dict(satellite_configs or {})
    for link in candidate_links:
        sat = link.satellite_name
        if sat not in resolved_satellite_configs:
            resolved_satellite_configs[sat] = SatelliteBufferConfig(
                satellite_name=sat,
                capacity_mb=default_capacity_mb,
                initial_level_mb=default_initial_level_mb,
                payload_generation_rate_mbps=default_payload_generation_rate_mbps,
                downlink_rate_mbps=default_downlink_rate_mbps,
            )

    candidate_links = _apply_session_downlink_rates(candidate_links, resolved_satellite_configs)
    links_by_id: Dict[str, LinkBlock] = {l.link_id: l for l in candidate_links if l.link_id}
    schedulable_links = [l for l in candidate_links if l.is_eligible and l.is_available]

    conflict_structure = build_conflict_structure(schedulable_links)

    user_overrides: Dict[str, OverrideState] = {}
    schedules_map = asset_schedules or {}
    active_scheduler = scheduler or _default_scheduler
    params = dict(scoring_parameters or {})
    active_scoring = scoring_rule or get_scoring_rule(scoring_strategy, **params)

    current_plan, satellite_profiles = active_scheduler.solve(
        candidate_links=links_by_id,
        user_overrides=user_overrides,
        satellite_configs=resolved_satellite_configs,
        conflict_structure=conflict_structure,
        asset_schedules=schedules_map,
        scoring_rule=active_scoring,
        scenario_start=scenario_start,
        scenario_end=scenario_end,
    )

    session = SchedulingSession(
        session_id=session_id,
        filter_run_id=filter_run_id,
        candidate_links=links_by_id,
        user_overrides=user_overrides,
        satellite_configs=resolved_satellite_configs,
        conflict_structure=conflict_structure,
        active_scoring_strategy=scoring_strategy,
        scoring_parameters=params,
        scenario_start=scenario_start,
        scenario_end=scenario_end,
        current_plan=current_plan,
        satellite_buffer_profiles=satellite_profiles,
        asset_schedules=schedules_map,
    )

    SchedulingSessionRepository.save_session(session)
    return session


def _apply_session_downlink_rates(
    links: List[LinkBlock],
    satellite_configs: Dict[str, SatelliteBufferConfig],
) -> List[LinkBlock]:
    """
    The session's buffer configuration is the authority on each satellite's downlink
    rate, so pass capacities are re-derived from it rather than trusting the rate the
    filter run happened to use. duration_seconds is the elevation-trimmed duration the
    filter pipeline multiplied by, so the result matches a re-filter exactly. Changed
    links are copied, leaving the filter run's stored links untouched.
    """
    reconciled: List[LinkBlock] = []
    for link in links:
        config = satellite_configs.get(link.satellite_name)
        if config is None or link.duration_seconds <= 0.0:
            reconciled.append(link)
            continue
        capacity_mb = round(link.duration_seconds * config.downlink_rate_mbps, 2)
        if capacity_mb == link.estimated_data_capacity_mb:
            reconciled.append(link)
        else:
            reconciled.append(replace(link, estimated_data_capacity_mb=capacity_mb))
    return reconciled


def resolve_buffer_configs(
    satellite_names: Iterable[str],
    default_buffer_config: Optional[SatelliteBufferConfigDTO] = None,
    satellite_buffer_configs: Optional[Dict[str, SatelliteBufferOverrideDTO]] = None,
) -> Dict[str, SatelliteBufferConfig]:
    """
    Resolves the effective buffer configuration of every satellite in the session:
    the default, with each satellite's override applied field by field.
    Raises ValueError for overrides naming a satellite that has no candidate links.
    """
    names = set(satellite_names)
    overrides = satellite_buffer_configs or {}
    unknown = sorted(set(overrides) - names)
    if unknown:
        raise ValueError(
            f"Buffer overrides given for satellites without candidate links: {', '.join(unknown)}."
        )
    return {
        sat: merge_buffer_config(sat, default_buffer_config, overrides.get(sat))
        for sat in sorted(names)
    }


def create_session_from_config(
    filter_run_id: str,
    candidate_links: List[LinkBlock],
    scenario_start: datetime,
    scenario_end: datetime,
    asset_schedules: Optional[Dict[str, List[Activity]]] = None,
    scoring_config: Optional[Any] = None,
    satellite_buffer_configs: Optional[Dict[str, SatelliteBufferOverrideDTO]] = None,
    default_buffer_config: Optional[SatelliteBufferConfigDTO] = None,
    session_id: Optional[str] = None,
    scheduler: Optional[BaseScheduler] = None,
) -> SchedulingSession:
    """
    Convenience factory that accepts config DTOs directly, unpacks them to domain
    representations, and delegates to create_session.
    """
    scoring_rule = None
    scoring_strategy = "buffer_overflow_avoidance"
    scoring_parameters = None
    if scoring_config is not None:
        scoring_strategy = getattr(scoring_config, "name", "buffer_overflow_avoidance")
        scoring_parameters = getattr(scoring_config, "parameters", None)
        if hasattr(scoring_config, "to_domain"):
            scoring_rule = scoring_config.to_domain()

    sat_configs = resolve_buffer_configs(
        satellite_names=(link.satellite_name for link in candidate_links),
        default_buffer_config=default_buffer_config,
        satellite_buffer_configs=satellite_buffer_configs,
    )

    return create_session(
        filter_run_id=filter_run_id,
        candidate_links=candidate_links,
        scenario_start=scenario_start,
        scenario_end=scenario_end,
        asset_schedules=asset_schedules,
        satellite_configs=sat_configs,
        scoring_strategy=scoring_strategy,
        scoring_parameters=scoring_parameters,
        scoring_rule=scoring_rule,
        session_id=session_id,
        scheduler=scheduler,
    )


def get_session(session_id: str) -> Optional[SchedulingSession]:
    """Retrieves a session by session_id."""
    return SchedulingSessionRepository.get_session(session_id)


def apply_override(
    session_id: str,
    link_id: str,
    override_state: OverrideState,
    scheduler: Optional[BaseScheduler] = None,
    scoring_rule: Optional[BaseScoringRule] = None,
) -> SchedulingSession:
    """
    Applies a user override (PINNED / EXCLUDED / AUTO) and re-evaluates the schedule.
    Raises ValueError if session or link not found.
    """
    session = SchedulingSessionRepository.get_session(session_id)
    if not session:
        raise ValueError(f"SchedulingSession '{session_id}' not found.")

    if link_id not in session.candidate_links:
        raise ValueError(f"Link '{link_id}' does not exist in session '{session_id}'.")

    if override_state == OverrideState.AUTO:
        session.user_overrides.pop(link_id, None)
    elif override_state == OverrideState.PINNED:
        if session.conflict_structure and session.conflict_structure.adjacency_list:
            conflicts = session.conflict_structure.adjacency_list.get(link_id, set())
            for conflict_id in conflicts:
                if session.user_overrides.get(conflict_id) == OverrideState.PINNED:
                    session.user_overrides.pop(conflict_id, None)
        session.user_overrides[link_id] = OverrideState.PINNED
    else:
        session.user_overrides[link_id] = override_state

    active_scheduler = scheduler or _default_scheduler
    params = session.scoring_parameters or {}
    active_scoring = scoring_rule or get_scoring_rule(session.active_scoring_strategy, **params)

    current_plan, satellite_profiles = active_scheduler.solve(
        candidate_links=session.candidate_links,
        user_overrides=session.user_overrides,
        satellite_configs=session.satellite_configs,
        conflict_structure=session.conflict_structure,
        asset_schedules=session.asset_schedules,
        scoring_rule=active_scoring,
        scenario_start=session.scenario_start,
        scenario_end=session.scenario_end,
    )

    session.current_plan = current_plan
    session.satellite_buffer_profiles = satellite_profiles
    SchedulingSessionRepository.save_session(session)
    return session


def update_strategy(
    session_id: str,
    scoring_strategy: str,
    scoring_parameters: Optional[Dict[str, Any]] = None,
    scheduler: Optional[BaseScheduler] = None,
    scoring_rule: Optional[BaseScoringRule] = None,
) -> SchedulingSession:
    """
    Updates the scoring strategy and re-runs the solver.
    Raises ValueError if session not found.
    """
    session = SchedulingSessionRepository.get_session(session_id)
    if not session:
        raise ValueError(f"SchedulingSession '{session_id}' not found.")

    session.active_scoring_strategy = scoring_strategy
    params = dict(scoring_parameters or {})
    session.scoring_parameters = params

    active_scheduler = scheduler or _default_scheduler
    active_scoring = scoring_rule or get_scoring_rule(scoring_strategy, **params)

    current_plan, satellite_profiles = active_scheduler.solve(
        candidate_links=session.candidate_links,
        user_overrides=session.user_overrides,
        satellite_configs=session.satellite_configs,
        conflict_structure=session.conflict_structure,
        asset_schedules=session.asset_schedules,
        scoring_rule=active_scoring,
        scenario_start=session.scenario_start,
        scenario_end=session.scenario_end,
    )

    session.current_plan = current_plan
    session.satellite_buffer_profiles = satellite_profiles
    SchedulingSessionRepository.save_session(session)
    return session


def update_buffer_configs(
    session_id: str,
    default_buffer_config: Optional[SatelliteBufferConfigDTO] = None,
    satellite_buffer_configs: Optional[Dict[str, SatelliteBufferOverrideDTO]] = None,
    scheduler: Optional[BaseScheduler] = None,
) -> SchedulingSession:
    """
    Replaces the session's buffer configuration and re-runs the solver, keeping the
    operator's pin/exclude overrides and the scoring strategy. Pass capacities are
    re-derived when a downlink rate changes. Raises SessionNotFoundError if the
    session does not exist and ValueError if the configuration is invalid.
    """
    session = SchedulingSessionRepository.get_session(session_id)
    if not session:
        raise SessionNotFoundError(f"SchedulingSession '{session_id}' not found.")

    satellite_configs = resolve_buffer_configs(
        satellite_names=(link.satellite_name for link in session.candidate_links.values()),
        default_buffer_config=default_buffer_config,
        satellite_buffer_configs=satellite_buffer_configs,
    )
    reconciled_links = _apply_session_downlink_rates(list(session.candidate_links.values()), satellite_configs)

    active_scheduler = scheduler or _default_scheduler
    active_scoring = get_scoring_rule(session.active_scoring_strategy, **(session.scoring_parameters or {}))
    candidate_links = {link.link_id: link for link in reconciled_links}

    current_plan, satellite_profiles = active_scheduler.solve(
        candidate_links=candidate_links,
        user_overrides=session.user_overrides,
        satellite_configs=satellite_configs,
        conflict_structure=session.conflict_structure,
        asset_schedules=session.asset_schedules,
        scoring_rule=active_scoring,
        scenario_start=session.scenario_start,
        scenario_end=session.scenario_end,
    )

    # Only mutate the stored session once the new configuration solved successfully.
    session.candidate_links = candidate_links
    session.satellite_configs = satellite_configs
    session.current_plan = current_plan
    session.satellite_buffer_profiles = satellite_profiles
    SchedulingSessionRepository.save_session(session)
    return session


def commit_to_satos(session_id: str, user: Optional[str] = None) -> CommitResponseDTO:
    """
    Transforms all active scheduled links into SatOS Activity models and pushes them.
    Raises ValueError if session not found.
    """
    session = SchedulingSessionRepository.get_session(session_id)
    if not session:
        raise ValueError(f"SchedulingSession '{session_id}' not found.")

    scheduled_statuses = [
        status for status in session.current_plan.values() if status.is_scheduled
    ]

    if not scheduled_statuses:
        return CommitResponseDTO(
            session_id=session_id,
            committed_links_count=0,
            created_activities_count=0,
            status="synchronized (empty plan)",
        )

    from app.repositories.asset_repository import AssetRepository

    activities = AssetRepository.create_activities_from_link_blocks(
        scheduled_statuses,
        user=user,
    )
    AssetRepository.push_activities_to_satos(activities)

    return CommitResponseDTO(
        session_id=session_id,
        committed_links_count=len(scheduled_statuses),
        created_activities_count=len(activities),
        status="synchronized",
    )
