# core/orbit_engine/orekit_engine.py

"""High-level orchestration for the Orekit-based propagation pipeline."""

from typing import Callable

from core.models.domain import (
    GroundStationInformation,
    PropagationRawResult,
    SatelliteInformation,
    TimeInterval,
)
from core.orbit_engine.groundstation_frames import (
    GroundStationRuntimeContext,
    build_groundstation_contexts,
)
from core.orbit_engine.input_validation import validate_orekit_engine_inputs
from core.orbit_engine.orekit_setup import setup_orekit_environment
from core.orbit_engine.progress_reporting import report_progress
from core.orbit_engine.propagator_builder import (
    build_satellite_propagator,
    propagate_satellite,
)
from core.orbit_engine.result_extraction import (
    GLOBAL_TRACK_STEP_SECONDS,
    OVERPASS_PROFILE_STEP_SECONDS,
    build_overpass_block,
    build_result_metadata,
    extract_global_track,
    extract_overpass_profile,
)
from core.orbit_engine.time_utils import normalize_datetime_to_utc
from core.orbit_engine.visibility_events import (
    OverpassEvent,
    attach_visibility_detectors,
)


# ===================================================
# MAIN ENGINE FUNCTION
def run_orekit_engine(
    task_id: str,
    satellite_infos: list[SatelliteInformation],
    groundstation_infos: list[GroundStationInformation],
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
        groundstation_infos=groundstation_infos,
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

    groundstation_contexts = build_groundstation_contexts(
        groundstation_infos=groundstation_infos,
        earth_shape=earth_shape,
    )
    groundstation_context_by_name: dict[str, GroundStationRuntimeContext] = {}

    for groundstation_context in groundstation_contexts:
        groundstation_name = groundstation_context.groundstation_info.name
        groundstation_context_by_name[groundstation_name] = groundstation_context

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
            groundstation_contexts=groundstation_contexts,
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

        # overpass_event Type is OverpassEvent
        sorted_overpass_events = sorted(
            satellite_event_log,
            key=lambda overpass_event: (
                normalize_datetime_to_utc(overpass_event.start_time),
                overpass_event.groundstation_info.name,
            ),
        )

        for overpass_event in sorted_overpass_events:
            groundstation_name = overpass_event.groundstation_info.name
            groundstation_context = groundstation_context_by_name[groundstation_name]
            overpass_pair_key = (
                overpass_event.satellite_name,
                groundstation_name,
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
                groundstation_context=groundstation_context,
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
