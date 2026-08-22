# app/services/task_orchestrator.py
from datetime import datetime
from typing import Optional, Dict

from app.services import state_manager
from core.orbit_engine import orekit_engine
from core.scheduling.filter_pipeline import derive_and_filter_links
from core.scheduling.session_manager import SchedulingSessionManager
from core.models.assets import SatelliteInformation, GroundStationInformation, TimeInterval
from core.models.propagation import PropagationResult
from core.models.scheduling import LinkEligibilityStatus
from app.repositories import AssetRepository, PropagationResultRepository, LinkRepository
from app.models.propagation import PropagationResultDTO
from app.models.scheduling import (
    FilterResultDTO,
    LinkBlockDTO,
    SessionPlanDTO,
    ScoringStrategyConfigDTO,
    SatelliteBufferConfigDTO,
)


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
        
        # Save to repository
        PropagationResultRepository.save_result(propagation_results)

        propagation_results_dto = PropagationResultDTO.from_domain(propagation_results)
        state_manager.complete_task(task_id, payload=propagation_results_dto)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)


def run_filter_links_task(
    task_id: str,
    orbit_engine_run_id: str,
    min_aos_los_elevation_deg: Optional[float] = None,
    min_peak_elevation_deg: Optional[float] = None,
    default_downlink_rate_mbps: float = 25.0,
    satellite_downlink_rates_mbps: Optional[Dict[str, float]] = None,
):
    """
    Executes the dedicated link derivation and filtering task.
    """
    state_manager.update_task(task_id, status="processing", message="Filtering potential communication links...", progress=30)
    try:
        propagation_result = PropagationResultRepository.get_result(orbit_engine_run_id)
        if not propagation_result:
            raise ValueError(f"Propagation result for run_id '{orbit_engine_run_id}' not found in PropagationResultRepository.")

        asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

        filter_run_id, links = derive_and_filter_links(
            propagation_result=propagation_result,
            asset_schedules=asset_schedules,
            min_aos_los_elevation_deg=min_aos_los_elevation_deg,
            min_peak_elevation_deg=min_peak_elevation_deg,
            default_downlink_rate_mbps=default_downlink_rate_mbps,
            satellite_downlink_rates_mbps=satellite_downlink_rates_mbps,
            filter_run_id=task_id,
        )

        # Save to LinkRepository
        LinkRepository.save_links(filter_run_id, links)

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
    satellite_buffer_configs: Optional[Dict[str, SatelliteBufferConfigDTO]] = None,
    default_buffer_config: Optional[SatelliteBufferConfigDTO] = None,
    scoring_config: Optional[ScoringStrategyConfigDTO] = None,
):
    """
    Starts the trade-off analysis task and initializes the in-memory SchedulingSession.
    """
    state_manager.update_task(task_id, status="processing", message="Computing trade-offs and resolving schedule...", progress=40)
    try:
        candidate_links = LinkRepository.get_links(filter_run_id)
        if candidate_links is None:
            raise ValueError(f"No filtered links found for filter_run_id '{filter_run_id}'.")

        asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

        if scoring_config is None:
            scoring_config = ScoringStrategyConfigDTO()

        scoring_rule = scoring_config.to_domain()
        strat_name = scoring_config.name
        strat_params = scoring_config.parameters

        sat_configs = {}
        if satellite_buffer_configs:
            for sat_name, dto in satellite_buffer_configs.items():
                sat_configs[sat_name] = dto.to_domain(sat_name)

        def_cap = default_buffer_config.capacity_mb if default_buffer_config else 2000.0
        def_init = default_buffer_config.initial_level_mb if default_buffer_config else 0.0
        def_gen = default_buffer_config.payload_generation_rate_mbps if default_buffer_config else 15.0
        def_dl = default_buffer_config.downlink_rate_mbps if default_buffer_config else 25.0

        session = SchedulingSessionManager.create_session(
            filter_run_id=filter_run_id,
            candidate_links=candidate_links,
            asset_schedules=asset_schedules,
            satellite_configs=sat_configs if sat_configs else None,
            default_capacity_mb=def_cap,
            default_initial_level_mb=def_init,
            default_payload_generation_rate_mbps=def_gen,
            default_downlink_rate_mbps=def_dl,
            scoring_strategy=strat_name,
            scoring_parameters=strat_params,
            scoring_rule=scoring_rule,
            session_id=task_id,
        )
        plan_dto = SessionPlanDTO.from_domain(session)
        state_manager.complete_task(task_id, payload=plan_dto)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
