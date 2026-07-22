"""Contains all classes to handle demands."""

from pydantic import BaseModel


class DemandModel(BaseModel):
    """Base class of demands."""


class RelativeDemandModel(DemandModel):
    """Model used to describe relative demands."""


class AbsoluteDemandModel(DemandModel):
    """Model used to describe absolute demands."""
