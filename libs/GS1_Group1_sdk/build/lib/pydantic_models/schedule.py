"""Contains the models necessary to handle schedules."""

from pydantic import BaseModel, Field, conlist

from pydantic_models.activity import ActivityModel
from pydantic_models.descriptions import schedule_descriptions as desc


class ScheduleModel(BaseModel):
    """Model for the schedules."""

    activities: conlist(ActivityModel, min_length=0) = Field(default_factory=list, description=desc.activities)
    description: str = Field(description=desc.description)
    name: str = Field(description=desc.name)


class ScheduleInfoModel(BaseModel):
    """Model for the schedule infos."""

    description: str = Field(description=desc.description)
    name: str = Field(description=desc.name)
