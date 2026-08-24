import json
import uuid
from pathlib import Path
from collections.abc import Sequence
from requests import Response
from datetime import datetime, timezone
from api_connect.satio_session import SatIOSession
from api_connect.satellites import get_satellite_list, get_satellite, post_satellite
from api_connect.activities import get_activity_list, get_activities, put_activities, delete_activity
from api_connect.schedule_events import get_schedule_events, put_schedule_events, delete_schedule_events

from pydantic_models.definitions import SatelliteInfoModel, SatelliteModel
from pydantic_models.activity import ActivityInfoModel, ActivityModel
from pydantic_models.schedule_event import ScheduleEventModel
from pydantic_models.schedule_event_relation import ScheduleEventRelationModel

from pydantic import UUID4, UUID7
from core.models.activities import Activity
from core.models.assets import SatelliteStateInputDefinition, SatelliteState, UpdateSatelliteStateConfig
from core.astrodynamics.coordinates import generate_satellite_states

DEFAULT_UPDATE_STATE_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "update_state_config.json"




# =========================================
# SatOS REST Data API Connectors
# =========================================

# /satos/asset/list
def satos_get_asset_list() -> list[SatelliteInfoModel]:
    """
    Get list of assets from the API
    SatOS Connector to GET .../satellite/list
    
    :return: list[SatelliteInfoModel] list of satellites
    """
    try:
        session = SatIOSession.get_session()
        return get_satellite_list(session)
    except LookupError:
        with SatIOSession() as session:
            return get_satellite_list(session)

# /satos/asset
def satos_get_asset(asset_name: str) -> SatelliteModel:
    """
    Get asset from the SatOS API.
    SatOS Connector to GET .../satellite

    :param asset_name: Name of the satellite to fetch
    :return: SatelliteModel (single latest version)
    """
    try:
        session = SatIOSession.get_session()
        return get_satellite(session, satellite_name=asset_name)
    except LookupError:
        with SatIOSession() as session:
            return get_satellite(session, satellite_name=asset_name)

# /satos/activities/list
def satos_get_activities_list(schedule_name: str) -> list[ActivityInfoModel]:
    """
    Get list of activities from the SatOS API for a given schedule
    SatOS Connector to GET .../activities/list

    :param schedule_name: Name of schedule
    :return: list of ActivityInfoModel
    ---
    Non-Implemented parameters are:
    param schedule_mode
    param only_mine
    param start_time
    param end_time
    """
    try:
        session = SatIOSession.get_session()
        return get_activity_list(session, schedule_name)
    except LookupError:
        with SatIOSession() as session:
            return get_activity_list(session, schedule_name)

# GET /satos/schedule_events
def satos_get_schedule_events(schedule_name: str) -> list[ScheduleEventModel]:
    """
    Get schedule events from the SatOS API for a given schedule
    SatOS Connector to GET .../schedule_events

    :param schedule_name: Name of schedule
    :return: list of ScheduleEventModel
    --- 
    Non-Implemented parameters are:
    param schedule_event_uuid
    param start_time
    param end_time
    """
    try:
        session = SatIOSession.get_session()
        return get_schedule_events(session, schedule_name=schedule_name)
    except LookupError:
        with SatIOSession() as session:
            return get_schedule_events(session, schedule_name)

# DELETE /satos/schedule_events/{schedule_event_uuid}
def satos_delete_schedule_event(schedule_event_uuid: UUID4 | UUID7 | uuid.UUID | str) -> Response:
    """
    Delete a schedule event from the SatOS API.
    SatOS Connector to DELETE .../schedule_events/{schedule_event_uuid}

    :param schedule_event_uuid: UUID of the schedule event to delete
    :return: Response object from SatOS API
    """
    try:
        session = SatIOSession.get_session()
        resp = delete_schedule_events(session, schedule_event_uuid)
        resp.raise_for_status()
        return resp
    except LookupError:
        with SatIOSession() as session:
            resp = delete_schedule_events(session, schedule_event_uuid)
            resp.raise_for_status()
            return resp

# DELETE /satos/activities/{activity_uuid}
def satos_delete_activity(activity_uuid: UUID4 | UUID7 | uuid.UUID | str) -> Response:
    """
    Delete an activity and its anchored start/end schedule events from the SatOS API.
    SatOS Connector to DELETE .../activities/{activity_uuid}

    :param activity_uuid: UUID of the activity to delete
    :return: Response object from SatOS API
    """
    def _execute(session: SatIOSession) -> Response:
        # 1. Fetch activity to discover anchored event UUIDs
        event_uuids = set()
        try:
            act_models = get_activities(session, activity_uuid=activity_uuid)
            if act_models:
                for am in act_models:
                    if am.startEvent and am.startEvent.eventUuid:
                        event_uuids.add(am.startEvent.eventUuid)
                    if am.endEvent and am.endEvent.eventUuid:
                        event_uuids.add(am.endEvent.eventUuid)
        except Exception:
            pass

        # 2. Delete the activity
        resp = delete_activity(session, activity_uuid)
        resp.raise_for_status()

        # 3. Delete anchored start and end schedule events
        for ev_uuid in event_uuids:
            try:
                ev_resp = delete_schedule_events(session, ev_uuid)
                ev_resp.raise_for_status()
            except Exception:
                pass

        return resp

    try:
        session = SatIOSession.get_session()
        return _execute(session)
    except LookupError:
        with SatIOSession() as session:
            return _execute(session)


