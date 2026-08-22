from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from org.orekit.bodies import OneAxisEllipsoid, GeodeticPoint
    from org.orekit.frames import Frame
    from org.orekit.propagation import BoundedPropagator
from datetime import datetime, timedelta
from math import degrees

from core.orbit_engine.groundstation_frames import GroundStationRuntimeContext
from core.orbit_engine.time_utils import normalize_datetime_to_utc
from core.orbit_engine.visibility_events import OverpassEvent
from core.models.propagation import (
    GlobalTrackPoint,
    OverpassProfilePoint,
    OverpassBlock,
    PropagationMetadata,
)


# ==========================================
# CONSTANTS
GLOBAL_TRACK_STEP_SECONDS = 60.0
OVERPASS_PROFILE_STEP_SECONDS = 10.0


# ==========================================
# GLOBAL TRACK EXTRACTION
def extract_global_track(
    ephemeris: BoundedPropagator,
    inertial_frame: Frame,
    earth_shape: OneAxisEllipsoid,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = GLOBAL_TRACK_STEP_SECONDS,
) -> list[GlobalTrackPoint]:
    """Sample an Orekit ephemeris into global track points.

    setup_orekit_environment must run before this function imports Orekit helpers.
    """
    if step_seconds <= 0.0:
        raise ValueError("The global track step size must be a positive number.")

    track_start_time = normalize_datetime_to_utc(start_time)
    track_end_time = normalize_datetime_to_utc(end_time)

    if track_end_time <= track_start_time:
        raise ValueError("The global track end time must be after the start time.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate

    sample_times = []
    current_sample_time = track_start_time

    while current_sample_time < track_end_time:
        sample_times.append(current_sample_time)
        current_sample_time = current_sample_time + timedelta(
            seconds=float(step_seconds),
        )

    sample_times.append(track_end_time)

    global_track_points = []

    for sample_time in sample_times:
        sample_absolute_date = datetime_to_absolutedate(sample_time)
        spacecraft_state = ephemeris.propagate(sample_absolute_date)
        pv_coordinates = spacecraft_state.getPVCoordinates(inertial_frame)

        position_vector = pv_coordinates.getPosition()
        velocity_vector = pv_coordinates.getVelocity()

        geodetic_point = earth_shape.transform(
            position_vector,
            inertial_frame,
            sample_absolute_date,
        )

        track_point = GlobalTrackPoint(
            timestamp=sample_time,
            position_gcrf_m=[
                float(position_vector.getX()),
                float(position_vector.getY()),
                float(position_vector.getZ()),
            ],
            velocity_gcrf_mps=[
                float(velocity_vector.getX()),
                float(velocity_vector.getY()),
                float(velocity_vector.getZ()),
            ],
            latitude_deg=float(degrees(geodetic_point.getLatitude())),
            longitude_deg=float(degrees(geodetic_point.getLongitude())),
            altitude_m=float(geodetic_point.getAltitude()),
        )
        global_track_points.append(track_point)

    return global_track_points


# ==========================================
# OVERPASS PROFILE EXTRACTION
def extract_overpass_profile(
    ephemeris: BoundedPropagator,
    inertial_frame: Frame,
    earth_shape: OneAxisEllipsoid,
    groundstation_context: GroundStationRuntimeContext,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = OVERPASS_PROFILE_STEP_SECONDS,
) -> list[OverpassProfilePoint]:
    """Sample one overpass into ground-station-relative points.

    setup_orekit_environment must run before this function imports Orekit helpers.
    """
    if step_seconds <= 0.0:
        raise ValueError("The overpass profile step size must be a positive number.")

    profile_start_time = normalize_datetime_to_utc(start_time)
    profile_end_time = normalize_datetime_to_utc(end_time)

    if profile_end_time <= profile_start_time:
        raise ValueError("The overpass profile end time must be after the start time.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate

    sample_times = []
    current_sample_time = profile_start_time

    while current_sample_time < profile_end_time:
        sample_times.append(current_sample_time)
        current_sample_time = current_sample_time + timedelta(
            seconds=float(step_seconds),
        )

    sample_times.append(profile_end_time)

    overpass_profile_points = []
    topocentric_frame = groundstation_context.topocentric_frame

    for sample_time in sample_times:
        sample_absolute_date = datetime_to_absolutedate(sample_time)
        spacecraft_state = ephemeris.propagate(sample_absolute_date)
        pv_coordinates = spacecraft_state.getPVCoordinates(inertial_frame)
        position_vector = pv_coordinates.getPosition()

        geodetic_point = earth_shape.transform(
            position_vector,
            inertial_frame,
            sample_absolute_date,
        )
        tracking_coordinates = topocentric_frame.getTrackingCoordinates(
            position_vector,
            inertial_frame,
            sample_absolute_date,
        )

        azimuth_deg = degrees(tracking_coordinates.getAzimuth()) % 360.0

        overpass_profile_point = OverpassProfilePoint(
            timestamp=sample_time,
            latitude_deg=float(degrees(geodetic_point.getLatitude())),
            longitude_deg=float(degrees(geodetic_point.getLongitude())),
            altitude_m=float(geodetic_point.getAltitude()),
            elevation_deg=float(degrees(tracking_coordinates.getElevation())),
            azimuth_deg=float(azimuth_deg),
            range_m=float(tracking_coordinates.getRange()),
        )
        overpass_profile_points.append(overpass_profile_point)

    return overpass_profile_points


# ==========================================
# OVERPASS BLOCK BUILDING
def build_overpass_block(
    overpass_event: OverpassEvent,
    high_res_trajectory: list[OverpassProfilePoint],
    pair_pass_number: int,
) -> OverpassBlock:
    """Build one frontend block for a single satellite overpass."""
    if not high_res_trajectory:
        raise ValueError("Cannot calculate max elevation without trajectory points.")

    overpass_start_time = normalize_datetime_to_utc(overpass_event.start_time)
    overpass_end_time = normalize_datetime_to_utc(overpass_event.end_time)

    if overpass_end_time <= overpass_start_time:
        raise ValueError("The overpass end time must be after the start time.")

    max_elevation_deg = max(
        float(trajectory_point.elevation_deg)
        for trajectory_point in high_res_trajectory
    )

    satellite_name = overpass_event.satellite_name
    groundstation_name = overpass_event.groundstation_info.name
    overpass_name = (
        f"pass__{satellite_name}__{groundstation_name}__{pair_pass_number:03d}"
    )
    overpass_id = f"OP_{pair_pass_number:04d}"

    return OverpassBlock(
        overpass_id=overpass_id,
        overpass_name=overpass_name,
        satellite_name=satellite_name,
        groundstation_name=groundstation_name,
        start_time=overpass_start_time,
        end_time=overpass_end_time,
        duration_seconds=float(
            (overpass_end_time - overpass_start_time).total_seconds()
        ),
        max_elevation_deg=float(max_elevation_deg),
        high_res_trajectory=high_res_trajectory,
    )


# ==========================================
# RESULT METADATA BUILDING
def build_result_metadata(
    run_id: str,
    start_time: datetime,
    end_time: datetime,
    global_track_step_seconds: float,
    overpass_profile_step_seconds: float,
) -> PropagationMetadata:
    """Build run metadata for the propagation result."""
    metadata_start_time = normalize_datetime_to_utc(start_time)
    metadata_end_time = normalize_datetime_to_utc(end_time)

    return PropagationMetadata(
        run_id=run_id,
        start_time=metadata_start_time,
        end_time=metadata_end_time,
        global_track_step_seconds=float(global_track_step_seconds),
        overpass_profile_step_seconds=float(overpass_profile_step_seconds),
    )
