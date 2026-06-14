"""Contains all position handling."""

from enum import IntEnum

from pydantic import AwareDatetime, BaseModel, Field

from libs.GS1_Group1_sdk.src.pydantic_models.descriptions import position_def_descriptions as desc


class GeoidModel(IntEnum):
    """Lists all available geoids."""

    UNKNOWN_GEOID = 0
    WGS_84 = 1


class FrameModel(IntEnum):
    """Lists all available frames."""

    UNKNOWN_FRAME = 0
    GCRS = 1
    ITRF2000 = 2


class CenterModel(IntEnum):
    """Lists all available centers."""

    UNKNOWN_CENTER = 0
    EARTH = 1


class TimeSystemModel(IntEnum):
    """Lists all available time systems."""

    UNKNOWN_TIMESYS = 0
    UTC = 1


class GeodeticModel(BaseModel):
    """Model to represent geodetic coordinates."""

    latitude_deg: float = Field(..., ge=-90.0, le=90.0, description=desc.latitude)
    longitude_deg: float = Field(..., ge=-180.0, le=180.0, description=desc.longitude)
    elevation_m: float = Field(..., description=desc.elevation)
    geoid: GeoidModel = Field(GeoidModel.WGS_84, description=desc.geoid)


class CartesianModel(BaseModel):
    """Model to represent Cartesian coordinates."""

    x_m: float = Field(..., description=desc.x)
    y_m: float = Field(..., description=desc.y)
    z_m: float = Field(..., description=desc.z)
    center_name: CenterModel = Field(CenterModel.EARTH, description=desc.center_name)
    reference_frame: FrameModel = Field(FrameModel.ITRF2000, description=desc.reference_frame)
    ref_frame_epoch: AwareDatetime | None = Field(default=None, description=desc.epoch)
    time_reference: TimeSystemModel = Field(TimeSystemModel.UTC, description=desc.time_reference)


class PositionModel(BaseModel):
    """Handles positions."""

    geodetic: GeodeticModel | None = Field(default=None, description=desc.geodetic)
    cartesian: CartesianModel | None = Field(default=None, description=desc.cartesian)
    time: AwareDatetime | None = Field(default=None, description=desc.time)
