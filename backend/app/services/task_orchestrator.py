from app.services import state_manager
from core.orbit import propagation
from core.scheduling import scheduling

def run_extract_overpasses_task(task_id: str, selected_satellites: list):
    """Bridges the pure core library to the web status tracking infrastructure."""
    def web_callback(message: str, progress: int):
        state_manager.update_task(task_id, status="processing", message=message, progress=progress)

    try:
        # Run the pure library, injecting the localized state update loop
        raw_results = propagation.propagate_orbit(selected_satellites, on_progress_update=web_callback)
        raw_results = propagation.extract_overpasses(selected_satellites, on_progress_update=web_callback)
        state_manager.complete_task(task_id, payload=raw_results)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
        

def run_process_trade_offs_task(task_id: str, selected_satellites: list):
    """Bridges the pure core library to the web status tracking infrastructure."""
    def web_callback(message: str, progress: int):
        state_manager.update_task(task_id, status="processing", message=message, progress=progress)

    try:
        # Run the pure library, injecting the localized state update loop
        raw_results = scheduling.trade_off(selected_satellites, on_progress_update=web_callback)
        state_manager.complete_task(task_id, payload=raw_results)
    except Exception as e:
        state_manager.update_task(task_id, status="failed", message=str(e), progress=100)
