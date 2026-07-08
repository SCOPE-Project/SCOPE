from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.services import state_manager, task_orchestrator

from app.models.tasks import (
    OrbitEngineRequest, 
    TradeOffRequest,
    TaskStatusResponse,
    TaskResultResponse,
    TaskReceiptResponse
)

from app.models.tasks import InitializeRepositoryResponse

from app.services.asset_repository import AssetRepository

router = APIRouter(prefix="/tasks", tags=["Task Processing Workspace"])

@router.get("/initialize", response_model=InitializeRepositoryResponse)
def initialize_assets():
    initialized_assets = AssetRepository.initialize_repository()
    return {"assets": initialized_assets}

@router.post("/extract-overpasses", response_model=TaskReceiptResponse)
def trigger_orbit_engine(payload: OrbitEngineRequest, background_tasks: BackgroundTasks):
    """
    Triggers the heavy background thread instantly and returns a receipt handle.
    """
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(
        task_orchestrator.run_orbit_engine_task, 
        task_id=task_id, 
        selected_satellites=payload.satellites, 
        selected_groundstations=payload.ground_stations, 
        start_time=payload.start_time, 
        end_time=payload.end_time
    )
    return {"task_id": task_id, "status": "Queued"}

@router.post("/process-trade-offs", response_model=TaskReceiptResponse)
def trigger_process_trade_offs(payload: TradeOffRequest, background_tasks: BackgroundTasks):
    """
    Triggers the heavy background thread instantly and returns a receipt handle.
    """
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(task_orchestrator.run_process_trade_offs_task, task_id=task_id, selected_satellites=payload.satellites)
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
    
    return task_result