import pytest
import uuid
import subprocess
import sys
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from core.models.scheduling import LinkBlock
from core.models.propagation import OverpassProfilePoint
from core.models.activities import Activity, AssetSchedule
from app.models.satos import ScheduledLinkDTO
from app.repositories import PropagationResultRepository, AssetRepository
from app.services import satos_connector
from app.main import app


@pytest.fixture(autouse=True)
def clean_repositories():
    """Clear repositories and reset AssetRepository schedules between tests."""
    PropagationResultRepository.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()
    yield
    PropagationResultRepository.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()


def create_sample_scheduled_link(
    link_id: str = "L_0001",
    link_name: str = "link__Satellite-Alpha__GS-Kiruna__filter_0001__0001",
    overpass_id: str = "OP_0001",
    overpass_name: str = "pass__Satellite-Alpha__GS-Kiruna__001",
    sat_name: str = "Satellite-Alpha",
    gs_name: str = "GS-Kiruna",
) -> LinkBlock:
    start_time = datetime(2026, 8, 16, 12, 0, 0, tzinfo=timezone.utc)
    end_time = datetime(2026, 8, 16, 12, 10, 0, tzinfo=timezone.utc)
    point = OverpassProfilePoint(
        timestamp=start_time,
        latitude_deg=67.8,
        longitude_deg=20.2,
        altitude_m=500000.0,
        elevation_deg=45.0,
        azimuth_deg=180.0,
        range_m=700000.0,
    )
    return LinkBlock(
        link_id=link_id,
        link_name=link_name,
        overpass_id=overpass_id,
        overpass_name=overpass_name,
        satellite_name=sat_name,
        groundstation_name=gs_name,
        start_time=start_time,
        end_time=end_time,
        duration_seconds=600.0,
        max_elevation_deg=45.0,
        high_res_trajectory=[point],
    )


def test_create_activities_from_single_scheduled_link():
    link = create_sample_scheduled_link()
    sat_activity, gs_activity = AssetRepository.create_activities_from_link_block(link)

    expected_name = f"Pass {link.satellite_name} - {link.groundstation_name} at {link.start_time.isoformat()}"

    # Validate Satellite Activity
    assert sat_activity.schedule_name == "Satellite-Alpha"
    assert sat_activity.name == expected_name
    assert sat_activity.status == 2  # SUSPENDED
    assert isinstance(sat_activity.uuid, uuid.UUID)

    # Validate Ground Station Activity
    assert gs_activity.schedule_name == "GS-Kiruna"
    assert gs_activity.name == expected_name
    assert gs_activity.status == 2  # SUSPENDED
    assert isinstance(gs_activity.uuid, uuid.UUID)
    assert sat_activity.uuid != gs_activity.uuid

    # Validate Shared Events
    assert sat_activity.start_event.uuid == gs_activity.start_event.uuid
    assert sat_activity.end_event.uuid == gs_activity.end_event.uuid

    # Validate AOS Event
    aos = sat_activity.start_event
    assert aos.id == f"{link.link_id}_AOS"
    assert aos.name == "AOS: Satellite-Alpha - GS-Kiruna"
    assert aos.schedule_1 == "Satellite-Alpha"
    assert aos.schedule_2 == "GS-Kiruna"
    assert aos.timestamp == link.start_time

    # Validate LOS Event
    los = sat_activity.end_event
    assert los.id == f"{link.link_id}_LOS"
    assert los.name == "LOS: Satellite-Alpha - GS-Kiruna"
    assert los.schedule_1 == "Satellite-Alpha"
    assert los.schedule_2 == "GS-Kiruna"
    assert los.timestamp == link.end_time


def test_create_activities_from_multiple_scheduled_links():
    link1 = create_sample_scheduled_link(link_id="link_001", sat_name="Sat-1", gs_name="GS-1")
    link2 = create_sample_scheduled_link(link_id="link_002", sat_name="Sat-2", gs_name="GS-2")

    activities = AssetRepository.create_activities_from_link_blocks([link1, link2])

    assert len(activities) == 4
    schedule_names = [a.schedule_name for a in activities]
    assert schedule_names == ["Sat-1", "GS-1", "Sat-2", "GS-2"]


