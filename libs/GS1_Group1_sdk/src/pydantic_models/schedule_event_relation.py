"""Contains the classes to handle relations to ScheduleEvents."""

from datetime import timedelta

from pydantic import UUID4, UUID7, BaseModel, Field

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import schedule_event_relation_description as desc


class ScheduleEventRelationModel(BaseModel):
    """Handles ScheduleEventRelations."""

    eventUuid: UUID4 | UUID7 = Field(description=desc.event_uuid)
    relativeTime: timedelta | None = Field(default=None, description=desc.relative_time)
    # protobuf duration time format
