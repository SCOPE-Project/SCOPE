# app/routers/schedule.py
from fastapi import APIRouter, HTTPException

from core.models.domain import OverrideState
from core.scheduling.session_manager import SchedulingSessionManager
from app.services.asset_repository import AssetRepository
from app.services.satos_connector import push_activities_to_SatOS
from app.models.tasks import (
    SessionPlanDTO,
    OverrideRequest,
    StrategyUpdateRequest,
    CommitResponseDTO,
)

router = APIRouter(prefix="/schedule", tags=["Interactive Scheduling Session"])


@router.get("/session/{session_id}", response_model=SessionPlanDTO)
def get_session_plan(session_id: str):
    """
    Retrieves the current state, active plan, trade-off groups, and buffer profiles for a session.
    """
    session = SchedulingSessionManager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"SchedulingSession '{session_id}' not found.")
    return SessionPlanDTO.from_domain(session)


@router.post("/session/{session_id}/override", response_model=SessionPlanDTO)
def apply_link_override(session_id: str, payload: OverrideRequest):
    """
    Synchronously updates an operator override (PINNED / EXCLUDED / AUTO) and re-evaluates
    the forward simulation and satellite storage curves.
    """
    try:
        override_state = OverrideState(payload.override_state.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid override_state '{payload.override_state}'. Must be 'auto', 'pinned', or 'excluded'."
        )

    try:
        updated_session = SchedulingSessionManager.apply_override(
            session_id=session_id,
            link_id=payload.link_id,
            override_state=override_state,
        )
        return SessionPlanDTO.from_domain(updated_session)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply override: {e}")


@router.post("/session/{session_id}/strategy", response_model=SessionPlanDTO)
def update_scoring_strategy(session_id: str, payload: StrategyUpdateRequest):
    """
    Updates the active scoring strategy and re-runs the forward simulation.
    """
    try:
        updated_session = SchedulingSessionManager.update_strategy(
            session_id=session_id,
            scoring_strategy=payload.scoring_strategy,
            urgency_alpha=payload.urgency_alpha or 2.0,
        )
        return SessionPlanDTO.from_domain(updated_session)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update strategy: {e}")


@router.post("/session/{session_id}/commit", response_model=CommitResponseDTO)
def commit_schedule_to_satos(session_id: str):
    """
    Transforms all active scheduled links into SatOS Activity and ScheduleEvent models,
    and commits them to the central SatOS schedule.
    """
    session = SchedulingSessionManager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"SchedulingSession '{session_id}' not found.")

    # 1. Filter scheduled links
    scheduled_links = [
        status.link for status in session.current_plan.values() if status.is_scheduled
    ]

    if not scheduled_links:
        return CommitResponseDTO(
            session_id=session_id,
            committed_links_count=0,
            created_activities_count=0,
            status="synchronized (empty plan)",
        )

    try:
        # 2. Convert to SatOS Activity and Event models
        activities = AssetRepository.create_activities_from_link_blocks(scheduled_links)

        # 3. Push batch activities to SatOS
        push_activities_to_SatOS(activities)

        return CommitResponseDTO(
            session_id=session_id,
            committed_links_count=len(scheduled_links),
            created_activities_count=len(activities),
            status="synchronized",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit activities to SatOS: {e}")