def satos_delete_activities(activity_uuids: Sequence[UUID4 | UUID7 | uuid.UUID | str]) -> list[str]:
    """
    Delete multiple activities and their anchored start/end schedule events by their UUIDs from SatOS.
    Reuses an active or newly initialized SatIOSession across requests.

    :param activity_uuids: sequence of UUIDs (UUID4, UUID7, UUID, or string representations)
    :return: list of successfully deleted activity UUID strings
    """
    if not activity_uuids:
        return []

    def _execute_deletions(session: SatIOSession) -> list[str]:
        res = []
        all_event_uuids = set()

        # 1. Discover anchored schedule event UUIDs
        for act_uuid in activity_uuids:
            try:
                act_models = get_activities(session, activity_uuid=act_uuid)
                if act_models:
                    for am in act_models:
                        if am.startEvent and am.startEvent.eventUuid:
                            all_event_uuids.add(am.startEvent.eventUuid)
                        if am.endEvent and am.endEvent.eventUuid:
                            all_event_uuids.add(am.endEvent.eventUuid)
            except Exception:
                pass

        # 2. Delete activities
        for act_uuid in activity_uuids:
            resp = delete_activity(session, act_uuid)
            resp.raise_for_status()
            res.append(str(act_uuid))

        # 3. Delete anchored schedule events
        for ev_uuid in all_event_uuids:
            try:
                ev_resp = delete_schedule_events(session, ev_uuid)
                ev_resp.raise_for_status()
            except Exception:
                pass

        return res

    try:
        session = SatIOSession.get_session()
        return _execute_deletions(session)
    except LookupError:
        with SatIOSession() as session:
            return _execute_deletions(session)


def satos_clear_schedules(schedule_names: Sequence[str]) -> dict[str, list[str]]:
    """
    Clear all activities and all schedule events for each specified schedule in SatOS.
    1. Queries get_activity_list for each schedule and deletes all returned activities.
    2. Queries get_schedule_events for each schedule and deletes all returned schedule events (including detached ones).

    :param schedule_names: sequence of schedule names to clear
    :return: dictionary mapping each schedule_name to the list of deleted activity UUID strings
    """
    if not schedule_names:
        return {}

    def _execute_clear(session: SatIOSession) -> dict[str, list[str]]:
        summary = {}
        for sched_name in schedule_names:
            # 1. Delete all activities in the schedule
            activities = get_activity_list(session, schedule_name=sched_name)
            deleted_for_sched = []
            for act in activities:
                resp = delete_activity(session, act.uuid)
                resp.raise_for_status()
                deleted_for_sched.append(str(act.uuid))
            summary[sched_name] = deleted_for_sched

            # 2. Delete ALL schedule events in the schedule (including detached ones)
            events = get_schedule_events(session, schedule_name=sched_name)
            for event in events:
                try:
                    ev_resp = delete_schedule_events(session, event.uuid)
                    ev_resp.raise_for_status()
                except Exception:
                    pass

        return summary

    try:
        session = SatIOSession.get_session()
        return _execute_clear(session)
    except LookupError:
        with SatIOSession() as session:
            return _execute_clear(session)


