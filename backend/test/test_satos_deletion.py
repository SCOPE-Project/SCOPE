import pytest
import uuid
import subprocess
import sys
from datetime import datetime, timezone
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

    assert deleted.deleted_activities == [str(uuid1), str(uuid2)]
    assert len(deleted.deleted_events) == 2
    assert mock_delete_act.call_count == 2
    assert mock_delete_ev.call_count == 2


def test_satos_delete_activities_empty():
    deleted = satos_connector.satos_delete_activities([])
    assert deleted.deleted_activities == []



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

    assert "Sat-1" in cleared.deleted_activities
    assert cleared.deleted_activities["Sat-1"] == [str(uuid1), str(uuid2)]
    assert "GS-1" in cleared.deleted_activities
    assert cleared.deleted_activities["GS-1"] == []
    assert mock_delete_act.call_count == 2
    assert mock_delete_ev.call_count == 1


def test_satos_clear_schedules_empty():
    cleared = satos_connector.satos_clear_schedules([])
    assert cleared.deleted_activities == {}


# =========================================================
# 2. AssetRepository Cache Synchronization Tests
# =========================================================

@patch("app.repositories.asset_repository.satos_delete_activities")
def test_repository_delete_activities_updates_caches(mock_connector_delete):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()
    uuid3 = uuid.uuid4()

    mock_summary = satos_connector.ActivityDeleteSummary(
        deleted_activities=[str(uuid1), str(uuid2)],
        deleted_events=[],
        failed_events=[],
    )
    mock_connector_delete.return_value = mock_summary

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

    deleted_summary = AssetRepository.delete_activities_from_satos([uuid1, uuid2])

    assert deleted_summary.deleted_activities == [str(uuid1), str(uuid2)]
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

    mock_summary = satos_connector.ScheduleClearSummary(
        deleted_activities={
            "Sat-A": [str(uuid1)],
            "Sat-B": [str(uuid2)],
        },
        deleted_events={"Sat-A": [], "Sat-B": []},
        failed_events={"Sat-A": [], "Sat-B": []},
    )
    mock_connector_clear.return_value = mock_summary

    act1 = Activity(uuid=uuid1, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act1")
    act2 = Activity(uuid=uuid2, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act2")

    AssetRepository._schedules = [
        AssetSchedule(name="Sat-A", activities=[act1]),
        AssetSchedule(name="Sat-B", activities=[act2]),
    ]
    AssetRepository._raw_schedules = {
        "Sat-A": [MagicMock(uuid=uuid1)],
        "Sat-B": [MagicMock(uuid=uuid2)],
    }

    cleared_summary = AssetRepository.clear_schedules_in_satos(["Sat-A"])

    assert "Sat-A" in cleared_summary.deleted_activities
    assert AssetRepository.get_asset_raw_schedules()["Sat-A"] == []
    sat_a_sched = next(s for s in AssetRepository.get_asset_schedules() if s.name == "Sat-A")
    assert sat_a_sched.activities == []




# =========================================================
# 3. Router REST Endpoint Tests
# =========================================================

@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
def test_router_delete_single_activity_success(mock_repo_delete):
    act_uuid = uuid.uuid4()
    mock_repo_delete.return_value = satos_connector.ActivityDeleteSummary(
        deleted_activities=[str(act_uuid)]
    )

    client = TestClient(app)
    response = client.delete(f"/satos/activities/{act_uuid}")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_activity"] == str(act_uuid)


@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
def test_router_delete_single_activity_not_found(mock_repo_delete):
    act_uuid = uuid.uuid4()
    mock_repo_delete.return_value = satos_connector.ActivityDeleteSummary(
        deleted_activities=[]
    )

    client = TestClient(app)
    response = client.delete(f"/satos/activities/{act_uuid}")

    assert response.status_code == 404


@patch("app.repositories.asset_repository.AssetRepository.delete_activities_from_satos")
@patch("app.repositories.asset_repository.AssetRepository.clear_schedules_in_satos")
def test_router_batch_delete_activities_endpoint(mock_clear_repo, mock_delete_repo):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()

    mock_clear_repo.return_value = satos_connector.ScheduleClearSummary(
        deleted_activities={"Sat-Alpha": [str(uuid1)]}
    )
    mock_delete_repo.return_value = satos_connector.ActivityDeleteSummary(
        deleted_activities=[str(uuid2)]
    )

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
    mock_clear_repo.return_value = satos_connector.ScheduleClearSummary(
        deleted_activities={"Sat-1": [str(uuid1)]}
    )

    client = TestClient(app)
    response = client.post("/satos/activities/delete", json={"schedule_names": ["Sat-1"]})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_count"] == 1
    assert data["deleted_activities"] == [str(uuid1)]
    assert data["schedules_cleared"] == {"Sat-1": [str(uuid1)]}



# =========================================================
# 4. satos_clear_scope_activities Tests
# =========================================================

@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.get_activity_list")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_clear_scope_activities_initiator_filtering(mock_session_cls, mock_get_acts, mock_delete_act, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    uuid_scope1 = uuid.uuid4()
    uuid_manual = uuid.uuid4()
    uuid_scope2 = uuid.uuid4()

    ev_uuid1 = uuid.uuid4()
    ev_uuid2 = uuid.uuid4()

    mock_act_scope1 = MagicMock(
        uuid=uuid_scope1,
        initiator="SCOPE_Scheduler",
        start_event=MagicMock(uuid=ev_uuid1, timestamp=datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc)),
        end_event=MagicMock(uuid=ev_uuid2, timestamp=datetime(2026, 8, 20, 10, 10, tzinfo=timezone.utc)),
    )
    mock_act_manual = MagicMock(
        uuid=uuid_manual,
        initiator="Manual_Planner",
        start_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 10, 5, tzinfo=timezone.utc)),
        end_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 10, 15, tzinfo=timezone.utc)),
    )
    mock_act_scope2 = MagicMock(
        uuid=uuid_scope2,
        initiator="SCOPE_Scheduler",
        start_event=None,
        end_event=None,
    )

    mock_get_acts.return_value = [mock_act_scope1, mock_act_manual, mock_act_scope2]

    cleared = satos_connector.satos_clear_scope_activities(["Sat-1"])

    assert "Sat-1" in cleared
    # Only SCOPE_Scheduler activities should be deleted (scope1 and scope2)
    assert set(cleared["Sat-1"]) == {str(uuid_scope1), str(uuid_scope2)}
    assert mock_delete_act.call_count == 2
    # Anchored schedule events for scope1 should be deleted
    assert mock_delete_ev.call_count == 2


