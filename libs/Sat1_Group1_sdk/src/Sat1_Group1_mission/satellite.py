"""The base class for all satellites lives here."""

import logging
import sys
from datetime import datetime
from uuid import UUID

from api_connect.schedule_events import get_schedule_events
from pydantic_models.schedule_event import ScheduleEventModel

if sys.version_info < (3, 14):
    # Python versions before 3.14 do not provide a standard function to generate an uuid7
    from uuid_backport import uuid7
else:
    from uuid import uuid7

from api_connect.activities import delete_activity, get_activities, get_activity_list
from api_connect.satio_session import SatIOSession  # Managing the connection to sat:io
from pydantic_models.activity import ActivityInfoModel, ActivityModel, ActivityStages, ActivityStatus
from pydantic_models.definitions import SatelliteModel
from pydantic_models.schedule import ScheduleModel

from .activity import SdkActivity
from .component import Component

_logger = logging.getLogger(__name__)


class Satellite(Component):
    """Base class for all satellites."""

    def __init__(self, satellite_model: SatelliteModel):
        """Initialize the satellite object.

        :param satellite_model: The satellite model.

        """
        super().__init__(description=satellite_model.description, id_path=satellite_model.name)
        self._satellite_model = satellite_model

    @property
    def _session(self) -> SatIOSession:
        """Get the session.

        :return: SatIOSession
        """
        return SatIOSession.get_session()

    @property
    def schedule_name(self) -> str:
        """Get the name of the schedule."""
        return self._satellite_model.name

    @property
    def name(self) -> str:
        """Get the name of the satellite."""
        return self._satellite_model.name

    @property
    def norad_id(self) -> int | None:
        """Get the NORAD ID of the satellite."""
        return self._satellite_model.norad_id

    @property
    def opm_object_id(self) -> str | None:
        """Get the OPM object ID of the satellite."""
        return self._satellite_model.opm_object_id

    def get_tle(self) -> str:
        """Get the TLE of the satellite."""
        raise NotImplementedError("Method not implemented.")

    def get_schedule(self) -> ScheduleModel:
        """Get the schedule of the satellite."""
        params = {"schedule_name": self.schedule_name}
        response_sched = self._session.get("schedules", params=params).json()
        if len(response_sched) != 1:
            raise ValueError(f"Schedule {self.schedule_name} not found.")
        return ScheduleModel.model_validate(response_sched[0])

    def get_schedule_events(
        self,
        schedule_event_uuid: UUID | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> list[ScheduleEventModel]:
        """Get the schedule events for this asset.

        :param schedule_event_uuid: The uuid of the schedule event to get.
        :param start_time: The start time of the schedule event to get. If start time is set, end time must be set.
        :param end_time: The end time of the schedule event to get. If end time is set, start time must be set.
        """
        if schedule_event_uuid is not None:
            kwargs = {"schedule_event_uuid": schedule_event_uuid}
        elif start_time is not None and end_time is not None:
            kwargs = {"start_time": start_time, "end_time": end_time}
        else:
            raise ValueError("Please set either schedule_event_uuid or start_time and end_time.")
        return get_schedule_events(self._session, self.schedule_name, *kwargs)

    def get_activity(self, activity_uuid: UUID) -> SdkActivity | None:
        """Get one activity of the satellite.

        :param activity_uuid: The uuid of the activity to get. If None, all activities are returned.

        :returns: The found activity or None if no activity was found .
        """
        act_models = get_activities(session=self._session, activity_uuid=activity_uuid)

        if act_models is None or len(act_models) == 0:
            return None

        return SdkActivity.from_activity_model(act_models[0], auto_commit=False)

    def get_activity_list(self) -> list[ActivityInfoModel]:
        """Get a list of activities of the satellite.

        :returns: A list of activities.
        """
        return get_activity_list(session=self._session, schedule_name=self.schedule_name)

    def delete_activity(self, activity_uuid: UUID) -> None:
        """Delete an activity from the satellite.

        :param activity_uuid: The uuid of the activity to delete.
        """
        resp_delete = delete_activity(session=self._session, activity_uuid=activity_uuid)
        resp_delete.raise_for_status()

    def create_activity(
        self,
        name: str | None = None,
        description: str = "",
        activity: SdkActivity | None = None,
        auto_commit: bool = True,
    ) -> SdkActivity:
        """Create a new activity for the satellite.

        :param name: The name of the activity. Optional, if not provided, the activity has to be set.
        :param description: The description of the activity. Optional, if not provided, the activity has to be set.
        :param activity: The activity to create. Optional, if not provided, the name and description have to be set.
        :param auto_commit: Whether to automatically commit the activity to the API.

        :returns: The created activity.
        """
        if activity is None:
            uuid = uuid7()
            activity = SdkActivity(
                ActivityModel(
                    name=name,
                    description=description,
                    uuid=uuid,
                    scheduleName=self.schedule_name,
                    initiator=None,  # Will be set during commit
                    status=ActivityStatus.SUSPENDED,
                    stage=ActivityStages.REQUESTED,
                ),
                auto_commit=auto_commit,
            )
        elif auto_commit:
            activity.commit()
        return activity
