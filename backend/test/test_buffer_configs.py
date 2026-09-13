import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from pydantic import ValidationError

from core.models.scheduling import LinkBlock, OverrideState, SatelliteBufferConfig
from app.models.scheduling import SatelliteBufferConfigDTO, SatelliteBufferOverrideDTO
from app.models.tasks import TradeOffRequest
from app.repositories import LinkRepository, SchedulingSessionRepository, TaskRepository
from app.services import scheduling_service
from app.services.task_orchestrator import run_process_trade_offs_task
from app.main import app

client = TestClient(app)

T_START = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
T_END = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

DEFAULT = SatelliteBufferConfigDTO(
    capacity_mb=200_000.0,
    initial_level_mb=10_000.0,
    payload_generation_rate_mbps=4.0,
    downlink_rate_mbps=25.0,
)


@pytest.fixture(autouse=True)
def clean_all():
    LinkRepository.clear()
    SchedulingSessionRepository.clear()
    yield
    LinkRepository.clear()
    SchedulingSessionRepository.clear()


def _links():
    # Filter run computed capacities at 25 MB/s for a 600 s pass.
    return [
        LinkBlock(link_id="L1", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1", start_time=T_START, end_time=T_END, duration_seconds=600.0, max_elevation_deg=50.0, estimated_data_capacity_mb=15_000.0),
        LinkBlock(link_id="L2", overpass_id="op2", satellite_name="Sat-2", groundstation_name="GS-1", start_time=T_START, end_time=T_END, duration_seconds=600.0, max_elevation_deg=50.0, estimated_data_capacity_mb=15_000.0),
    ]


def _create_session(overrides=None, default=DEFAULT, session_id="sess_buf"):
    return scheduling_service.create_session_from_config(
        filter_run_id="filt_buf",
        candidate_links=_links(),
        scenario_start=T_START,
        scenario_end=T_END,
        default_buffer_config=default,
        satellite_buffer_configs=overrides,
        session_id=session_id,
    )


def test_sparse_override_inherits_unset_fields_from_request_default():
    session = _create_session({"Sat-2": SatelliteBufferOverrideDTO(payload_generation_rate_mbps=8.0)})

    sat2 = session.satellite_configs["Sat-2"]
    assert sat2.payload_generation_rate_mbps == 8.0
    # Inherited from the request default, not the backend constants (100 GB / 5 GB).
    assert sat2.capacity_mb == 200_000.0
    assert sat2.initial_level_mb == 10_000.0
    assert sat2.downlink_rate_mbps == 25.0

    assert session.satellite_configs["Sat-1"] == SatelliteBufferConfig("Sat-1", 200_000.0, 10_000.0, 4.0, 25.0)


def test_mixed_configs_reach_the_simulation_per_satellite():
    session = _create_session({"Sat-2": SatelliteBufferOverrideDTO(capacity_mb=50_000.0)})

    assert session.satellite_buffer_profiles["Sat-1"].capacity_mb == 200_000.0
    assert session.satellite_buffer_profiles["Sat-2"].capacity_mb == 50_000.0


def test_override_for_satellite_without_links_is_rejected():
    with pytest.raises(ValueError, match="Sat-Ghost"):
        _create_session({"Sat-Ghost": SatelliteBufferOverrideDTO(capacity_mb=1.0)})


def test_trade_off_task_fails_for_unknown_override_satellite():
    LinkRepository.save_links("filt_buf", _links(), start_time=T_START, end_time=T_END)
    task_id = TaskRepository.create_task_entry()

    run_process_trade_offs_task(
        task_id=task_id,
        filter_run_id="filt_buf",
        default_buffer_config=DEFAULT,
        satellite_buffer_configs={"Sat-Ghost": SatelliteBufferOverrideDTO(capacity_mb=1.0)},
    )

    task = TaskRepository.get_task(task_id)
    assert task.status == "failed"
    assert "Sat-Ghost" in task.message


def test_request_rejects_initial_level_above_capacity_after_merge():
    # The override alone is valid; only merged with the 10 GB default fill does it overflow.
    with pytest.raises(ValidationError, match="Sat-2"):
        TradeOffRequest(
            filter_run_id="filt_buf",
            default_buffer_config=DEFAULT,
            satellite_buffer_configs={"Sat-2": SatelliteBufferOverrideDTO(capacity_mb=5_000.0)},
        )

    with pytest.raises(ValidationError, match="initial_level_mb"):
        SatelliteBufferConfigDTO(capacity_mb=1_000.0, initial_level_mb=2_000.0)


def test_domain_config_enforces_physical_invariants():
    with pytest.raises(ValueError, match="initial buffer level"):
        SatelliteBufferConfig("Sat-1", capacity_mb=100.0, initial_level_mb=101.0, payload_generation_rate_mbps=1.0, downlink_rate_mbps=1.0)
    with pytest.raises(ValueError, match="downlink rate"):
        SatelliteBufferConfig("Sat-1", capacity_mb=100.0, initial_level_mb=0.0, payload_generation_rate_mbps=1.0, downlink_rate_mbps=0.0)


def test_session_downlink_rate_rederives_pass_capacity_without_touching_filter_links():
    links = _links()
    LinkRepository.save_links("filt_buf", links, start_time=T_START, end_time=T_END)

    session = scheduling_service.create_session_from_config(
        filter_run_id="filt_buf",
        candidate_links=LinkRepository.get_links("filt_buf"),
        scenario_start=T_START,
        scenario_end=T_END,
        default_buffer_config=DEFAULT,
        satellite_buffer_configs={"Sat-2": SatelliteBufferOverrideDTO(downlink_rate_mbps=50.0)},
        session_id="sess_rate",
    )

    assert session.candidate_links["L1"].estimated_data_capacity_mb == 15_000.0
    assert session.candidate_links["L2"].estimated_data_capacity_mb == 30_000.0
    stored = {l.link_id: l for l in LinkRepository.get_links("filt_buf")}
    assert stored["L2"].estimated_data_capacity_mb == 15_000.0


def test_update_buffer_configs_endpoint_keeps_overrides_and_rederives_capacity():
    session = _create_session()
    scheduling_service.apply_override(session.session_id, "L1", OverrideState.EXCLUDED)

    res = client.post(
        f"/schedule/session/{session.session_id}/buffer-configs",
        json={
            "default_buffer_config": DEFAULT.model_dump(exclude={"satellite_name"}),
            "satellite_buffer_configs": {
                "Sat-2": {"capacity_mb": 80_000.0, "downlink_rate_mbps": 10.0},
            },
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["satellite_configs"]["Sat-2"]["capacity_mb"] == 80_000.0
    assert data["satellite_configs"]["Sat-2"]["initial_level_mb"] == 10_000.0
    assert data["satellite_configs"]["Sat-1"]["capacity_mb"] == 200_000.0
    assert data["satellite_buffer_profiles"]["Sat-2"]["capacity_mb"] == 80_000.0
    assert data["current_plan"]["L2"]["link"]["estimated_data_capacity_mb"] == 6_000.0
    assert data["current_plan"]["L1"]["override_state"] == "excluded"

    # Full-replacement semantics: omitting the override restores the default.
    res_reset = client.post(
        f"/schedule/session/{session.session_id}/buffer-configs",
        json={"default_buffer_config": DEFAULT.model_dump(exclude={"satellite_name"})},
    )
    assert res_reset.status_code == 200
    reset = res_reset.json()
    assert reset["satellite_configs"]["Sat-2"]["capacity_mb"] == 200_000.0
    assert reset["current_plan"]["L2"]["link"]["estimated_data_capacity_mb"] == 15_000.0


def test_update_buffer_configs_endpoint_errors():
    session = _create_session()

    res_missing = client.post("/schedule/session/nope/buffer-configs", json={})
    assert res_missing.status_code == 404

    res_unknown = client.post(
        f"/schedule/session/{session.session_id}/buffer-configs",
        json={"satellite_buffer_configs": {"Sat-Ghost": {"capacity_mb": 50_000.0}}},
    )
    assert res_unknown.status_code == 400
    assert "Sat-Ghost" in res_unknown.json()["detail"]

    res_invalid = client.post(
        f"/schedule/session/{session.session_id}/buffer-configs",
        json={
            "default_buffer_config": DEFAULT.model_dump(exclude={"satellite_name"}),
            "satellite_buffer_configs": {"Sat-1": {"initial_level_mb": 500_000.0}},
        },
    )
    assert res_invalid.status_code == 422

    # A rejected update leaves the stored session unchanged.
    assert scheduling_service.get_session(session.session_id).satellite_configs["Sat-1"].capacity_mb == 200_000.0
