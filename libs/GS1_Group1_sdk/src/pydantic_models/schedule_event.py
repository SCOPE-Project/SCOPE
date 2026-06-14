"""Contains the necessary models to handle ScheduleEvents."""

from pydantic import UUID4, UUID7, AwareDatetime, BaseModel, ConfigDict, Field

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import schedule_event_descriptions as desc


class ScheduleEventModel(BaseModel):
    """A model for events in the schedule."""

    uuid: UUID4 | UUID7 = Field(description=desc.uuid)
    id: str = Field(description=desc.event_id)
    name: str = Field(description=desc.name)
    timestamp: AwareDatetime = Field(description=desc.timestamp)

    model_config = ConfigDict(from_attributes=True)
