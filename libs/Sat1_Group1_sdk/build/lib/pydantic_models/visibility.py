"""Pydantic models for the visibility."""

import abc
from enum import IntEnum

from pydantic import UUID4, UUID7, AwareDatetime, BaseModel, Field

from pydantic_models.schedule_event import ScheduleEventModel


class SatelliteGroundVisibilityState(IntEnum):
    """Visibility state enumeration."""

    REQUESTED = 0
    AVAILABLE = 99
    USED = 999


class AbstractSatelliteGroundVisibility(BaseModel, abc.ABC):
    """Abstract base class for satellite ground visibility model."""

    uuid: UUID4 | UUID7 = Field(description="The UUID of the satellite ground visibility")
    description: str = Field(description="The description of the Visibility")
    max_elevation_deg: float = Field(description="The maximum elevation of the Visibility")
    max_elevation_time: AwareDatetime = Field(description="The maximum elevation time of the Visibility")
    satellite: str = Field(description="The satellite that has the visibility to the ground")
    ground: str = Field(description="The ground object that the satellite sees")
    state: SatelliteGroundVisibilityState
    provider_id: str = Field(description="The provider ID can be used by ground stations to identify the visibility.")
    additional_information: dict[str, int | float | str | bool] = Field(
        default_factory=dict, description="Additional information about the visibility"
    )


class SatelliteGroundVisibilityInfo(AbstractSatelliteGroundVisibility):
    """This model defines visibilities between two objects.

    Compared to a SatelliteGroundVisibility it directly has start and end event, not just their UUIDs

    """

    start_event: ScheduleEventModel = Field(description="The start event, marking the start of the Visibility")
    end_event: ScheduleEventModel = Field(description="The end event, marking the end of the Visibility")


class SatelliteGroundVisibilityModel(AbstractSatelliteGroundVisibility):
    """This info model defines visibilities between two objects.

    Compared to a SatelliteGroundVisibilityInfo it only has the start and end event UUIDs, not the actual events.

    """

    start_event_uuid: UUID4 | UUID7 = Field(description="The start event UUID, marking the start of the Visibility")
    end_event_uuid: UUID4 | UUID7 = Field(description="The end event UUID, marking the end of the Visibility")