@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.get_activity_list")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_clear_scope_activities_time_window_filtering(mock_session_cls, mock_get_acts, mock_delete_act, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    uuid_early = uuid.uuid4()
    uuid_in_window = uuid.uuid4()
    uuid_late = uuid.uuid4()

    mock_act_early = MagicMock(
        uuid=uuid_early,
        initiator="SCOPE_Scheduler",
        start_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 8, 0, tzinfo=timezone.utc)),
        end_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 8, 10, tzinfo=timezone.utc)),
    )
    mock_act_in_window = MagicMock(
        uuid=uuid_in_window,
        initiator="SCOPE_Scheduler",
        start_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc)),
        end_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 10, 10, tzinfo=timezone.utc)),
    )
    mock_act_late = MagicMock(
        uuid=uuid_late,
        initiator="SCOPE_Scheduler",
        start_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)),
        end_event=MagicMock(uuid=uuid.uuid4(), timestamp=datetime(2026, 8, 20, 12, 10, tzinfo=timezone.utc)),
    )

    mock_get_acts.return_value = [mock_act_early, mock_act_in_window, mock_act_late]

    cleared = satos_connector.satos_clear_scope_activities(
        ["Sat-1"],
        start_time=datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 8, 20, 11, 0, tzinfo=timezone.utc),
    )

    assert cleared["Sat-1"] == [str(uuid_in_window)]
    assert mock_delete_act.call_count == 1


def test_satos_clear_scope_activities_empty():
    cleared = satos_connector.satos_clear_scope_activities([])
    assert cleared == {}


