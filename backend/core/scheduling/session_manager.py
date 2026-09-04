# core/scheduling/session_manager.py
import uuid
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any

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


class SchedulingSessionManager:
    """Thread-safe in-memory manager for interactive scheduling sessions."""
    
    _sessions: Dict[str, SchedulingSession] = {}
    _lock = threading.Lock()
    _default_scheduler: BaseScheduler = ForwardSimulationScheduler()

    @classmethod
    def create_session(
        cls,
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
        session_id: Optional[str] = None,
        scheduler: Optional[BaseScheduler] = None,
        scoring_rule: Optional[BaseScoringRule] = None,
    ) -> SchedulingSession:
        """
        Creates a new SchedulingSession from candidate links, builds the conflict graph,
        and computes the initial forward simulation schedule using the injected scheduler and scoring rule.
        """
        if scenario_start is None or scenario_end is None:
            raise ValueError("SchedulingSessionManager.create_session requires explicit scenario_start and scenario_end.")

        if session_id is None:
            session_id = str(uuid.uuid4())

        links_by_id: Dict[str, LinkBlock] = {l.link_id: l for l in candidate_links if l.link_id}
        schedulable_links = [l for l in candidate_links if l.is_eligible and l.is_available]

        # Build conflict graph over schedulable links
        conflict_structure = build_conflict_structure(schedulable_links)

        # Set up satellite buffer configurations
        resolved_satellite_configs: Dict[str, SatelliteBufferConfig] = dict(satellite_configs or {})

        # Ensure every satellite present in candidate_links has a complete config
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

        user_overrides: Dict[str, OverrideState] = {}
        schedules_map = asset_schedules or {}

        active_scheduler = scheduler or cls._default_scheduler
        params = dict(scoring_parameters or {})

        active_scoring = scoring_rule or get_scoring_rule(scoring_strategy, **params)

        # Run initial forward simulation
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

        with cls._lock:
            cls._sessions[session_id] = session

        return session

    @classmethod
    def create_session_from_config(
        cls,
        filter_run_id: str,
        candidate_links: List[LinkBlock],
        scenario_start: datetime,
        scenario_end: datetime,
        asset_schedules: Optional[Dict[str, List[Activity]]] = None,
        scoring_config: Optional[Any] = None,
        satellite_buffer_configs: Optional[Dict[str, Any]] = None,
        default_buffer_config: Optional[Any] = None,
        session_id: Optional[str] = None,
        scheduler: Optional[BaseScheduler] = None,
    ) -> SchedulingSession:
        """
        Convenience factory that accepts config objects / DTOs directly,
        unpacks and converts them to domain representations, resolves defaults,
        and delegates to create_session.
        """
        scoring_rule = None
        scoring_strategy = "buffer_overflow_avoidance"
        scoring_parameters = None
        if scoring_config is not None:
            scoring_strategy = getattr(scoring_config, "name", "buffer_overflow_avoidance")
            scoring_parameters = getattr(scoring_config, "parameters", None)
            if hasattr(scoring_config, "to_domain"):
                scoring_rule = scoring_config.to_domain()

        sat_configs: Dict[str, SatelliteBufferConfig] = {}
        if satellite_buffer_configs:
            for sat_name, cfg in satellite_buffer_configs.items():
                if hasattr(cfg, "to_domain"):
                    sat_configs[sat_name] = cfg.to_domain(sat_name)
                elif isinstance(cfg, SatelliteBufferConfig):
                    sat_configs[sat_name] = cfg

        def_cap = getattr(default_buffer_config, "capacity_mb", DEFAULT_BUFFER_CAPACITY_MB) if default_buffer_config else DEFAULT_BUFFER_CAPACITY_MB
        def_init = getattr(default_buffer_config, "initial_level_mb", DEFAULT_BUFFER_INITIAL_LEVEL_MB) if default_buffer_config else DEFAULT_BUFFER_INITIAL_LEVEL_MB
        def_gen = getattr(default_buffer_config, "payload_generation_rate_mbps", DEFAULT_PAYLOAD_GENERATION_RATE_MBPS) if default_buffer_config else DEFAULT_PAYLOAD_GENERATION_RATE_MBPS
        def_dl = getattr(default_buffer_config, "downlink_rate_mbps", DEFAULT_DOWNLINK_RATE_MBPS) if default_buffer_config else DEFAULT_DOWNLINK_RATE_MBPS

        return cls.create_session(
            filter_run_id=filter_run_id,
            candidate_links=candidate_links,
            scenario_start=scenario_start,
            scenario_end=scenario_end,
            asset_schedules=asset_schedules,
            satellite_configs=sat_configs if sat_configs else None,
            default_capacity_mb=def_cap,
            default_initial_level_mb=def_init,
            default_payload_generation_rate_mbps=def_gen,
            default_downlink_rate_mbps=def_dl,
            scoring_strategy=scoring_strategy,
            scoring_parameters=scoring_parameters,
            scoring_rule=scoring_rule,
            session_id=session_id,
            scheduler=scheduler,
        )

    @classmethod
    def apply_override(
        cls,
        session_id: str,
        link_id: str,
        override_state: OverrideState,
        scheduler: Optional[BaseScheduler] = None,
        scoring_rule: Optional[BaseScoringRule] = None,
    ) -> SchedulingSession:
        """
        Synchronously applies a user override (PINNED / EXCLUDED / AUTO) and re-evaluates
        the schedule via the scheduler.
        """
        with cls._lock:
            session = cls._sessions.get(session_id)
            if not session:
                raise ValueError(f"SchedulingSession '{session_id}' not found.")

            if link_id not in session.candidate_links:
                raise ValueError(f"Link '{link_id}' does not exist in session '{session_id}'.")

            # Update override state
            if override_state == OverrideState.AUTO:
                session.user_overrides.pop(link_id, None)
            elif override_state == OverrideState.PINNED:
                # Auto-unpin any conflicting links that are currently pinned
                if session.conflict_structure and session.conflict_structure.adjacency_list:
                    conflicts = session.conflict_structure.adjacency_list.get(link_id, set())
                    for conflict_id in conflicts:
                        if session.user_overrides.get(conflict_id) == OverrideState.PINNED:
                            session.user_overrides.pop(conflict_id, None)
                session.user_overrides[link_id] = OverrideState.PINNED
            else:
                session.user_overrides[link_id] = override_state

            active_scheduler = scheduler or cls._default_scheduler
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
            return session

    @classmethod
    def update_strategy(
        cls,
        session_id: str,
        scoring_strategy: str,
        scoring_parameters: Optional[Dict[str, Any]] = None,
        scheduler: Optional[BaseScheduler] = None,
        scoring_rule: Optional[BaseScoringRule] = None,
    ) -> SchedulingSession:
        """Updates scoring strategy and re-runs solver."""
        with cls._lock:
            session = cls._sessions.get(session_id)
            if not session:
                raise ValueError(f"SchedulingSession '{session_id}' not found.")

            session.active_scoring_strategy = scoring_strategy
            params = dict(scoring_parameters or {})
            session.scoring_parameters = params

            active_scheduler = scheduler or cls._default_scheduler
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
            return session


    @classmethod
    def get_session(cls, session_id: str) -> Optional[SchedulingSession]:
        """Retrieves a session by session_id."""
        with cls._lock:
            return cls._sessions.get(session_id)

    @classmethod
    def list_sessions(cls) -> List[str]:
        """Lists all active session IDs."""
        with cls._lock:
            return list(cls._sessions.keys())

    @classmethod
    def clear(cls) -> None:
        """Clears all sessions."""
        with cls._lock:
            cls._sessions.clear()
