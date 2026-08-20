# app/models/tasks.py
from datetime import datetime
from typing import List, Optional, Dict, Union, Any
from pydantic import BaseModel, Field

from app.models.propagation import PropagationResultDTO
from app.models.scheduling import (
    FilterResultDTO,
    SessionPlanDTO,
    ScoringStrategyConfigDTO,
    SatelliteBufferConfigDTO,
)


# ========================================
# Task Input Models
# ========================================

class OrbitEngineRequest(BaseModel):
    """
    Request model for the OrbitEngine task.
    """
    satellites: List[str] = Field(..., min_length=1, description="List of satellite names")
    groundstations: List[str] = Field(..., min_length=1, description="List of ground station names")
    start_time: datetime = Field(..., description="Start time for the orbit propagation")
    end_time: datetime = Field(..., description="End time for the orbit propagation")


class FilterLinksRequest(BaseModel):
    """
    Request model for the Link Derivation and Filtering task.
    """
    orbit_engine_run_id: str = Field(..., description="Run ID of the completed orbit propagation task")
    min_aos_los_elevation_deg: Optional[float] = Field(default=None, description="Optional minimum elevation threshold to trim pass start/end")
    min_peak_elevation_deg: Optional[float] = Field(default=None, description="Optional minimum peak elevation required for pass eligibility")
    default_downlink_rate_mbps: Optional[float] = Field(default=25.0, description="Default downlink transmission data rate in MB/s")
    satellite_downlink_rates_mbps: Optional[Dict[str, float]] = Field(default=None, description="Optional per-satellite downlink transmission data rates in MB/s")


class TradeOffRequest(BaseModel):
    """
    Request model for the trade-off scheduling session task.
    """ 
    filter_run_id: str = Field(..., description="Run ID of the filtered links dataset")
    initial_buffer_levels_mb: Optional[Dict[str, float]] = Field(
        default=None,
        description="Initial satellite storage levels in MB (legacy/shorthand map: sat_name -> initial_level_mb)",
    )
    satellite_buffer_configs: Optional[Dict[str, SatelliteBufferConfigDTO]] = Field(
        default=None,
        description="Per-satellite buffer configuration overrides (capacity, initial level, generation rate, downlink rate)",
    )
    default_buffer_config: Optional[SatelliteBufferConfigDTO] = Field(
        default=None,
        description="Default buffer configuration applied to any satellite not explicitly configured in satellite_buffer_configs",
    )
    buffer_capacities_mb: Optional[Dict[str, float]] = Field(
        default=None,
        description="Optional shorthand map of per-satellite capacities in MB",
    )
    payload_generation_rates_mbps: Optional[Dict[str, float]] = Field(
        default=None,
        description="Optional shorthand map of per-satellite payload generation rates in MB/s",
    )
    downlink_rates_mbps: Optional[Dict[str, float]] = Field(
        default=None,
        description="Optional shorthand map of per-satellite downlink rates in MB/s",
    )
    scoring_config: ScoringStrategyConfigDTO = Field(
        default_factory=lambda: ScoringStrategyConfigDTO(name="buffer_overflow_avoidance", parameters={"alpha": 2.0, "exponent": 2.0}),
        description="Pluggable scoring strategy configuration and hyperparameters",
    )


# ========================================
# General Task Response & Polling Models
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
    payload: Union[PropagationResultDTO, FilterResultDTO, SessionPlanDTO, Any]
