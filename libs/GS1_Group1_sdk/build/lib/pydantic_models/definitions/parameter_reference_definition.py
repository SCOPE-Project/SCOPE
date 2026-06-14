"""Contains models to handle parameter references."""

from pydantic import BaseModel, Field

from pydantic_models.descriptions import parameter_reference_def_descriptions as desc


class ParameterReferenceModel(BaseModel):
    """Model to represent references in the asset trees."""

    relativePath: str | None = Field(default=None, description=desc.relative_path)
    absolutePath: str | None = Field(default=None, description=desc.absolute_path)
    name: str = Field(description=desc.name)
