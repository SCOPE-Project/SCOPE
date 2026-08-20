# core/scheduling/session_manager.py
import uuid
import threading
from typing import Dict, List, Optional

from core.models.scheduling import (
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
        asset_schedules: Optional[Dict[str, List[Activity]]] = None,
        initial_buffer_levels_mb: Optional[Dict[str, float]] = None,
        scoring_strategy: str = "buffer_overflow_avoidance",
        urgency_alpha: float = 2.0,
        session_id: Optional[str] = None,
        scheduler: Optional[BaseScheduler] = None,
        scoring_rule: Optional[BaseScoringRule] = None,
    ) -> SchedulingSession:
        """
        Creates a new SchedulingSession from candidate links, builds the conflict graph,
        and computes the initial forward simulation schedule using the injected scheduler and scoring rule.
        """
        if session_id is None:
            session_id = str(uuid.uuid4())

        links_by_id: Dict[str, LinkBlock] = {l.link_id: l for l in candidate_links}
        eligible_links = [l for l in candidate_links if l.is_eligible]

        # Build conflict graph over eligible links
        conflict_structure = build_conflict_structure(eligible_links)

        # Set up satellite buffer configurations
        initial_buffers = initial_buffer_levels_mb or {}
        satellite_configs: Dict[str, SatelliteBufferConfig] = {}

        for link in candidate_links:
            sat = link.satellite_name
            if sat not in satellite_configs:
                satellite_configs[sat] = SatelliteBufferConfig(
                    satellite_name=sat,
                    capacity_mb=2000.0,
                    initial_level_mb=initial_buffers.get(sat, 0.0),
                    payload_generation_rate_mbps=15.0,
                    downlink_rate_mbps=25.0,
                )

        user_overrides: Dict[str, OverrideState] = {}
        schedules_map = asset_schedules or {}

        active_scheduler = scheduler or cls._default_scheduler
        active_scoring = scoring_rule or get_scoring_rule(scoring_strategy, urgency_alpha=urgency_alpha)

        # Run initial forward simulation
        current_plan, satellite_profiles = active_scheduler.solve(
            candidate_links=links_by_id,
            user_overrides=user_overrides,
            satellite_configs=satellite_configs,
            conflict_structure=conflict_structure,
            asset_schedules=schedules_map,
            scoring_rule=active_scoring,
        )

        session = SchedulingSession(
            session_id=session_id,
            filter_run_id=filter_run_id,
            candidate_links=links_by_id,
            user_overrides=user_overrides,
            satellite_configs=satellite_configs,
            conflict_structure=conflict_structure,
            active_scoring_strategy=scoring_strategy,
            current_plan=current_plan,
            satellite_buffer_profiles=satellite_profiles,
            asset_schedules=schedules_map,
        )

        with cls._lock:
            cls._sessions[session_id] = session

        return session

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
            else:
                session.user_overrides[link_id] = override_state

            active_scheduler = scheduler or cls._default_scheduler
            active_scoring = scoring_rule or get_scoring_rule(session.active_scoring_strategy)

            current_plan, satellite_profiles = active_scheduler.solve(
                candidate_links=session.candidate_links,
                user_overrides=session.user_overrides,
                satellite_configs=session.satellite_configs,
                conflict_structure=session.conflict_structure,
                asset_schedules=session.asset_schedules,
                scoring_rule=active_scoring,
            )

            session.current_plan = current_plan
            session.satellite_buffer_profiles = satellite_profiles
            return session

    @classmethod
    def update_strategy(
        cls,
        session_id: str,
        scoring_strategy: str,
        urgency_alpha: float = 2.0,
        scheduler: Optional[BaseScheduler] = None,
        scoring_rule: Optional[BaseScoringRule] = None,
    ) -> SchedulingSession:
        """Updates scoring strategy and re-runs solver."""
        with cls._lock:
            session = cls._sessions.get(session_id)
            if not session:
                raise ValueError(f"SchedulingSession '{session_id}' not found.")

            session.active_scoring_strategy = scoring_strategy
            active_scheduler = scheduler or cls._default_scheduler
            active_scoring = scoring_rule or get_scoring_rule(scoring_strategy, urgency_alpha=urgency_alpha)

            current_plan, satellite_profiles = active_scheduler.solve(
                candidate_links=session.candidate_links,
                user_overrides=session.user_overrides,
                satellite_configs=session.satellite_configs,
                conflict_structure=session.conflict_structure,
                asset_schedules=session.asset_schedules,
                scoring_rule=active_scoring,
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
