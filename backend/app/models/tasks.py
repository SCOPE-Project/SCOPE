from pydantic import BaseModel, Field, conlist
from typing import List, Optional, Any
from datetime import datetime



# ========================================
# Task Input Models
# ========================================

class OrbitEngineRequest(BaseModel):
    """
    Request model for the OrbitEngine task.
    """
    satellites: List[str] = Field(..., min_items=1, description="List of satellite names")
    ground_stations: List[str] = Field(..., min_items=1, description="List of ground station names")
    start_time: datetime = Field(..., description="Start time for the orbit propagation")
    end_time: datetime = Field(..., description="End time for the orbit propagation")

class TradeOffRequest(BaseModel):
    """
    Request model for the trade off task.
    """ 
    satellites: list[str] = Field(..., min_items=1, description="List of satellite names") 



# ========================================
# General Task Response Models
# ========================================

class TaskStatusResponse(BaseModel):
    """
    Response Model that enforces a uniform structure for the frontend polling loop.
    """
    task_id: str
    status: str = Field(..., description="queued, processing, completed, or failed")
    message: str
    progress: int = Field(0, ge=0, le=100)
    created_at: datetime
    
class TaskReceiptResponse(BaseModel):
    """
    Response Model for a standard receipt returned immediately when a background task is queued.
    """
    task_id: str
    status: str = Field("Queued", description="The queue status of the task")
    
class TaskResultResponse(BaseModel):
    """
    Response Model for the result of a completed task.
    """
    task_id: str
    status: str = Field("Completed", description="The queue status of the task")
    payload: Any
