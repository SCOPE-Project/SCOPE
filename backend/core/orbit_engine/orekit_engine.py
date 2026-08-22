# core/orbit_engine/orekit_engine.py

"""High-level orchestration for the Orekit-based propagation pipeline."""
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from org.orekit.bodies import OneAxisEllipsoid

from typing import Callable
from datetime import datetime

from core.models.assets import (
    GroundStationInformation,
    SatelliteInformation,
    TimeInterval,
)
from core.models.propagation import (
    PropagationResult,
    GlobalTrackPoint,
    OverpassBlock,
    SatelliteTrajectory,
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
# HELPER EXTRACTION FUNCTION
def propagate_and_extract_for_satellite(
    satellite_info: SatelliteInformation,
    groundstation_contexts: list[GroundStationRuntimeContext],
    propagation_start_time: datetime,
    propagation_end_time: datetime,
    earth_shape: OneAxisEllipsoid,
) -> tuple[list[GlobalTrackPoint], list[OverpassBlock]]:
    """Propagates a single satellite and extracts its global track and overpass blocks."""
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

    track = extract_global_track(
        ephemeris=ephemeris,
        inertial_frame=inertial_frame,
        earth_shape=earth_shape,
        start_time=propagation_start_time,
        end_time=propagation_end_time,
        step_seconds=GLOBAL_TRACK_STEP_SECONDS,
    )

    # Sort overpasses chronologically
    sorted_overpass_events = sorted(
        satellite_event_log,
        key=lambda event: (
            normalize_datetime_to_utc(event.start_time),
            event.groundstation_info.name,
        ),
    )

    overpass_blocks = []
    groundstation_pass_counts: dict[str, int] = {}
    groundstation_context_by_name = {
        ctx.groundstation_info.name: ctx for ctx in groundstation_contexts
    }

    for overpass_event in sorted_overpass_events:
        gs_name = overpass_event.groundstation_info.name
        gs_context = groundstation_context_by_name[gs_name]
        
        pass_num = groundstation_pass_counts.get(gs_name, 0) + 1
        groundstation_pass_counts[gs_name] = pass_num

        high_res_trajectory = extract_overpass_profile(
            ephemeris=ephemeris,
            inertial_frame=inertial_frame,
            earth_shape=earth_shape,
            groundstation_context=gs_context,
            start_time=overpass_event.start_time,
            end_time=overpass_event.end_time,
            step_seconds=OVERPASS_PROFILE_STEP_SECONDS,
        )
        overpass_block = build_overpass_block(
            overpass_event=overpass_event,
            high_res_trajectory=high_res_trajectory,
            pair_pass_number=pass_num,
        )
        overpass_blocks.append(overpass_block)

    return track, overpass_blocks


# ===================================================
# MAIN ENGINE FUNCTION
def run_orekit_engine(
    run_id: str,
    satellite_infos: list[SatelliteInformation],
    groundstation_infos: list[GroundStationInformation],
    time_interval: TimeInterval,
    on_progress_update: Callable[[str, str, int], None] | None = None,
) -> PropagationResult:
    """Run the complete Orekit propagation pipeline for one run."""
    report_progress(
        run_id,
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
        run_id,
        "Setting up Orekit environment...",
        5,
        on_progress_update,
    )
    setup_orekit_environment()

    from org.orekit.bodies import OneAxisEllipsoid
    from org.orekit.frames import FramesFactory
    from org.orekit.utils import IERSConventions

    from core.astrodynamics.constants import Constants

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

    global_tracks: list[SatelliteTrajectory] = []
    overpass_blocks: list[OverpassBlock] = []
    
    total_satellite_count = len(satellite_infos)
    
    satellite_progress_start_percent = 10
    satellite_progress_range_percent = 80

    # BEGIN FOR LOOP
    for satellite_index, satellite_info in enumerate(satellite_infos):
        satellite_progress_start = satellite_progress_start_percent + int(
            satellite_index
            * satellite_progress_range_percent
            / total_satellite_count,
        )
        satellite_progress_done = satellite_progress_start_percent + int(
            (satellite_index + 1)
            * satellite_progress_range_percent
            / total_satellite_count,
        )

        report_progress(
            run_id,
            f"Propagating satellite {satellite_info.name}...",
            satellite_progress_start,
            on_progress_update,
        )

        track, passes = propagate_and_extract_for_satellite(
            satellite_info=satellite_info,
            groundstation_contexts=groundstation_contexts,
            propagation_start_time=propagation_start_time,
            propagation_end_time=propagation_end_time,
            earth_shape=earth_shape,
        )
        global_tracks.append(
            SatelliteTrajectory(
                satellite_name=satellite_info.name,
                track=track,
            )
        )
        overpass_blocks.extend(passes)

        report_progress(
            run_id,
            f"Finished satellite {satellite_info.name}.",
            satellite_progress_done,
            on_progress_update,
        )
    # END FOR LOOP
    
    # Sort overpasses chronologically and assign sequential OP_xxxx identifiers
    overpass_blocks.sort(key=lambda overpass_block: overpass_block.start_time)
    for idx, block in enumerate(overpass_blocks, start=1):
        block.overpass_id = f"OP_{idx:04d}"

    metadata = build_result_metadata(
        run_id=run_id,
        start_time=propagation_start_time,
        end_time=propagation_end_time,
        global_track_step_seconds=GLOBAL_TRACK_STEP_SECONDS,
        overpass_profile_step_seconds=OVERPASS_PROFILE_STEP_SECONDS,
    )
    propagation_result = PropagationResult(
        metadata=metadata,
        global_tracks=global_tracks,
        overpass_blocks=overpass_blocks,
    )

    report_progress(
        run_id,
        "Complete",
        100,
        on_progress_update,
    )

    return propagation_result