def satos_clear_scope_activities(
    schedule_names: Sequence[str],
    start_time: datetime | None = None,
    end_time: datetime | None = None,
) -> dict[str, list[str]]:
    """
    Clear all activities generated by SCOPE (initiator == "SCOPE_Scheduler") and their anchored
    schedule events for each specified schedule in SatOS, with optional time window filtering.

    :param schedule_names: sequence of schedule names to clear
    :param start_time: optional start of time window filter (inclusive)
    :param end_time: optional end of time window filter (inclusive)
    :return: dictionary mapping each schedule_name to the list of deleted activity UUID strings
    """
    if not schedule_names:
        return {}

    def _is_within_window(act: ActivityInfoModel) -> bool:
        if getattr(act, "initiator", None) != "SCOPE_Scheduler":
            return False

        if start_time is None and end_time is None:
            return True

        act_start = act.start_event.timestamp if act.start_event else None
        act_end = act.end_event.timestamp if act.end_event else None

        if start_time is not None:
            st = start_time
            if act_start and act_start.tzinfo is not None and st.tzinfo is None:
                st = st.replace(tzinfo=timezone.utc)
            elif act_start and act_start.tzinfo is None and st.tzinfo is not None:
                st = st.replace(tzinfo=None)

            if act_start is not None and act_start < st:
                return False
            elif act_start is None and act_end is not None and act_end < st:
                return False

        if end_time is not None:
            et = end_time
            if act_end and act_end.tzinfo is not None and et.tzinfo is None:
                et = et.replace(tzinfo=timezone.utc)
            elif act_end and act_end.tzinfo is None and et.tzinfo is not None:
                et = et.replace(tzinfo=None)

            if act_end is not None and act_end > et:
                return False
            elif act_end is None and act_start is not None and act_start > et:
                return False

        return True

    def _execute_clear(session: SatIOSession) -> dict[str, list[str]]:
        summary: dict[str, list[str]] = {}
        for sched_name in schedule_names:
            activities = get_activity_list(session, schedule_name=sched_name)
            target_acts = [act for act in activities if _is_within_window(act)]

            deleted_for_sched: list[str] = []
            all_event_uuids = set()

            for act in target_acts:
                if act.start_event and getattr(act.start_event, "uuid", None):
                    all_event_uuids.add(act.start_event.uuid)
                if act.end_event and getattr(act.end_event, "uuid", None):
                    all_event_uuids.add(act.end_event.uuid)

                try:
                    resp = delete_activity(session, act.uuid)
                    resp.raise_for_status()
                    deleted_for_sched.append(str(act.uuid))
                except Exception:
                    pass

            for ev_uuid in all_event_uuids:
                try:
                    ev_resp = delete_schedule_events(session, ev_uuid)
                    ev_resp.raise_for_status()
                except Exception:
                    pass

            summary[sched_name] = deleted_for_sched

        return summary

    try:
        session = SatIOSession.get_session()
        return _execute_clear(session)
    except LookupError:
        with SatIOSession() as session:
            return _execute_clear(session)

# PUT /satos/schedule_events
def satos_put_schedule_events(schedule_events: list[ScheduleEventModel]) -> Response:
    """
    Update schedule events in the SatOS API.
    SatOS Connector to PUT .../schedule_events

    :param schedule_events: list of ScheduleEventModel to update
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return put_schedule_events(session, schedule_events)
    except LookupError:
        with SatIOSession() as session:
            return put_schedule_events(session, schedule_events)
        
# PUT /satos/activities
def satos_put_activities(activities: list[ActivityModel]) -> Response:
    """
    Update activities in the SatOS API.
    SatOS Connector to PUT .../activities

    :param activities: list of ActivityModel to update
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return put_activities(session, activities)
    except LookupError:
        with SatIOSession() as session:
            return put_activities(session, activities)
        
        


def push_activities_to_SatOS(activities: list[Activity]) -> None:
    """
    Push activities to the SatOS API.
    First puts unique schedule events, then puts activities.

    :param activities: list of Activity to update
    """
    if not activities:
        return

    unique_events: dict[str, ScheduleEventModel] = {}
    SatOS_activities: list[ActivityModel] = []

    for activity in activities:
        if activity.start_event and str(activity.start_event.uuid) not in unique_events:
            unique_events[str(activity.start_event.uuid)] = activity.start_event
        if activity.end_event and str(activity.end_event.uuid) not in unique_events:
            unique_events[str(activity.end_event.uuid)] = activity.end_event

        SatOS_activity = ActivityModel(
            uuid=activity.uuid,
            scheduleName=activity.schedule_name,
            initiator=getattr(activity, "initiator", None) or activity.schedule_name,
            executor=getattr(activity, "executor", None) or activity.schedule_name,
            status=activity.status,
            name=activity.name or "",
            description=getattr(activity, "description", "") or "",
            priority=getattr(activity, "priority", 0) or 0,
            startEvent=ScheduleEventRelationModel(
                eventUuid=activity.start_event.uuid,
                relativeTime=0,
            ),
            endEvent=ScheduleEventRelationModel(
                eventUuid=activity.end_event.uuid,
                relativeTime=0,
            )
        )
        SatOS_activities.append(SatOS_activity)

    SatOS_schedule_events = list(unique_events.values())

    try:
        try:
            SatIOSession.get_session()
            satos_put_schedule_events(SatOS_schedule_events)
            satos_put_activities(SatOS_activities)
        except LookupError:
            with SatIOSession():
                satos_put_schedule_events(SatOS_schedule_events)
                satos_put_activities(SatOS_activities)
    except Exception as e:
        print(f"Error pushing activities to SatOS: {e}")
        raise


