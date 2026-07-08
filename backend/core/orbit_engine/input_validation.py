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
    ground_station_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
) -> None:
    """Validate all inputs needed before starting an Orekit propagation run."""
    if not satellite_infos:
        raise ValueError("At least one satellite is required.")

    if not ground_station_infos:
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

    ground_station_names = set()
    for ground_station_info in ground_station_infos:
        if (
            not isinstance(ground_station_info.name, str)
            or not ground_station_info.name.strip()
        ):
            raise ValueError("Each ground station must have a non-empty name.")

        if ground_station_info.name in ground_station_names:
            raise ValueError(
                f"Ground station name {ground_station_info.name!r} is not unique."
            )
        ground_station_names.add(ground_station_info.name)

        if (
            not isinstance(ground_station_info.latitude, Real)
            or isinstance(ground_station_info.latitude, bool)
            or ground_station_info.latitude < -90.0
            or ground_station_info.latitude > 90.0
        ):
            raise ValueError(
                f"Ground station {ground_station_info.name!r} latitude must be "
                "between -90 and 90 degrees."
            )

        if (
            not isinstance(ground_station_info.longitude, Real)
            or isinstance(ground_station_info.longitude, bool)
            or ground_station_info.longitude < -180.0
            or ground_station_info.longitude > 180.0
        ):
            raise ValueError(
                f"Ground station {ground_station_info.name!r} longitude must be "
                "between -180 and 180 degrees."
            )

        if (
            not isinstance(ground_station_info.min_elevation_angle_deg, Real)
            or isinstance(ground_station_info.min_elevation_angle_deg, bool)
            or ground_station_info.min_elevation_angle_deg < 0.0
            or ground_station_info.min_elevation_angle_deg > 90.0
        ):
            raise ValueError(
                f"Ground station {ground_station_info.name!r} minimum elevation "
                "must be between 0 and 90 degrees."
            )
