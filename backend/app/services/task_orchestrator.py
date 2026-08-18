# app/services/task_orchestrator.py
from datetime import datetime
from typing import Optional, Dict
from app.services import state_manager
from core.orbit_engine import orekit_engine
from core.scheduling.filter_pipeline import derive_and_filter_links
from core.scheduling.session_manager import SchedulingSessionManager
from core.models.domain import SatelliteInformation, GroundStationInformation, TimeInterval
from app.services.asset_repository import AssetRepository
from app.models.propagation import PropagationResultDTO
from app.models.tasks import (
    FilterResultDTO,
    LinkBlockDTO,
    SessionPlanDTO,
)
from core.models.domain import PropagationResult, LinkEligibilityStatus


def run_orbit_engine_task(
        task_id: str, 
        selected_satellites: list[str], 
        selected_groundstations: list[str], 
        start_time: datetime, 
        end_time: datetime
    ):
    """
    Starts the orbit engine task.

    :param task_id: ID of the task
    :param selected_satellites: List of satellite names
    :param selected_groundstations: List of ground station names
    :param start_time: Start time for the orbit propagation
    :param end_time: End time for the orbit propagation
    """
    def web_callback(*args, **kwargs):
        if len(args) == 3:
            _, message, progress = args
        elif len(args) == 2:
            message, progress = args
        elif len(args) == 1:
            message = "Propagating orbit..."
            progress = 50
        else:
            return
        state_manager.update_task(task_id, status="processing", message=str(message), progress=int(progress))

    try:
        # Map input to Domain Models
        satellite_infos = [AssetRepository.get_satellite_information(sat_name) for sat_name in selected_satellites]
        groundstation_infos = [AssetRepository.get_groundstation_information(gs_name) for gs_name in selected_groundstations]
        time_interval = TimeInterval(start_time=start_time, end_time=end_time)
        
        # Run the pure library, injecting the localized state update loop
        propagation_results: PropagationResult = orekit_engine.run_orekit_engine(
            run_id=task_id, 
            satellite_infos=satellite_infos, 
            groundstation_infos=groundstation_infos, 
            time_interval=time_interval, 
            on_progress_update=web_callback
        )
        
        propagation_results_dto = PropagationResultDTO.from_domain(propagation_results)
        state_manager.complete_task(task_id, payload=propagation_results_dto)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)


def run_filter_links_task(
        task_id: str,
        orbit_engine_run_id: str,
        min_aos_los_elevation_deg: Optional[float] = None,
        min_peak_elevation_deg: Optional[float] = None,
    ):
    """
    Executes the dedicated link derivation and filtering task.
    """
    state_manager.update_task(task_id, status="processing", message="Filtering potential communication links...", progress=30)
    try:
        filter_run_id, links = derive_and_filter_links(
            orbit_engine_run_id=orbit_engine_run_id,
            min_aos_los_elevation_deg=min_aos_los_elevation_deg,
            min_peak_elevation_deg=min_peak_elevation_deg,
            filter_run_id=task_id,
        )

        eligible_count = sum(1 for l in links if l.is_eligible)
        baseline_blocked_count = sum(
            1 for l in links if l.eligibility_status == LinkEligibilityStatus.BLOCKED_BY_BASELINE_ACTIVITY
        )
        elev_excluded_count = sum(
            1 for l in links if l.eligibility_status == LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION
        )

        dto = FilterResultDTO(
            filter_run_id=filter_run_id,
            orbit_engine_run_id=orbit_engine_run_id,
            total_links_count=len(links),
            eligible_links_count=eligible_count,
            baseline_blocked_links_count=baseline_blocked_count,
            elevation_excluded_links_count=elev_excluded_count,
            links=[LinkBlockDTO.from_domain(l) for l in links],
        )

        state_manager.complete_task(task_id, payload=dto)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)


def run_process_trade_offs_task(
        task_id: str, 
        filter_run_id: str,
        initial_buffer_levels_mb: Optional[Dict[str, float]] = None,
        scoring_strategy: str = "buffer_overflow_avoidance",
        urgency_alpha: float = 2.0,
    ):
    """
    Starts the trade-off analysis task and initializes the in-memory SchedulingSession.
    """
    state_manager.update_task(task_id, status="processing", message="Computing trade-offs and resolving schedule...", progress=40)
    try:
        session = SchedulingSessionManager.create_session(
            filter_run_id=filter_run_id,
            initial_buffer_levels_mb=initial_buffer_levels_mb,
            scoring_strategy=scoring_strategy,
            urgency_alpha=urgency_alpha,
            session_id=task_id,
        )
        plan_dto = SessionPlanDTO.from_domain(session)
        state_manager.complete_task(task_id, payload=plan_dto)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
