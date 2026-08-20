import pytest
import uuid
import subprocess
import sys
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from core.models.activities import Activity, AssetSchedule
from app.repositories import AssetRepository
from app.services import satos_connector
from app.main import app
from pydantic_models.activity import ActivityInfoModel, ActivityStatus


@pytest.fixture(autouse=True)
def clean_repositories():
    """Reset AssetRepository schedules between tests."""
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()
    yield
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()


# =========================================================
# 1. satos_connector Unit Tests
# =========================================================

@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_delete_schedule_event_success(mock_session_cls, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_ev.return_value = mock_resp

    test_ev_uuid = uuid.uuid4()
    resp = satos_connector.satos_delete_schedule_event(test_ev_uuid)

    assert resp == mock_resp
    mock_delete_ev.assert_called_once()
    mock_resp.raise_for_status.assert_called_once()


@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.get_activities")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_delete_activity_success(mock_session_cls, mock_delete_act, mock_get_acts, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    start_ev_uuid = uuid.uuid4()
    end_ev_uuid = uuid.uuid4()
    mock_act_model = MagicMock(
        startEvent=MagicMock(eventUuid=start_ev_uuid),
        endEvent=MagicMock(eventUuid=end_ev_uuid),
    )
    mock_get_acts.return_value = [mock_act_model]

    test_uuid = uuid.uuid4()
    resp = satos_connector.satos_delete_activity(test_uuid)

    assert resp == mock_resp
    mock_delete_act.assert_called_once()
    mock_get_acts.assert_called_once()
    assert mock_delete_ev.call_count == 2


@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.get_activities")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_delete_activities_batch(mock_session_cls, mock_delete_act, mock_get_acts, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    ev_uuid1 = uuid.uuid4()
    ev_uuid2 = uuid.uuid4()
    mock_get_acts.side_effect = [
        [MagicMock(startEvent=MagicMock(eventUuid=ev_uuid1), endEvent=None)],
        [MagicMock(startEvent=None, endEvent=MagicMock(eventUuid=ev_uuid2))],
    ]

    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()

    deleted = satos_connector.satos_delete_activities([uuid1, uuid2])

    assert deleted == [str(uuid1), str(uuid2)]
    assert mock_delete_act.call_count == 2
    assert mock_delete_ev.call_count == 2


def test_satos_delete_activities_empty():
    deleted = satos_connector.satos_delete_activities([])
    assert deleted == []


@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.get_schedule_events")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.get_activity_list")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_clear_schedules(mock_session_cls, mock_get_acts, mock_delete_act, mock_get_evs, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()
    mock_act1 = MagicMock(uuid=uuid1)
    mock_act2 = MagicMock(uuid=uuid2)

    ev_uuid1 = uuid.uuid4()
    mock_ev1 = MagicMock(uuid=ev_uuid1)

    mock_get_acts.side_effect = lambda session, schedule_name: (
        [mock_act1, mock_act2] if schedule_name == "Sat-1" else []
    )
    mock_get_evs.side_effect = lambda session, schedule_name: (
        [mock_ev1] if schedule_name == "Sat-1" else []
    )

    cleared = satos_connector.satos_clear_schedules(["Sat-1", "GS-1"])

    assert "Sat-1" in cleared
    assert cleared["Sat-1"] == [str(uuid1), str(uuid2)]
    assert "GS-1" in cleared
    assert cleared["GS-1"] == []
    assert mock_delete_act.call_count == 2
    assert mock_delete_ev.call_count == 1


def test_satos_clear_schedules_empty():
    cleared = satos_connector.satos_clear_schedules([])
    assert cleared == {}


# =========================================================
# 2. AssetRepository Cache Synchronization Tests
# =========================================================

@patch("app.repositories.asset_repository.satos_delete_activities")
def test_repository_delete_activities_updates_caches(mock_connector_delete):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()
    uuid3 = uuid.uuid4()

    mock_connector_delete.return_value = [str(uuid1), str(uuid2)]

    act1 = Activity(uuid=uuid1, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act1")
    act2 = Activity(uuid=uuid2, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act2")
    act3 = Activity(uuid=uuid3, schedule_name="Sat-B", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act3")

    AssetRepository._schedules = [
        AssetSchedule(name="Sat-A", activities=[act1, act2]),
        AssetSchedule(name="Sat-B", activities=[act3]),
    ]
    AssetRepository._raw_schedules = {
        "Sat-A": [MagicMock(uuid=uuid1), MagicMock(uuid=uuid2)],
        "Sat-B": [MagicMock(uuid=uuid3)],
    }

    deleted = AssetRepository.delete_activities_from_satos([uuid1, uuid2])

    assert deleted == [str(uuid1), str(uuid2)]
    # Sat-A should now have no activities
    sat_a_sched = next(s for s in AssetRepository.get_asset_schedules() if s.name == "Sat-A")
    assert sat_a_sched.activities == []
    assert AssetRepository.get_asset_raw_schedules()["Sat-A"] == []

    # Sat-B should still have act3
    sat_b_sched = next(s for s in AssetRepository.get_asset_schedules() if s.name == "Sat-B")
    assert len(sat_b_sched.activities) == 1
    assert sat_b_sched.activities[0].uuid == uuid3


@patch("app.repositories.asset_repository.satos_clear_schedules")
def test_repository_clear_schedules_updates_caches(mock_connector_clear):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()

    mock_connector_clear.return_value = {
        "Sat-A": [str(uuid1)],
        "Sat-B": [str(uuid2)],
    }

    act1 = Activity(uuid=uuid1, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act1")
    act2 = Activity(uuid=uuid2, schedule_name="Sat-B", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act2")

    AssetRepository._schedules = [
        AssetSchedule(name="Sat-A", activities=[act1]),
        AssetSchedule(name="Sat-B", activities=[act2]),
    ]
    AssetRepository._raw_schedules = {
        "Sat-A": [MagicMock(uuid=uuid1)],
        "Sat-B": [MagicMock(uuid=uuid2)],
    }

    cleared = AssetRepository.clear_schedules_in_satos(["Sat-A"])

    assert "Sat-A" in cleared
    assert AssetRepository.get_asset_raw_schedules()["Sat-A"] == []
    sat_a_sched = next(s for s in AssetRepository.get_asset_schedules() if s.name == "Sat-A")
    assert sat_a_sched.activities == []


# =========================================================
# 3. Router REST Endpoint Tests
# =========================================================

@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
def test_router_delete_single_activity_success(mock_repo_delete):
    act_uuid = uuid.uuid4()
    mock_repo_delete.return_value = [str(act_uuid)]

    client = TestClient(app)
    response = client.delete(f"/satos/activities/{act_uuid}")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_activity"] == str(act_uuid)


@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
def test_router_delete_single_activity_not_found(mock_repo_delete):
    act_uuid = uuid.uuid4()
    mock_repo_delete.return_value = []

    client = TestClient(app)
    response = client.delete(f"/satos/activities/{act_uuid}")

    assert response.status_code == 404


@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
@patch("app.repositories.asset_repository.AssetRepository.clear_schedules_in_satos")
def test_router_batch_delete_activities_endpoint(mock_clear_repo, mock_delete_repo):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()

    mock_clear_repo.return_value = {"Sat-Alpha": [str(uuid1)]}
    mock_delete_repo.return_value = [str(uuid2)]

    client = TestClient(app)
    payload = {
        "activity_uuids": [str(uuid2)],
        "schedule_names": ["Sat-Alpha"],
    }
    response = client.post("/satos/activities/delete", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_count"] == 2
    assert set(data["deleted_activities"]) == {str(uuid1), str(uuid2)}
    assert data["schedules_cleared"] == {"Sat-Alpha": [str(uuid1)]}


def test_router_batch_delete_empty():
    client = TestClient(app)
    response = client.post("/satos/activities/delete", json={"activity_uuids": [], "schedule_names": []})

    assert response.status_code == 200
    data = response.json()
    assert data["deleted_count"] == 0
    assert data["deleted_activities"] == []


@patch("app.repositories.asset_repository.AssetRepository.clear_schedules_in_satos")
def test_router_delete_activities_by_schedule_names(mock_clear_repo):
    uuid1 = uuid.uuid4()
    mock_clear_repo.return_value = {"Sat-1": [str(uuid1)]}

    client = TestClient(app)
    response = client.post("/satos/activities/delete", json={"schedule_names": ["Sat-1"]})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_count"] == 1
    assert data["deleted_activities"] == [str(uuid1)]
    assert data["schedules_cleared"] == {"Sat-1": [str(uuid1)]}


# =========================================================
# 4. CLI Script Tests
# =========================================================

def test_cli_delete_activities_hard_fail_on_no_args():
    res = subprocess.run(
        [sys.executable, "scripts/delete_activities.py"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_delete_activities_dry_run():
    test_uuid = str(uuid.uuid4())
    res = subprocess.run(
        [sys.executable, "scripts/delete_activities.py", "--uuids", test_uuid, "--dry-run"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "[DRY RUN] Completed" in res.stdout
    assert test_uuid in res.stdout
