from fastapi import APIRouter, BackgroundTasks, HTTPException, Response

from app.services import state_manager, task_orchestrator

from app.models.tasks import (
    OrbitEngineRequest,
    FilterLinksRequest,
    TradeOffRequest,
    TaskStatusResponse,
    TaskResultResponse,
    TaskReceiptResponse,
)
from app.models.satos import (
    AssetInformation,
    AssetInitializationResponse,
)
from app.repositories import AssetRepository


router = APIRouter(prefix="/tasks", tags=["Task Processing Workspace"])

@router.get("/initialize", response_model=AssetInitializationResponse)
def initialize_assets(force_refresh: bool = False):
    was_cached = AssetRepository.initialize_repository(force_refresh=force_refresh)
    
    initialized_asset_infos = AssetRepository.get_assets()
    initialized_asset_schedules = AssetRepository.get_asset_schedules()
    return {
        "assets": initialized_asset_infos,
        "schedules": initialized_asset_schedules,
        "cached": was_cached,
        "source": "cache" if was_cached else "initialization",
    }

@router.post("/extract-overpasses", response_model=TaskReceiptResponse)
def trigger_orbit_engine(payload: OrbitEngineRequest, background_tasks: BackgroundTasks):
    """
    Triggers the heavy background thread for orbit propagation and returns a receipt handle.
    """
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(
        task_orchestrator.run_orbit_engine_task, 
        task_id=task_id, 
        selected_satellites=payload.satellites, 
        selected_groundstations=payload.groundstations, 
        start_time=payload.start_time, 
        end_time=payload.end_time
    )
    return {"task_id": task_id, "status": "Queued"}

@router.post("/filter-links", response_model=TaskReceiptResponse)
def trigger_filter_links(payload: FilterLinksRequest, background_tasks: BackgroundTasks):
    """
    Triggers the dedicated link derivation and filtering task against SatOS baseline activities.
    """
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(
        task_orchestrator.run_filter_links_task,
        task_id=task_id,
        orbit_engine_run_id=payload.orbit_engine_run_id,
        min_aos_los_elevation_deg=payload.min_aos_los_elevation_deg,
        min_peak_elevation_deg=payload.min_peak_elevation_deg,
        default_downlink_rate_mbps=payload.default_downlink_rate_mbps or 25.0,
        satellite_downlink_rates_mbps=payload.satellite_downlink_rates_mbps,
    )
    return {"task_id": task_id, "status": "Queued"}

@router.post("/process-trade-offs", response_model=TaskReceiptResponse)
def trigger_process_trade_offs(payload: TradeOffRequest, background_tasks: BackgroundTasks):
    """
    Triggers the trade-off analysis task and initializes the in-memory SchedulingSession.
    """
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(
        task_orchestrator.run_process_trade_offs_task,
        task_id=task_id,
        filter_run_id=payload.filter_run_id,
        satellite_buffer_configs=payload.satellite_buffer_configs,
        default_buffer_config=payload.default_buffer_config,
        scoring_config=payload.scoring_config,
    )
    return {"task_id": task_id, "status": "Queued"}

@router.get("/status/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str):
    """
    Polymorphic polling node utilized globally across all storyboard phases.
    """
    task = state_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task ID not found.")
    return task

@router.get("/status/{task_id}/result", response_model=TaskResultResponse)
def get_task_result(task_id: str):
    """
    Returns the final computation payload of a completed task.
    """
    task_result = state_manager.get_task_result(task_id)
    if not task_result:
        raise HTTPException(status_code=404, detail="Task ID not found.")
    
    if task_result.status != "completed":
        raise HTTPException(
            status_code=400, 
            detail=f"Task is in state '{task_result.status}' and has no result payload yet."
        )
            
    return Response(
        content=task_result.model_dump_json(),
        media_type="application/json"
    )