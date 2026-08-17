from pydantic import BaseModel, Field, conlist, UUID4, UUID7
from typing import List, Optional, Any, Union
from datetime import datetime
from dataclasses import dataclass

from core.models.domain import SatelliteInformation, GroundStationInformation
from app.models.propagation import PropagationResultDTO

from pydantic_models.activity import ActivityInfoModel
from pydantic_models.schedule_event import ScheduleEventModel

@dataclass
class Activity:
    uuid: UUID4 | UUID7
    schedule_name: str
    status: int
    start_event: ScheduleEventModel
    end_event: ScheduleEventModel
    name: str = ""
    description: str = ""
    priority: int = 0
    initiator: str | None = None
    executor: str | None = None


@dataclass
class AssetSchedule:
    name: str
    activities: list[Activity]


class AssetInformation(BaseModel):
    name: str
    eligible: bool
    classification: str  # "satellite", "groundstation", or "ineligible"
    details: Union[SatelliteInformation, GroundStationInformation, None] = None
    error: str | None = None


class AssetInitializationResponse(BaseModel):
    assets: list[AssetInformation]
    schedules: list[AssetSchedule]


# ========================================
# Task Input Models
# ========================================

class OrbitEngineRequest(BaseModel):
    """
    Request model for the OrbitEngine task.
    """
    satellites: List[str] = Field(..., min_items=1, description="List of satellite names")
    groundstations: List[str] = Field(..., min_items=1, description="List of ground station names")
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
    payload: Union[PropagationResultDTO, Any]
