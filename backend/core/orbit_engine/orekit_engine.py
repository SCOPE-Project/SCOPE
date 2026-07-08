# core/orbit_engine/orekit_engine.py

import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import degrees, radians
from numbers import Real
from pathlib import Path
from typing import Any, Callable

import jdk4py
import jpype
import orekit_jpype

from core.models.domain import (
    GroundStationInformation,
    PropagationRawResult,
    SatelliteInformation,
    TimeInterval,
)

"""
This module implements the Orekit-based orbit propagation engine. 
It provides a high-level function to run the complete propagation 
pipeline for a given task, including input validation, Orekit 
environment setup, satellite propagation, global track extraction,
and visibility event handling.

Inputs:
- `task_id`: A unique identifier for the propagation task.
- `satellite_infos`: A list of `SatelliteInformation` objects representing the satellites to propagate.
- `ground_station_infos`: A list of `GroundStationInformation` objects representing the ground stations.
- `time_interval`: A `TimeInterval` object defining the start and end times for the propagation.
- `on_progress_update`: An optional callback function to report progress updates.

Outputs:
- `PropagationRawResult`: The result of the propagation task, containing the propagated orbits and visibility events.

"""



# ===================================================
# CONSTANTS
GLOBAL_TRACK_STEP_SECONDS = 60.0
OVERPASS_PROFILE_STEP_SECONDS = 10.0
DEFAULT_GROUND_STATION_ALTITUDE_M = 0.0
DEFAULT_POSITION_TOLERANCE_M = 10.0

# ===================================================
# OREKIT LOCKS AND JVM SETUP CACHE
_OREKIT_SETUP_LOCK = threading.Lock()
_OREKIT_ENVIRONMENT_IS_READY = False

# Orekit Java classes are imported inside functions after the JVM is ready.

# ===================================================
# Internal dataclasses
@dataclass
class GroundStationRuntimeContext:
    """Runtime link between a ground station and its Orekit topocentric frame."""
    ground_station_info: GroundStationInformation
    topocentric_frame: Any


@dataclass
class OverpassEvent:
    """Internal AOS/LOS event pair for one satellite and one ground station."""
    satellite_name: str
    ground_station_info: GroundStationInformation
    start_time: datetime
    end_time: datetime


