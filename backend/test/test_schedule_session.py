import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from unittest.mock import patch

from core.models.scheduling import (
    LinkBlock,
    OverrideState,
)
from core.models.propagation import (
    PropagationResult,
    PropagationMetadata,
    OverpassBlock,
    OverpassProfilePoint,
)
from app.repositories import PropagationResultRepository, LinkRepository, AssetRepository
from core.scheduling.session_manager import SchedulingSessionManager
from core.scheduling.filter_pipeline import derive_and_filter_links
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_all():
    PropagationResultRepository.clear()
    LinkRepository.clear()
    SchedulingSessionManager.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()
    yield
    PropagationResultRepository.clear()
    LinkRepository.clear()
    SchedulingSessionManager.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()


def test_session_manager_lifecycle():
    # 1. Setup filtered links
    filter_id = "test_filt_01"
    t_start = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="L1", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)
    l2 = LinkBlock(link_id="L2", overpass_id="op2", satellite_name="Sat-2", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)

    LinkRepository.save_links(filter_id, [l1, l2])

    # 2. Create Session
    session = SchedulingSessionManager.create_session(
        filter_run_id=filter_id,
        candidate_links=[l1, l2],
        initial_buffer_levels_mb={"Sat-1": 100.0, "Sat-2": 500.0},
        scoring_strategy="buffer_overflow_avoidance",
        scoring_parameters={"alpha": 2.0},
        session_id="session_01",
    )

    assert session.session_id == "session_01"
    assert session.scoring_parameters == {"alpha": 2.0}
    assert session.current_plan["L2"].is_scheduled is True  # Sat-2 higher buffer wins

    # 3. Apply Override: Pin L1
    updated_session = SchedulingSessionManager.apply_override(
        session_id="session_01",
        link_id="L1",
        override_state=OverrideState.PINNED,
    )

    assert updated_session.current_plan["L1"].is_scheduled is True
    assert updated_session.current_plan["L2"].is_scheduled is False
    assert updated_session.scoring_parameters == {"alpha": 2.0}


def test_schedule_router_endpoints():
    # Setup data
    filter_id = "test_filt_router"
    t_start = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="link_01", overpass_id="op1", satellite_name="Sat-A", groundstation_name="GS-A", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=45.0)
    LinkRepository.save_links(filter_id, [l1])

    session = SchedulingSessionManager.create_session(
        filter_run_id=filter_id,
        candidate_links=[l1],
        initial_buffer_levels_mb={"Sat-A": 200.0},
        session_id="sess_router_test",
    )

    # 1. GET session
    res = client.get(f"/schedule/session/{session.session_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == "sess_router_test"
    assert "link_01" in data["current_plan"]
    assert "Sat-A" in data["satellite_buffer_profiles"]

    # 2. POST override
    res_ov = client.post(
        f"/schedule/session/{session.session_id}/override",
        json={"link_id": "link_01", "override_state": "excluded"}
    )
    assert res_ov.status_code == 200
    ov_data = res_ov.json()
    assert ov_data["current_plan"]["link_01"]["is_scheduled"] is False
    assert ov_data["current_plan"]["link_01"]["override_state"] == "excluded"

    # 3. POST strategy update (structured config)
    res_strat = client.post(
        f"/schedule/session/{session.session_id}/strategy",
        json={"name": "buffer_overflow_avoidance", "parameters": {"alpha": 3.5, "exponent": 2.5}}
    )
    assert res_strat.status_code == 200
    strat_data = res_strat.json()
    assert strat_data["active_scoring_strategy"] == "buffer_overflow_avoidance"
    assert strat_data["scoring_config"]["parameters"]["alpha"] == 3.5

    # 4. POST commit
    with patch("app.routers.schedule.push_activities_to_SatOS") as mock_push:
        res_commit = client.post(f"/schedule/session/{session.session_id}/commit")
        assert res_commit.status_code == 200
        assert res_commit.json()["status"] in ["synchronized", "synchronized (empty plan)"]


def test_trade_off_request_model_structured():
    from app.models.tasks import TradeOffRequest
    from app.models.scheduling import StrategyUpdateRequest, ScoringStrategyConfigDTO

    # 1. Clean structured request with dict
    req1 = TradeOffRequest(
        filter_run_id="filt_01",
        scoring_config={"name": "buffer_overflow_avoidance", "parameters": {"alpha": 5.0, "exponent": 3.0}}
    )
    assert req1.scoring_config.name == "buffer_overflow_avoidance"
    assert req1.scoring_config.parameters == {"alpha": 5.0, "exponent": 3.0}

    # 2. Structured request with ScoringStrategyConfigDTO instance
    req2 = TradeOffRequest(
        filter_run_id="filt_02",
        scoring_config=ScoringStrategyConfigDTO(
            name="max_downlink_throughput",
            parameters={"alpha": 1.5}
        )
    )
    assert req2.scoring_config.name == "max_downlink_throughput"
    assert req2.scoring_config.parameters == {"alpha": 1.5}

    # 3. StrategyUpdateRequest structured
    sreq1 = StrategyUpdateRequest(name="max_pass_duration", parameters={"weight": 1.0})
    assert sreq1.name == "max_pass_duration"
    assert sreq1.parameters == {"weight": 1.0}

    sreq2 = StrategyUpdateRequest(name="buffer_overflow_avoidance", parameters={"alpha": 2.0, "exponent": 3.0})
    assert sreq2.name == "buffer_overflow_avoidance"
    assert sreq2.parameters == {"alpha": 2.0, "exponent": 3.0}
