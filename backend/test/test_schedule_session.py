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


def test_session_manager_custom_buffer_configs():
    from core.models.scheduling import SatelliteBufferConfig

    filter_id = "test_custom_buf"
    t_start = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="L1", overpass_id="op1", satellite_name="Sat-Alpha", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)
    l2 = LinkBlock(link_id="L2", overpass_id="op2", satellite_name="Sat-Beta", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)

    LinkRepository.save_links(filter_id, [l1, l2])

    # 1. Custom configs via explicit SatelliteBufferConfig
    custom_cfg = {
        "Sat-Alpha": SatelliteBufferConfig(
            satellite_name="Sat-Alpha",
            capacity_mb=5000.0,
            initial_level_mb=1200.0,
            payload_generation_rate_mbps=30.0,
            downlink_rate_mbps=60.0,
        )
    }

    session = SchedulingSessionManager.create_session(
        filter_run_id=filter_id,
        candidate_links=[l1, l2],
        satellite_configs=custom_cfg,
        buffer_capacities_mb={"Sat-Beta": 3500.0},
        initial_buffer_levels_mb={"Sat-Beta": 400.0},
        payload_generation_rates_mbps={"Sat-Beta": 10.0},
        downlink_rates_mbps={"Sat-Beta": 40.0},
        default_capacity_mb=2000.0,
    )

    assert session.satellite_configs["Sat-Alpha"].capacity_mb == 5000.0
    assert session.satellite_configs["Sat-Alpha"].initial_level_mb == 1200.0
    assert session.satellite_configs["Sat-Alpha"].payload_generation_rate_mbps == 30.0
    assert session.satellite_configs["Sat-Alpha"].downlink_rate_mbps == 60.0

    assert session.satellite_configs["Sat-Beta"].capacity_mb == 3500.0
    assert session.satellite_configs["Sat-Beta"].initial_level_mb == 400.0
    assert session.satellite_configs["Sat-Beta"].payload_generation_rate_mbps == 10.0
    assert session.satellite_configs["Sat-Beta"].downlink_rate_mbps == 40.0


def test_trade_off_request_with_buffer_configs_dto():
    from app.models.tasks import TradeOffRequest
    from app.models.scheduling import SatelliteBufferConfigDTO, SessionPlanDTO
    from app.services.task_orchestrator import run_process_trade_offs_task
    from app.services import state_manager

    filter_id = "test_dto_filter"
    t_start = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="L_DTO_1", overpass_id="op1", satellite_name="Sat-X", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)
    LinkRepository.save_links(filter_id, [l1])

    req = TradeOffRequest(
        filter_run_id=filter_id,
        satellite_buffer_configs={
            "Sat-X": SatelliteBufferConfigDTO(
                capacity_mb=4000.0,
                initial_level_mb=800.0,
                payload_generation_rate_mbps=20.0,
                downlink_rate_mbps=50.0,
            )
        },
        default_buffer_config=SatelliteBufferConfigDTO(
            capacity_mb=1000.0,
            initial_level_mb=100.0,
            payload_generation_rate_mbps=5.0,
            downlink_rate_mbps=10.0,
        ),
    )

    task_id = state_manager.create_task_entry()

    run_process_trade_offs_task(
        task_id=task_id,
        filter_run_id=req.filter_run_id,
        initial_buffer_levels_mb=req.initial_buffer_levels_mb,
        satellite_buffer_configs=req.satellite_buffer_configs,
        default_buffer_config=req.default_buffer_config,
        scoring_config=req.scoring_config,
    )

    result = state_manager.get_task_result(task_id)
    assert result.status == "completed"
    plan_payload: SessionPlanDTO = result.payload
    assert "Sat-X" in plan_payload.satellite_configs
    assert plan_payload.satellite_configs["Sat-X"].capacity_mb == 4000.0
    assert plan_payload.satellite_configs["Sat-X"].initial_level_mb == 800.0
    assert plan_payload.satellite_configs["Sat-X"].payload_generation_rate_mbps == 20.0
    assert plan_payload.satellite_configs["Sat-X"].downlink_rate_mbps == 50.0


def test_filter_pipeline_custom_downlink_rate():
    from core.models.propagation import PropagationResult, PropagationMetadata, OverpassBlock

    prop = PropagationResult(
        metadata=PropagationMetadata(
            run_id="test_run",
            start_time=datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc),
            global_track_step_seconds=10.0,
            overpass_profile_step_seconds=5.0,
        ),
        global_tracks=[],
        overpass_blocks=[
            OverpassBlock(
                overpass_id="op_sat1",
                satellite_name="Sat-1",
                groundstation_name="GS-1",
                start_time=datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc),
                end_time=datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc),
                duration_seconds=600.0,
                max_elevation_deg=45.0,
                high_res_trajectory=[],
            ),
            OverpassBlock(
                overpass_id="op_sat2",
                satellite_name="Sat-2",
                groundstation_name="GS-1",
                start_time=datetime(2026, 8, 18, 11, 0, 0, tzinfo=timezone.utc),
                end_time=datetime(2026, 8, 18, 11, 10, 0, tzinfo=timezone.utc),
                duration_seconds=600.0,
                max_elevation_deg=45.0,
                high_res_trajectory=[],
            )
        ]
    )

    _, links = derive_and_filter_links(
        propagation_result=prop,
        default_downlink_rate_mbps=10.0,
        satellite_downlink_rates_mbps={"Sat-2": 50.0},
    )

    link1 = next(l for l in links if l.satellite_name == "Sat-1")
    link2 = next(l for l in links if l.satellite_name == "Sat-2")

    assert link1.estimated_data_capacity_mb == 600.0 * 10.0   # 6000 MB
    assert link2.estimated_data_capacity_mb == 600.0 * 50.0   # 30000 MB