# ===================================================
# MAIN ENGINE FUNCTION
def run_orekit_engine(
    task_id: str,
    satellite_infos: list[SatelliteInformation],
    ground_station_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
    on_progress_update: Callable[[str, str, int], None] | None = None,
) -> PropagationRawResult:
    
    """Run the complete Orekit propagation pipeline for one task."""
    
    report_progress(
        task_id,
        "Preparing Orekit engine...",
        0,
        on_progress_update,
    )
    validate_orekit_engine_inputs(
        satellite_infos=satellite_infos,
        ground_station_infos=ground_station_infos,
        time_interval=time_interval,
    )

    propagation_start_time = normalize_datetime_to_utc(time_interval.start_time)
    propagation_end_time = normalize_datetime_to_utc(time_interval.end_time)

    report_progress(
        task_id,
        "Setting up Orekit environment...",
        5,
        on_progress_update,
    )
    setup_orekit_environment()

    from org.orekit.bodies import OneAxisEllipsoid
    from org.orekit.frames import FramesFactory
    from org.orekit.utils import IERSConventions

    from orbit_propagation_pipeline.utils.propagation_utils.constants import Constants

    earth_fixed_frame = FramesFactory.getITRF(IERSConventions.IERS_2010, True)
    earth_shape = OneAxisEllipsoid(
        Constants.R_E,
        Constants.f_E,
        earth_fixed_frame,
    )

    ground_station_contexts = build_ground_station_contexts(
        ground_station_infos=ground_station_infos,
        earth_shape=earth_shape,
    )
    ground_station_context_by_name: dict[str, GroundStationRuntimeContext] = {}

    for ground_station_context in ground_station_contexts:
        ground_station_name = ground_station_context.ground_station_info.name
        ground_station_context_by_name[ground_station_name] = ground_station_context

    global_tracks: dict[str, list[dict[str, object]]] = {}
    overpass_blocks: list[dict[str, object]] = []
    overpass_pair_counts: dict[tuple[str, str], int] = {}
    total_satellite_count = len(satellite_infos)
    satellite_progress_start_percent = 10
    satellite_progress_range_percent = 80

    for satellite_index, satellite_info in enumerate(satellite_infos):
        satellite_progress_start = satellite_progress_start_percent + int(
            satellite_index
            * satellite_progress_range_percent
            / total_satellite_count,
        )
        satellite_progress_after_propagation = satellite_progress_start_percent + int(
            (satellite_index + 0.5)
            * satellite_progress_range_percent
            / total_satellite_count,
        )
        satellite_progress_done = satellite_progress_start_percent + int(
            (satellite_index + 1)
            * satellite_progress_range_percent
            / total_satellite_count,
        )

        report_progress(
            task_id,
            f"Propagating satellite {satellite_info.name}...",
            satellite_progress_start,
            on_progress_update,
        )

        propagator, inertial_frame = build_satellite_propagator(
            satellite_info=satellite_info,
        )
        satellite_event_log: list[OverpassEvent] = []

        attach_visibility_detectors(
            propagator=propagator,
            satellite_info=satellite_info,
            ground_station_contexts=ground_station_contexts,
            satellite_event_log=satellite_event_log,
            propagation_start_time=propagation_start_time,
            propagation_end_time=propagation_end_time,
        )
        ephemeris = propagate_satellite(
            propagator=propagator,
            start_time=propagation_start_time,
            end_time=propagation_end_time,
        )

        report_progress(
            task_id,
            f"Extracting track for satellite {satellite_info.name}...",
            satellite_progress_after_propagation,
            on_progress_update,
        )
        global_tracks[satellite_info.name] = extract_global_track(
            ephemeris=ephemeris,
            inertial_frame=inertial_frame,
            earth_shape=earth_shape,
            start_time=propagation_start_time,
            end_time=propagation_end_time,
            step_seconds=GLOBAL_TRACK_STEP_SECONDS,
        )

        sorted_overpass_events = sorted(
            satellite_event_log,
            key=lambda overpass_event: (
                normalize_datetime_to_utc(overpass_event.start_time),
                overpass_event.ground_station_info.name,
            ),
        )

        for overpass_event in sorted_overpass_events:
            ground_station_name = overpass_event.ground_station_info.name
            ground_station_context = ground_station_context_by_name[ground_station_name]
            overpass_pair_key = (
                overpass_event.satellite_name,
                ground_station_name,
            )
            previous_pair_pass_count = overpass_pair_counts.get(
                overpass_pair_key,
                0,
            )
            pair_pass_number = previous_pair_pass_count + 1
            overpass_pair_counts[overpass_pair_key] = pair_pass_number

            high_res_trajectory = extract_overpass_profile(
                ephemeris=ephemeris,
                inertial_frame=inertial_frame,
                earth_shape=earth_shape,
                ground_station_context=ground_station_context,
                start_time=overpass_event.start_time,
                end_time=overpass_event.end_time,
                step_seconds=OVERPASS_PROFILE_STEP_SECONDS,
            )
            overpass_block = build_overpass_block(
                overpass_event=overpass_event,
                high_res_trajectory=high_res_trajectory,
                pair_pass_number=pair_pass_number,
            )
            overpass_blocks.append(overpass_block)

        report_progress(
            task_id,
            f"Finished satellite {satellite_info.name}.",
            satellite_progress_done,
            on_progress_update,
        )

    overpass_blocks.sort(key=lambda overpass_block: overpass_block["start_time"])

    metadata = build_result_metadata(
        task_id=task_id,
        start_time=propagation_start_time,
        end_time=propagation_end_time,
        global_track_step_seconds=GLOBAL_TRACK_STEP_SECONDS,
        overpass_profile_step_seconds=OVERPASS_PROFILE_STEP_SECONDS,
    )
    propagation_raw_result = PropagationRawResult(
        metadata=metadata,
        global_tracks=global_tracks,
        overpass_blocks=overpass_blocks,
    )

    report_progress(
        task_id,
        "Complete",
        100,
        on_progress_update,
    )

    return propagation_raw_result


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
                f"Satellite {satellite_info.name!r} must have exactly three position values."
            )

        if (
            not isinstance(satellite_info.velocity_v, list)
            or len(satellite_info.velocity_v) != 3
        ):
            raise ValueError(
                f"Satellite {satellite_info.name!r} must have exactly three velocity values."
            )

        for position_value in satellite_info.position_r:
            if not isinstance(position_value, Real) or isinstance(position_value, bool):
                raise ValueError(
                    f"Satellite {satellite_info.name!r} position values must be float or int."
                )

        for velocity_value in satellite_info.velocity_v:
            if not isinstance(velocity_value, Real) or isinstance(velocity_value, bool):
                raise ValueError(
                    f"Satellite {satellite_info.name!r} velocity values must be float or int."
                )

        if not isinstance(satellite_info.state_timestamp, datetime):
            raise ValueError(
                f"Satellite {satellite_info.name!r} state_timestamp must be a datetime."
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


# ==========================================
# OREKIT ENVIRONMENT SETUP
def setup_orekit_environment() -> None:
    """Initialize the JVM and load Orekit data exactly once per Python process."""

    global _OREKIT_ENVIRONMENT_IS_READY

    with _OREKIT_SETUP_LOCK:
        if _OREKIT_ENVIRONMENT_IS_READY:
            return

        # Set up the JVM and Orekit data path
        project_root = Path(__file__).resolve().parents[3]
        orekit_data_path = project_root / "orekit-data"

        if not orekit_data_path.is_dir():
            raise FileNotFoundError(
                f"Orekit data directory not found at {orekit_data_path}."
            )

        # Set up the Java environment variables and paths
        java_home_path = Path(jdk4py.JAVA_HOME)
        java_bin_path = java_home_path / "bin"

        os.environ["JAVA_HOME"] = str(java_home_path)

        current_path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if str(java_bin_path) not in current_path_entries:
            os.environ["PATH"] = (
                str(java_bin_path)
                + os.pathsep
                + os.environ.get("PATH", "")
            )
        jvm_library_candidates = [
            java_home_path / "bin" / "server" / "jvm.dll",         # Windows
            java_home_path / "lib" / "server" / "libjvm.so",       # Linux
            java_home_path / "lib" / "server" / "libjvm.dylib",    # macOS
        ]

        jvm_library_path = None
        for candidate_path in jvm_library_candidates:
            if candidate_path.exists():
                jvm_library_path = candidate_path
                break

        if jvm_library_path is None:
            raise FileNotFoundError(
                f"Could not find the JVM shared library below {java_home_path}."
            )

        if not jpype.isJVMStarted():
            orekit_jpype.initVM(jvmpath=str(jvm_library_path))

        # Load Orekit data from the local directory, not from the pip-installed package
        from orekit_jpype.pyhelpers import setup_orekit_data

        setup_orekit_data(str(orekit_data_path), from_pip_library=False)
        _OREKIT_ENVIRONMENT_IS_READY = True


# ==========================================
# GROUND STATION GEOMETRY
def build_ground_station_contexts(
    ground_station_infos: list[GroundStationInformation],
    earth_shape: Any,
) -> list[GroundStationRuntimeContext]:
    """Build Orekit topocentric frames for all selected ground stations."""
    from org.orekit.bodies import GeodeticPoint
    from org.orekit.frames import TopocentricFrame

    ground_station_contexts = []

    for ground_station_info in ground_station_infos:
        # Orekit geodetic latitude and longitude are expected in radians.
        latitude_rad = radians(ground_station_info.latitude)
        longitude_rad = radians(ground_station_info.longitude)
        altitude_m = DEFAULT_GROUND_STATION_ALTITUDE_M

        geodetic_point = GeodeticPoint(
            latitude_rad,
            longitude_rad,
            altitude_m,
        )

        topocentric_frame = TopocentricFrame(
            earth_shape,
            geodetic_point,
            ground_station_info.name,
        )

        ground_station_context = GroundStationRuntimeContext(
            ground_station_info=ground_station_info,
            topocentric_frame=topocentric_frame,
        )
        ground_station_contexts.append(ground_station_context)

    return ground_station_contexts


# ==========================================
# SATELLITE PROPAGATOR SETUP
def build_satellite_propagator(
    satellite_info: SatelliteInformation,
    position_tolerance_m: float = DEFAULT_POSITION_TOLERANCE_M,
) -> tuple[Any, Any]:
    """Build an Orekit numerical propagator from a Cartesian GCRF satellite state.

    setup_orekit_environment must run before this function imports Orekit classes.
    """
    if position_tolerance_m <= 0.0:
        raise ValueError("The position tolerance must be a positive number.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate
    from org.hipparchus.geometry.euclidean.threed import Vector3D
    from org.hipparchus.ode.nonstiff import DormandPrince853Integrator
    from org.orekit.forces.gravity import J2OnlyPerturbation, NewtonianAttraction
    from org.orekit.frames import FramesFactory
    from org.orekit.orbits import CartesianOrbit, OrbitType
    from org.orekit.propagation import SpacecraftState
    from org.orekit.propagation.numerical import NumericalPropagator
    from org.orekit.utils import IERSConventions, PVCoordinates

    from orbit_propagation_pipeline.utils.propagation_utils.constants import Constants

    state_timestamp = normalize_datetime_to_utc(satellite_info.state_timestamp)
    state_absolute_date = datetime_to_absolutedate(state_timestamp)

    inertial_frame = FramesFactory.getGCRF()
    earth_fixed_frame = FramesFactory.getITRF(IERSConventions.IERS_2010, True)

    # The domain model stores the Cartesian state in GCRF meters and meters per second.
    position_vector_m = Vector3D(
        float(satellite_info.position_r[0]),
        float(satellite_info.position_r[1]),
        float(satellite_info.position_r[2]),
    )
    velocity_vector_mps = Vector3D(
        float(satellite_info.velocity_v[0]),
        float(satellite_info.velocity_v[1]),
        float(satellite_info.velocity_v[2]),
    )

    pv_coordinates = PVCoordinates(
        position_vector_m,
        velocity_vector_mps,
    )
    initial_orbit = CartesianOrbit(
        pv_coordinates,
        inertial_frame,
        state_absolute_date,
        Constants.MU_E,
    )
    initial_spacecraft_state = SpacecraftState(initial_orbit)

    tolerance_vectors = NumericalPropagator.tolerances(
        float(position_tolerance_m),
        initial_orbit,
        OrbitType.CARTESIAN,
    )

    minimum_integration_step_seconds = 0.001
    maximum_integration_step_seconds = 60.0

    integrator = DormandPrince853Integrator(
        minimum_integration_step_seconds,
        maximum_integration_step_seconds,
        tolerance_vectors[0],
        tolerance_vectors[1],
    )

    propagator = NumericalPropagator(integrator)
    propagator.setOrbitType(OrbitType.CARTESIAN)
    propagator.setMu(Constants.MU_E)
    propagator.setInitialState(initial_spacecraft_state)

    # Current force model: Central Earth attraction plus J2
    propagator.addForceModel(NewtonianAttraction(Constants.MU_E))
    propagator.addForceModel(
        J2OnlyPerturbation(
            Constants.MU_E,
            Constants.R_E,
            Constants.J2_E,
            earth_fixed_frame,
        )
    )

    return propagator, inertial_frame


# ==========================================
# SATELLITE PROPAGATION
def propagate_satellite(
    propagator: Any,
    start_time: datetime,
    end_time: datetime,
) -> Any:
    """Propagate one satellite and return the generated Orekit ephemeris.

    setup_orekit_environment must run before this function imports Orekit helpers.
    """
    propagation_start_time = normalize_datetime_to_utc(start_time)
    propagation_end_time = normalize_datetime_to_utc(end_time)

    if propagation_end_time <= propagation_start_time:
        raise ValueError("The propagation end time must be after the start time.")

    from orekit_jpype.pyhelpers import datetime_to_absolutedate

    start_absolute_date = datetime_to_absolutedate(propagation_start_time)
    end_absolute_date = datetime_to_absolutedate(propagation_end_time)

    # The ephemeris generator records the propagation result for later sampling.
    ephemeris_generator = propagator.getEphemerisGenerator()
    propagator.propagate(start_absolute_date, end_absolute_date)

    return ephemeris_generator.getGeneratedEphemeris()


# ==========================================
# GLOBAL TRACK EXTRACTION
def extract_global_track(
    ephemeris: Any,
    inertial_frame: Any,
    earth_shape: Any,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = GLOBAL_TRACK_STEP_SECONDS,
) -> list[dict[str, object]]:
    """Sample an Orekit ephemeris into JSON-friendly global track points.

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

        track_point = {
            "timestamp": to_utc_iso_string(sample_time),
            "position_gcrf_m": [
                float(position_vector.getX()),
                float(position_vector.getY()),
                float(position_vector.getZ()),
            ],
            "velocity_gcrf_mps": [
                float(velocity_vector.getX()),
                float(velocity_vector.getY()),
                float(velocity_vector.getZ()),
            ],
            "latitude_deg": float(degrees(geodetic_point.getLatitude())),
            "longitude_deg": float(degrees(geodetic_point.getLongitude())),
            "altitude_m": float(geodetic_point.getAltitude()),
        }
        global_track_points.append(track_point)

    return global_track_points


# ==========================================
# VISIBILITY EVENT HANDLING
class VisibilityEventHandler:
    """Collect AOS/LOS event pairs for one satellite-groundstation detector."""

    def __init__(
        self,
        satellite_name: str,
        ground_station_info: GroundStationInformation,
        satellite_event_log: list[OverpassEvent],
        propagation_start_time: datetime,
        propagation_end_time: datetime,
    ) -> None:
        self.satellite_name = satellite_name
        self.ground_station_info = ground_station_info
        self.satellite_event_log = satellite_event_log
        self.propagation_start_time = normalize_datetime_to_utc(
            propagation_start_time,
        )
        self.propagation_end_time = normalize_datetime_to_utc(
            propagation_end_time,
        )
        self.current_overpass_start_time = None

    def init(
        self,
        initial_state: Any,
        target: Any,
        detector: Any,
    ) -> None:
        """Remember visibility at propagation start when the pass is already active."""
        is_visible_at_start = detector.g(initial_state) >= 0.0

        if is_visible_at_start:
            self.current_overpass_start_time = self.propagation_start_time

    def eventOccurred(
        self,
        spacecraft_state: Any,
        detector: Any,
        increasing: bool,
    ) -> Any:
        """Handle one elevation threshold crossing and keep propagation running."""
        from orekit_jpype.pyhelpers import absolutedate_to_datetime
        from org.hipparchus.ode.events import Action

        event_time = absolutedate_to_datetime(
            spacecraft_state.getDate(),
            tz_aware=True,
        )
        event_time = normalize_datetime_to_utc(event_time)

        if increasing:
            if self.current_overpass_start_time is None:
                self.current_overpass_start_time = event_time

            return Action.CONTINUE

        overpass_start_time = self.current_overpass_start_time

        if overpass_start_time is None:
            overpass_start_time = self.propagation_start_time

        if event_time > overpass_start_time:
            overpass_event = OverpassEvent(
                satellite_name=self.satellite_name,
                ground_station_info=self.ground_station_info,
                start_time=overpass_start_time,
                end_time=event_time,
            )
            self.satellite_event_log.append(overpass_event)

        self.current_overpass_start_time = None
        return Action.CONTINUE

    def finish(
        self,
        final_state: Any,
        detector: Any,
    ) -> None:
        """Close a visibility interval that is still active at propagation end."""
        if self.current_overpass_start_time is None:
            return

        overpass_start_time = self.current_overpass_start_time
        overpass_end_time = self.propagation_end_time

        if overpass_end_time > overpass_start_time:
            overpass_event = OverpassEvent(
                satellite_name=self.satellite_name,
                ground_station_info=self.ground_station_info,
                start_time=overpass_start_time,
                end_time=overpass_end_time,
            )
            self.satellite_event_log.append(overpass_event)

        self.current_overpass_start_time = None

    def resetState(
        self,
        detector: Any,
        old_state: Any,
    ) -> Any:
        """Keep the spacecraft state unchanged after visibility events."""
        return old_state


# ==========================================
# VISIBILITY DETECTOR SETUP
def attach_visibility_detectors(
    propagator: Any,
    satellite_info: SatelliteInformation,
    ground_station_contexts: list[GroundStationRuntimeContext],
    satellite_event_log: list[OverpassEvent],
    propagation_start_time: datetime,
    propagation_end_time: datetime,
) -> None:
    """Attach one elevation detector per ground station to a satellite propagator.

    setup_orekit_environment must run before this function imports Orekit classes.
    """
    visibility_start_time = normalize_datetime_to_utc(propagation_start_time)
    visibility_end_time = normalize_datetime_to_utc(propagation_end_time)

    if visibility_end_time <= visibility_start_time:
        raise ValueError("The visibility end time must be after the start time.")

    from org.orekit.propagation.events import ElevationDetector
    from org.orekit.propagation.events.handlers import EventHandler

    for ground_station_context in ground_station_contexts:
        ground_station_info = ground_station_context.ground_station_info
        minimum_elevation_rad = radians(
            ground_station_info.min_elevation_angle_deg,
        )

        visibility_event_handler = VisibilityEventHandler(
            satellite_name=satellite_info.name,
            ground_station_info=ground_station_info,
            satellite_event_log=satellite_event_log,
            propagation_start_time=visibility_start_time,
            propagation_end_time=visibility_end_time,
        )
        visibility_event_handler_proxy = jpype.JProxy(
            EventHandler,
            inst=visibility_event_handler,
        )

        visibility_detector = ElevationDetector(
            ground_station_context.topocentric_frame,
        )
        visibility_detector = visibility_detector.withConstantElevation(
            minimum_elevation_rad,
        )
        visibility_detector = visibility_detector.withHandler(
            visibility_event_handler_proxy,
        )

        propagator.addEventDetector(visibility_detector)


# ==========================================
# OVERPASS PROFILE EXTRACTION
def extract_overpass_profile(
    ephemeris: Any,
    inertial_frame: Any,
    earth_shape: Any,
    ground_station_context: GroundStationRuntimeContext,
    start_time: datetime,
    end_time: datetime,
    step_seconds: float = OVERPASS_PROFILE_STEP_SECONDS,
) -> list[dict[str, object]]:
    """Sample one overpass into JSON-friendly ground-station-relative points.

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
    topocentric_frame = ground_station_context.topocentric_frame

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

        overpass_profile_point = {
            "timestamp": to_utc_iso_string(sample_time),
            "latitude_deg": float(degrees(geodetic_point.getLatitude())),
            "longitude_deg": float(degrees(geodetic_point.getLongitude())),
            "altitude_m": float(geodetic_point.getAltitude()),
            "elevation_deg": float(degrees(tracking_coordinates.getElevation())),
            "azimuth_deg": float(azimuth_deg),
            "range_m": float(tracking_coordinates.getRange()),
        }
        overpass_profile_points.append(overpass_profile_point)

    return overpass_profile_points


# ==========================================
# OVERPASS BLOCK BUILDING
def build_overpass_block(
    overpass_event: OverpassEvent,
    high_res_trajectory: list[dict[str, object]],
    pair_pass_number: int,
) -> dict[str, object]:
    """Build one JSON-friendly frontend block for a single satellite overpass."""
    if not high_res_trajectory:
        raise ValueError("Cannot calculate max elevation without trajectory points.")

    overpass_start_time = normalize_datetime_to_utc(overpass_event.start_time)
    overpass_end_time = normalize_datetime_to_utc(overpass_event.end_time)

    if overpass_end_time <= overpass_start_time:
        raise ValueError("The overpass end time must be after the start time.")

    max_elevation_deg = max(
        float(trajectory_point["elevation_deg"])
        for trajectory_point in high_res_trajectory
    )

    satellite_name = overpass_event.satellite_name
    ground_station_name = overpass_event.ground_station_info.name
    overpass_id = (
        f"{satellite_name}__"
        f"{ground_station_name}__"
        f"pass_{pair_pass_number:03d}"
    )

    return {
        "overpass_id": overpass_id,
        "satellite_name": satellite_name,
        "ground_station_name": ground_station_name,
        "start_time": to_utc_iso_string(overpass_start_time),
        "end_time": to_utc_iso_string(overpass_end_time),
        "duration_seconds": float(
            (overpass_end_time - overpass_start_time).total_seconds()
        ),
        "max_elevation_deg": float(max_elevation_deg),
        "high_res_trajectory": high_res_trajectory,
    }


# ==========================================
# RESULT METADATA BUILDING
def build_result_metadata(
    task_id: str,
    start_time: datetime,
    end_time: datetime,
    global_track_step_seconds: float,
    overpass_profile_step_seconds: float,
) -> dict[str, object]:
    """Build JSON-friendly run metadata for the propagation result."""
    metadata_start_time = normalize_datetime_to_utc(start_time)
    metadata_end_time = normalize_datetime_to_utc(end_time)

    return {
        "task_id": task_id,
        "start_time": to_utc_iso_string(metadata_start_time),
        "end_time": to_utc_iso_string(metadata_end_time),
        "global_track_step_seconds": float(global_track_step_seconds),
        "overpass_profile_step_seconds": float(overpass_profile_step_seconds),
    }


# ==========================================
# TIME FORMATTING: Make timezone-aware UTC datetimes
def normalize_datetime_to_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime.

    Naive datetimes are treated as UTC because API callers may send timestamps
    without explicit timezone information.
    """
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)

# ==========================================
# TIME FORMATTING: Datetime to UTC ISO string
def to_utc_iso_string(value: datetime) -> str:
    """Return a UTC ISO timestamp for JSON-friendly engine output."""
    utc_datetime = normalize_datetime_to_utc(value)
    return utc_datetime.isoformat()

# ==========================================
# PROGRESS REPORTING
def report_progress(
    task_id: str,
    message: str,
    progress: int,
    on_progress_update: Callable[[str, str, int], None] | None,
) -> None:
    """Send a bounded progress update when a callback is available."""
    if on_progress_update is None:
        return

    bounded_progress = max(0, min(100, int(progress)))
    on_progress_update(task_id, message, bounded_progress)