@patch("app.repositories.asset_repository.satos_clear_scope_activities")
def test_repository_clear_scope_activities_updates_caches(mock_connector_clear):
    uuid1 = uuid.uuid4()
    uuid2 = uuid.uuid4()
    mock_connector_clear.return_value = {"Sat-A": [str(uuid1)]}

    act1 = Activity(uuid=uuid1, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act1")
    act2 = Activity(uuid=uuid2, schedule_name="Sat-A", status=2, start_event=MagicMock(), end_event=MagicMock(), name="Act2")

    AssetRepository._schedules = [
        AssetSchedule(name="Sat-A", activities=[act1, act2]),
    ]
    AssetRepository._raw_schedules = {
        "Sat-A": [MagicMock(uuid=uuid1), MagicMock(uuid=uuid2)],
    }

    cleared = AssetRepository.clear_scope_activities_in_satos(["Sat-A"])

    assert cleared == {"Sat-A": [str(uuid1)]}
    assert len(AssetRepository.get_asset_raw_schedules()["Sat-A"]) == 1
    assert AssetRepository.get_asset_raw_schedules()["Sat-A"][0].uuid == uuid2

    sat_a_sched = next(s for s in AssetRepository.get_asset_schedules() if s.name == "Sat-A")
    assert len(sat_a_sched.activities) == 1
    assert sat_a_sched.activities[0].uuid == uuid2


@patch("app.repositories.asset_repository.AssetRepository.clear_scope_activities_in_satos")
def test_router_clear_scope_activities_endpoint(mock_clear_repo):
    uuid1 = uuid.uuid4()
    mock_clear_repo.return_value = {"Sat-1": [str(uuid1)]}

    client = TestClient(app)
    response = client.post(
        "/utilities/satos/clear-scope-activities",
        json={
            "schedule_names": ["Sat-1"],
            "start_time": "2026-08-20T10:00:00Z",
            "end_time": "2026-08-20T12:00:00Z",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_count"] == 1
    assert data["deleted_activities"] == [str(uuid1)]
    assert data["schedules_cleared"] == {"Sat-1": [str(uuid1)]}


def test_router_clear_scope_activities_empty():
    client = TestClient(app)
    response = client.post("/utilities/satos/clear-scope-activities", json={"schedule_names": []})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["deleted_count"] == 0
    assert data["deleted_activities"] == []
    assert data["schedules_cleared"] == {}


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


@patch("scripts.delete_activities.satos_get_schedules_list")
def test_cli_clear_all_schedules_flag(mock_get_schedules):
    mock_s1 = MagicMock()
    mock_s1.name = "Sat1_Group1"
    mock_s2 = MagicMock()
    mock_s2.name = "Sat2_Group1"
    mock_s3 = MagicMock()
    mock_s3.name = "OtherSat"
    mock_get_schedules.return_value = [mock_s1, mock_s2, mock_s3]

    res = subprocess.run(
        [sys.executable, "scripts/delete_activities.py", "--clear-all", "--dry-run"],
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "[DRY RUN] Completed" in res.stdout


# =========================================================
# 5. Detailed Clear and Event Warning Tests
# =========================================================

@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.get_schedule_events")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.get_activity_list")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_clear_schedules_tracks_events_and_warnings(
    mock_session_cls, mock_get_acts, mock_delete_act, mock_get_evs, mock_delete_ev
):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp

    ev_uuid_success = uuid.uuid4()
    ev_uuid_fail = uuid.uuid4()

    mock_ev_success = MagicMock(uuid=ev_uuid_success, id="ev_1", name="Event 1", schedule_1="Sat-1", schedule_2=None)
    mock_ev_fail = MagicMock(uuid=ev_uuid_fail, id="ev_2", name="Event 2", schedule_1="Sat-1", schedule_2="GS-1")

    mock_get_acts.return_value = []
    mock_get_evs.return_value = [mock_ev_success, mock_ev_fail]

    # Success on first event, failure on second
    mock_err_resp = MagicMock(status_code=404, text='{"detail":"Not Found"}')
    mock_delete_ev.side_effect = [mock_resp, Exception("404 error")]

    summary = satos_connector.satos_clear_schedules(["Sat-1"])

    assert "Sat-1" in summary.deleted_events
    assert str(ev_uuid_success) in summary.deleted_events["Sat-1"]
    assert len(summary.failed_events["Sat-1"]) == 1
    assert summary.failed_events["Sat-1"][0]["uuid"] == str(ev_uuid_fail)
    assert "GS-1" in summary.failed_events["Sat-1"][0]["reason"]


@patch("app.services.satos_connector.delete_schedule_events")
@patch("app.services.satos_connector.delete_activity")
@patch("app.services.satos_connector.get_activity_list")
@patch("app.services.satos_connector.SatIOSession")
def test_satos_clear_scope_activities_all_scope_initiators(mock_session_cls, mock_get_acts, mock_delete_act, mock_delete_ev):
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_delete_act.return_value = mock_resp
    mock_delete_ev.return_value = mock_resp

    u_auto = uuid.uuid4()
    u_pinned = uuid.uuid4()
    u_legacy = uuid.uuid4()
    u_manual = uuid.uuid4()
    u_pl = uuid.uuid4()

    mock_act_auto = MagicMock(uuid=u_auto, initiator="SCOPE_auto-scheduled", start_event=None, end_event=None)
    mock_act_pinned = MagicMock(uuid=u_pinned, initiator="SCOPE_pinned-Max Mustermann", start_event=None, end_event=None)
    mock_act_legacy = MagicMock(uuid=u_legacy, initiator="SCOPE_Scheduler", start_event=None, end_event=None)
    mock_act_manual = MagicMock(uuid=u_manual, initiator="Manual_Planner", start_event=None, end_event=None)
    mock_act_pl = MagicMock(uuid=u_pl, initiator="PL Mission Planner", start_event=None, end_event=None)

    mock_get_acts.return_value = [mock_act_auto, mock_act_pinned, mock_act_legacy, mock_act_manual, mock_act_pl]

    cleared = satos_connector.satos_clear_scope_activities(["Sat-1"])

    assert "Sat-1" in cleared
    assert set(cleared["Sat-1"]) == {str(u_auto), str(u_pinned), str(u_legacy)}
    assert str(u_manual) not in cleared["Sat-1"]
    assert str(u_pl) not in cleared["Sat-1"]
    assert mock_delete_act.call_count == 3