# =========================================
# SatOS Satellite State Update
# =========================================

# POST /satos/satellite
def satos_post_satellite(satellite: SatelliteModel) -> Response:
    """
    Post updated satellite model to the SatOS API.
    SatOS Connector to POST .../satellite

    :param satellite: SatelliteModel to post
    :return: Response object
    """
    try:
        session = SatIOSession.get_session()
        return post_satellite(session, satellite)
    except LookupError:
        with SatIOSession() as session:
            return post_satellite(session, satellite)


def satos_update_satellite_state(
    satellite_name: str,
    position_m: list[float],
    velocity_m_s: list[float],
    epoch_utc: datetime,
    bump_patch: bool = True,
) -> SatelliteModel:
    """
    Fetch the satellite model, update its position, velocity, and timestamp variables,
    optionally bump the patch version, and post the updated model back to SatOS.
    """
    satellite = satos_get_asset(asset_name=satellite_name)

    found_pos = False
    found_vel = False
    found_time = False

    iso_timestamp = epoch_utc.astimezone(timezone.utc).isoformat()

    for var in satellite.variableDefinitions:
        if var.name == "position_vector" and var.matrixDefinition:
            var.matrixDefinition.defaultValue = [float(v) for v in position_m]
            found_pos = True
        elif var.name == "velocity_vector" and var.matrixDefinition:
            var.matrixDefinition.defaultValue = [float(v) for v in velocity_m_s]
            found_vel = True
        elif var.name == "state_timestamp" and var.timeDefinition:
            var.timeDefinition.defaultValue = iso_timestamp
            found_time = True

    if not (found_pos and found_vel and found_time):
        missing = []
        if not found_pos:
            missing.append("position_vector")
        if not found_vel:
            missing.append("velocity_vector")
        if not found_time:
            missing.append("state_timestamp")
        raise ValueError(
            f"Satellite {satellite_name!r} is missing required variable definition(s): {', '.join(missing)}"
        )

    if bump_patch and satellite.version:
        satellite.version.patch += 1

    response = satos_post_satellite(satellite)
    response.raise_for_status()
    return satellite


def load_update_state_config(
    config_path: str | Path | None = None,
) -> UpdateSatelliteStateConfig:
    """Load and validate a update state configuration from JSON."""
    path = Path(config_path) if config_path is not None else DEFAULT_UPDATE_STATE_CONFIG_PATH
    try:
        raw_config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Update state config not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in update state config {path}: {exc.msg}") from exc

    if not isinstance(raw_config, dict):
        raise ValueError("Update state config must be a JSON object.")

    epoch_value = raw_config.get("epoch_utc")
    if not isinstance(epoch_value, str):
        raise ValueError("Update state config field 'epoch_utc' must be a string.")

    try:
        parsed_epoch = datetime.fromisoformat(epoch_value)
        if parsed_epoch.tzinfo is None:
            raise ValueError("Epoch must include timezone information.")
        epoch_utc = parsed_epoch.astimezone(timezone.utc)
    except ValueError as exc:
        raise ValueError(
            f"Update state config field 'epoch_utc' must be an ISO 8601 timezone-aware datetime: {exc}"
        ) from exc

    satellite_values = raw_config.get("satellites")
    if not isinstance(satellite_values, list) or not satellite_values:
        raise ValueError("Update state config field 'satellites' must be a non-empty array.")

    satellites = []
    for index, satellite_value in enumerate(satellite_values):
        if not isinstance(satellite_value, dict):
            raise ValueError(f"Satellite at index {index} must be a JSON object.")
        try:
            satellites.append(SatelliteStateInputDefinition(**satellite_value))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid satellite definition at index {index}: {exc}"
            ) from exc

    return UpdateSatelliteStateConfig(
        epoch_utc=epoch_utc,
        satellites=tuple(satellites),
    )


def update_and_post_satellite_states(
    config: UpdateSatelliteStateConfig | None = None,
    dry_run: bool = False,
) -> list[SatelliteState]:
    """
    Generates Cartesian state vectors for all satellites in the config
    and updates their variables in SatOS.
    """
    if config is None:
        config = load_update_state_config()

    states = generate_satellite_states(config.epoch_utc, config.satellites)

    if not dry_run:
        for state in states.values():
            satos_update_satellite_state(
                satellite_name=state.name,
                position_m=state.position_m,
                velocity_m_s=state.velocity_m_s,
                epoch_utc=state.epoch_utc,
            )

        # Invalidate cached asset data in AssetRepository
        try:
            from app.repositories import AssetRepository
            AssetRepository._satellite_infos.clear()
            AssetRepository._raw_asset_models.clear()
            AssetRepository._initialized = False
        except Exception:
            pass

    return list(states.values())

