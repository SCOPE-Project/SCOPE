# app/routers/schedule.py
from fastapi import APIRouter, HTTPException

from core.models.scheduling import OverrideState
from app.services import scheduling_service
from app.models.scheduling import (
    SessionPlanDTO,
    OverrideRequest,
    StrategyUpdateRequest,
    CommitRequestDTO,
    CommitResponseDTO,
)

router = APIRouter(prefix="/schedule", tags=["Interactive Scheduling Session"])


@router.get("/session/{session_id}", response_model=SessionPlanDTO)
def get_session_plan(session_id: str):
    """
    Retrieves the current state, active plan, trade-off groups, and buffer profiles for a session.
    """
    session = scheduling_service.get_session(session_id)
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
            detail=f"Invalid override_state '{payload.override_state}'. Must be 'auto', 'pinned', or 'excluded'.",
        )

    try:
        session = scheduling_service.apply_override(
            session_id=session_id,
            link_id=payload.link_id,
            override_state=override_state,
        )
        return SessionPlanDTO.from_domain(session)
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
        scoring_rule = payload.to_domain()
        session = scheduling_service.update_strategy(
            session_id=session_id,
            scoring_strategy=payload.name,
            scoring_parameters=payload.parameters,
            scoring_rule=scoring_rule,
        )
        return SessionPlanDTO.from_domain(session)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update strategy: {e}")


@router.post("/session/{session_id}/commit", response_model=CommitResponseDTO)
def commit_schedule_to_satos(session_id: str, payload: CommitRequestDTO | None = None):
    """
    Transforms all active scheduled links into SatOS Activity and ScheduleEvent models,
    and commits them to the central SatOS schedule.
    """
    user = payload.user if payload else None
    try:
        return scheduling_service.commit_to_satos(session_id, user=user)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to commit activities to SatOS: {e}")