@patch("app.services.satos_connector.satos_put_activities")
@patch("app.services.satos_connector.satos_put_schedule_events")
@patch("app.services.satos_connector.SatIOSession")
def test_push_activities_to_satos_deduplication(mock_session, mock_put_events, mock_put_activities):
    mock_put_events.return_value = MagicMock(status_code=200)
    mock_put_activities.return_value = MagicMock(status_code=200)

    link = create_sample_scheduled_link()
    activities = AssetRepository.create_activities_from_link_blocks([link])
    assert len(activities) == 2

    # Call satos_connector.push_activities_to_SatOS directly
    satos_connector.push_activities_to_SatOS(activities)

    # 2 activities sharing 2 events -> should put exactly 2 unique schedule events, not 4
    mock_put_events.assert_called_once()
    passed_events = mock_put_events.call_args[0][0]
    assert len(passed_events) == 2

    # Should put 2 activities
    mock_put_activities.assert_called_once()
    passed_activities = mock_put_activities.call_args[0][0]
    assert len(passed_activities) == 2
    expected_name = f"Pass {link.satellite_name} - {link.groundstation_name} at {link.start_time.isoformat()}"
    assert passed_activities[0].name == expected_name
    assert passed_activities[1].name == expected_name


@patch("app.repositories.asset_repository.push_activities_to_SatOS")
def test_push_scheduled_links_to_satos_updates_local_cache(mock_push):
    link = create_sample_scheduled_link(link_id="link_001", sat_name="Sat-1", gs_name="GS-1")
    pushed = AssetRepository.push_scheduled_links_to_satos([link])

    assert len(pushed) == 2
    mock_push.assert_called_once_with(pushed)

    # Verify AssetRepository._schedules contains the new activities
    schedules = AssetRepository.get_asset_schedules()
    assert len(schedules) == 2
    sched_names = {s.name for s in schedules}
    assert sched_names == {"Sat-1", "GS-1"}


def test_create_activity_from_dto():
    from app.models.satos import ActivityDTO

    start_time = datetime(2026, 8, 16, 14, 0, 0, tzinfo=timezone.utc)
    end_time = datetime(2026, 8, 16, 14, 30, 0, tzinfo=timezone.utc)
    dto = ActivityDTO(
        schedule_name="Sat-Alpha",
        start_time=start_time,
        end_time=end_time,
        name="Payload Observation Run",
        description="Capture high resolution images",
        priority=5,
        status=2,
        initiator="MissionControl",
        executor="Sat-Alpha",
    )

    activity = AssetRepository.create_activity_from_dto(dto)

    assert activity.schedule_name == "Sat-Alpha"
    assert activity.name == "Payload Observation Run"
    assert activity.description == "Capture high resolution images"
    assert activity.priority == 5
    assert activity.status == 2
    assert activity.initiator == "MissionControl"
    assert activity.executor == "Sat-Alpha"
    assert isinstance(activity.uuid, uuid.UUID)

    assert activity.start_event is not None
    assert activity.start_event.timestamp == start_time
    assert activity.start_event.schedule_1 == "Sat-Alpha"

    assert activity.end_event is not None
    assert activity.end_event.timestamp == end_time
    assert activity.end_event.schedule_1 == "Sat-Alpha"


def test_utilities_router_push_scheduled_links_empty():
    client = TestClient(app)
    response = client.post("/utilities/schedule/push-scheduled-links", json={"scheduled_links": []})
    assert response.status_code == 200
    data = response.json()
    assert data["pushed_links_count"] == 0
    assert data["pushed_activities_count"] == 0


