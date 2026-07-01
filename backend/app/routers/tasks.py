from fastapi import APIRouter, BackgroundTasks, HTTPException
from app.services import state_manager, task_orchestrator
from app.models.tasks import OrbitRequest

router = APIRouter(prefix="/tasks", tags=["Task Processing Workspace"])

@router.post("/extract-overpasses")
def trigger_extract_overpasses(payload: OrbitRequest, background_tasks: BackgroundTasks):
    """Triggers the heavy background thread instantly and returns a receipt handle."""
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(task_orchestrator.run_extract_overpasses_task, task_id=task_id, selected_satellites=payload.satellites)
    return {"task_id": task_id, "status": "Queued"}

@router.post("/process-trade-offs")
def trigger_process_trade_offs(payload: OrbitRequest, background_tasks: BackgroundTasks):
    """Triggers the heavy background thread instantly and returns a receipt handle."""
    task_id = state_manager.create_task_entry()
    background_tasks.add_task(task_orchestrator.run_process_trade_offs_task, task_id=task_id, selected_satellites=payload.satellites)
    return {"task_id": task_id, "status": "Queued"}

@router.get("/status/{task_id}")
def get_task_status(task_id: str):
    """Polymorphic polling node utilized globally across all storyboard phases."""
    task = state_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task ID not found.")
    return task