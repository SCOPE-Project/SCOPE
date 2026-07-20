# core/orbit_engine/input_validation.py

from datetime import datetime
from numbers import Real

from core.models.domain import (
    GroundStationInformation,
    SatelliteInformation,
    TimeInterval,
)
from core.orbit_engine.time_utils import normalize_datetime_to_utc


# ==========================================
# INPUT VALIDATION
def validate_orekit_engine_inputs(
    satellite_infos: list[SatelliteInformation],
    groundstation_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
) -> None:
    """Validate all inputs needed before starting an Orekit propagation run."""
    if not satellite_infos:
        raise ValueError("At least one satellite is required.")

    if not groundstation_infos:
        raise ValueError("At least one ground station is required.")

    if not isinstance(time_interval.start_time, datetime):
        raise ValueError("The propagation start time must be a datetime.")

    if not isinstance(time_interval.end_time, datetime):
        raise ValueError("The propagation end time must be a datetime.")

    start_time = normalize_datetime_to_utc(time_interval.start_time)
    end_time = normalize_datetime_to_utc(time_interval.end_time)

    if end_time <= start_time:
        raise ValueError("The propagation end time must be after the start time.")

    satellite_names = set()
    for satellite_info in satellite_infos:
        if not isinstance(satellite_info.name, str) or not satellite_info.name.strip():
            raise ValueError("Each satellite must have a non-empty name.")

        if satellite_info.name in satellite_names:
            raise ValueError(
                f"Satellite name {satellite_info.name!r} is not unique."
            )
        satellite_names.add(satellite_info.name)

        if (
            not isinstance(satellite_info.position_r, list)
            or len(satellite_info.position_r) != 3
        ):
            raise ValueError(
                f"Satellite {satellite_info.name!r} must have exactly three "
                "position values."
            )

        if (
            not isinstance(satellite_info.velocity_v, list)
            or len(satellite_info.velocity_v) != 3
        ):
            raise ValueError(
                f"Satellite {satellite_info.name!r} must have exactly three "
                "velocity values."
            )

        for position_value in satellite_info.position_r:
            if not isinstance(position_value, Real) or isinstance(position_value, bool):
                raise ValueError(
                    f"Satellite {satellite_info.name!r} position values must be "
                    "float or int."
                )

        for velocity_value in satellite_info.velocity_v:
            if not isinstance(velocity_value, Real) or isinstance(velocity_value, bool):
                raise ValueError(
                    f"Satellite {satellite_info.name!r} velocity values must be "
                    "float or int."
                )

        if not isinstance(satellite_info.state_timestamp, datetime):
            raise ValueError(
                f"Satellite {satellite_info.name!r} state_timestamp must be a "
                "datetime."
            )

    groundstation_names = set()
    for groundstation_info in groundstation_infos:
        if (
            not isinstance(groundstation_info.name, str)
            or not groundstation_info.name.strip()
        ):
            raise ValueError("Each ground station must have a non-empty name.")

        if groundstation_info.name in groundstation_names:
            raise ValueError(
                f"Ground station name {groundstation_info.name!r} is not unique."
            )
        groundstation_names.add(groundstation_info.name)

        if (
            not isinstance(groundstation_info.latitude, Real)
            or isinstance(groundstation_info.latitude, bool)
            or groundstation_info.latitude < -90.0
            or groundstation_info.latitude > 90.0
        ):
            raise ValueError(
                f"Ground station {groundstation_info.name!r} latitude must be "
                "between -90 and 90 degrees."
            )

        if (
            not isinstance(groundstation_info.longitude, Real)
            or isinstance(groundstation_info.longitude, bool)
            or groundstation_info.longitude < -180.0
            or groundstation_info.longitude > 180.0
        ):
            raise ValueError(
                f"Ground station {groundstation_info.name!r} longitude must be "
                "between -180 and 180 degrees."
            )

        if (
            not isinstance(groundstation_info.min_link_elevation, Real)
            or isinstance(groundstation_info.min_link_elevation, bool)
            or groundstation_info.min_link_elevation < 0.0
            or groundstation_info.min_link_elevation > 90.0
        ):
            raise ValueError(
                f"Ground station {groundstation_info.name!r} minimum elevation "
                "must be between 0 and 90 degrees."
            )
