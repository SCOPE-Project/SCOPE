"""Contains all models to handle missions."""

from pydantic import BaseModel, Field, conlist

from pydantic_models.descriptions import mission_def_descriptions as desc


class MissionModel(BaseModel):
    """Model to handle missions."""

    name: str = Field(..., min_length=3, description=desc.name)
    description: str = Field(..., min_length=3, description=desc.description)
    children: conlist(str, min_length=0) = Field(default_factory=list, description=desc.children)
