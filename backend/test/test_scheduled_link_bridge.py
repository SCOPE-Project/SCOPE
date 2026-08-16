import pytest
import uuid
import subprocess
import sys
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from core.models.domain import (
    ScheduledLink,
    OverpassProfilePoint,
)
from core.repository.propagation_repository import PropagationResultRepository
from app.models.tasks import Activity, AssetSchedule
from app.models.satos import ScheduledLinkDTO
from app.services.asset_repository import AssetRepository
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
    link_id: str = "link_001",
    sat_name: str = "Satellite-Alpha",
    gs_name: str = "GS-Kiruna",
) -> ScheduledLink:
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
    return ScheduledLink(
        link_id=link_id,
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
    sat_activity, gs_activity = AssetRepository.create_activities_from_scheduled_link(link)

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
    assert aos.id == "link_001_AOS"
    assert aos.name == "AOS: Satellite-Alpha - GS-Kiruna"
    assert aos.schedule_1 == "Satellite-Alpha"
    assert aos.schedule_2 == "GS-Kiruna"
    assert aos.timestamp == link.start_time

    # Validate LOS Event
    los = sat_activity.end_event
    assert los.id == "link_001_LOS"
    assert los.name == "LOS: Satellite-Alpha - GS-Kiruna"
    assert los.schedule_1 == "Satellite-Alpha"
    assert los.schedule_2 == "GS-Kiruna"
    assert los.timestamp == link.end_time


def test_create_activities_from_multiple_scheduled_links():
    link1 = create_sample_scheduled_link(link_id="link_001", sat_name="Sat-1", gs_name="GS-1")
    link2 = create_sample_scheduled_link(link_id="link_002", sat_name="Sat-2", gs_name="GS-2")

    activities = AssetRepository.create_activities_from_scheduled_links([link1, link2])

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
    activities = AssetRepository.create_activities_from_scheduled_links([link])
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


@patch("app.services.asset_repository.push_activities_to_SatOS")
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


def test_router_push_scheduled_links_empty():
    client = TestClient(app)
    response = client.post("/satos/schedule/push-scheduled-links", json={"scheduled_links": []})
    assert response.status_code == 200
    data = response.json()
    assert data["pushed_links_count"] == 0
    assert data["pushed_activities_count"] == 0


@patch("app.services.asset_repository.AssetRepository.push_scheduled_links_to_satos")
def test_router_push_scheduled_links_success(mock_push_repo):
    link = create_sample_scheduled_link(link_id="link_001", sat_name="Sat-A", gs_name="GS-A")
    link_dto = ScheduledLinkDTO.from_domain(link)

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
    response = client.post("/satos/schedule/push-scheduled-links", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["pushed_links_count"] == 1
    assert data["pushed_activities_count"] == 2
    assert len(data["activities_uuids"]) == 2


def test_cli_hard_fail_on_missing_input_file():
    """Verify CLI script hard fails with exit code 1 when input file does not exist."""
    res = subprocess.run(
        [sys.executable, "scripts/push_scheduled_links.py", "--input-file", "non_existent_file_999.json"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr
