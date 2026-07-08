from datetime import datetime
from app.services import state_manager
from core.orbit_engine import orekit_engine
from core.scheduling import scheduling
from models.domain import SatelliteInformation, GroundStationInformation, TimeInterval

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
        satellite_infos = [state_manager.get_asset(sat_id) for sat_id in selected_satellites]
        ground_station_infos = [state_manager.get_ground_station(gs_id) for gs_id in selected_groundstations]
        time_interval = TimeInterval(start_time=start_time, end_time=end_time)
        
        # Run the pure library, injecting the localized state update loop
        raw_results = orekit_engine.run_orekit_engine(
            task_id=task_id, 
            satellite_infos=satellite_infos, 
            ground_station_infos=ground_station_infos, 
            time_interval=time_interval, 
            on_progress_update=web_callback
        )
        state_manager.complete_task(task_id, payload=raw_results)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
        

def run_process_trade_offs_task(
        task_id: str, 
        selected_satellites: list[str]
    ):
    """
    Starts the trade-off analysis task.

    :param task_id: ID of the task
    :param selected_satellites: List of satellite names
    """
    def web_callback(*args, **kwargs):
        if len(args) == 3:
            _, message, progress = args
        elif len(args) == 2:
            message, progress = args
        elif len(args) == 1:
            message = "Computing trade-offs..."
            progress = 50
        else:
            return
        state_manager.update_task(task_id, status="processing", message=str(message), progress=int(progress))

    try:
        # Run the pure library, injecting the localized state update loop
        raw_results = scheduling.trade_off(selected_satellites, on_progress_update=web_callback)
        state_manager.complete_task(task_id, payload=raw_results)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