@patch("app.repositories.asset_repository.AssetRepository.push_scheduled_links_to_satos")
def test_utilities_router_push_scheduled_links_success(mock_push_repo):
    link = create_sample_scheduled_link(link_id="link_001", sat_name="Sat-A", gs_name="GS-A")
    mock_act1 = Activity(
        uuid=uuid.uuid4(),
        schedule_name="Sat-A",
        status=2,
        start_event=MagicMock(),
        end_event=MagicMock(),
        name=f"Pass Sat-A - GS-A at {link.start_time.isoformat()}",
    )
    mock_act2 = Activity(
        uuid=uuid.uuid4(),
        schedule_name="GS-A",
        status=2,
        start_event=MagicMock(),
        end_event=MagicMock(),
        name=f"Pass Sat-A - GS-A at {link.start_time.isoformat()}",
    )
    mock_push_repo.return_value = [mock_act1, mock_act2]

    client = TestClient(app)
    payload = {
        "scheduled_links": [
            {
                "link_id": "link_001",
                "satellite_name": "Sat-A",
                "groundstation_name": "GS-A",
                "start_time": link.start_time.isoformat(),
                "end_time": link.end_time.isoformat(),
                "duration_seconds": 600.0,
                "max_elevation_deg": 45.0,
                "high_res_trajectory": [],
            }
        ]
    }
    response = client.post("/utilities/schedule/push-scheduled-links", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["pushed_links_count"] == 1
    assert data["pushed_activities_count"] == 2
    assert len(data["activities_uuids"]) == 2


def test_satos_router_push_activities_empty():
    client = TestClient(app)
    response = client.post("/satos/schedule/push-activities", json={"activities": []})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["pushed_activities_count"] == 0
    assert data["activities_uuids"] == []


@patch("app.repositories.asset_repository.AssetRepository.push_activities_to_satos")
def test_satos_router_push_activities_success(mock_push_repo):
    act_uuid1 = uuid.uuid4()
    act_uuid2 = uuid.uuid4()
    mock_act1 = Activity(
        uuid=act_uuid1,
        schedule_name="Sat-Beta",
        status=2,
        start_event=MagicMock(),
        end_event=MagicMock(),
        name="Imaging",
        description="Target observation",
        priority=3,
        initiator="Operator",
        executor="Sat-Beta",
    )
    mock_act2 = Activity(
        uuid=act_uuid2,
        schedule_name="Sat-Beta",
        status=2,
        start_event=MagicMock(),
        end_event=MagicMock(),
        name="Downlink",
        description="Downlink observation data",
        priority=2,
        initiator="Operator",
        executor="Sat-Beta",
    )
    mock_push_repo.return_value = [mock_act1, mock_act2]

    client = TestClient(app)
    payload = {
        "activities": [
            {
                "schedule_name": "Sat-Beta",
                "start_time": "2026-08-17T10:00:00Z",
                "end_time": "2026-08-17T10:15:00Z",
                "name": "Imaging",
                "description": "Target observation",
                "priority": 3,
                "status": 2,
                "initiator": "Operator",
                "executor": "Sat-Beta",
            },
            {
                "schedule_name": "Sat-Beta",
                "start_time": "2026-08-17T10:20:00Z",
                "end_time": "2026-08-17T10:30:00Z",
                "name": "Downlink",
                "description": "Downlink observation data",
                "priority": 2,
                "status": 2,
                "initiator": "Operator",
                "executor": "Sat-Beta",
            },
        ]
    }
    response = client.post("/satos/schedule/push-activities", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["pushed_activities_count"] == 2
    assert data["activities_uuids"] == [str(act_uuid1), str(act_uuid2)]



def test_cli_hard_fail_on_missing_input_file():
    """Verify CLI script hard fails with exit code 1 when input file does not exist."""
    res = subprocess.run(
        [sys.executable, "scripts/push_scheduled_links.py", "--input-file", "non_existent_file_999.json"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_push_activities_dry_run_default_config():
    """Verify push_activities CLI runs successfully in dry-run mode with default config."""
    res = subprocess.run(
        [sys.executable, "scripts/push_activities.py", "--dry-run"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "[DRY RUN] Completed" in res.stdout
    assert "activity record(s) to process" in res.stdout


def test_cli_push_activities_hard_fail_on_missing_file():
    """Verify push_activities CLI hard fails with exit code 1 when input file does not exist."""
    res = subprocess.run(
        [sys.executable, "scripts/push_activities.py", "--input-file", "non_existent_file_999.json"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr
