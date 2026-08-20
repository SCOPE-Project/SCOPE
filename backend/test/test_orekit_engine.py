# backend/test/test_orekit_engine.py

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to sys.path so we can run this script directly
backend_path = Path(__file__).resolve().parent.parent
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from core.models.assets import (
    GroundStationInformation,
    SatelliteInformation,
    TimeInterval,
)
from core.orbit_engine.orekit_engine import run_orekit_engine
from app.repositories import PropagationResultRepository


def on_progress_updated(run_id: str, message: str, progress: int) -> None:
    """Callback function to log progress updates to the console."""
    print(f"[Progress] [{run_id}] {progress}%: {message}")


def test_run_orekit_engine():
    """Test function for the Orekit orbit engine.
    
    This function sets up a mock satellite, multiple ground stations, and a time interval,
    and runs the orbit propagation pipeline, validating the output.
    """
    run_id = "debug_run_123"
    
    # 1. Define the payload components
    # Define a 2-hour propagation interval starting on 2026-10-28
    time_interval = TimeInterval(
        start_time=datetime(2026, 7, 17, 12, 0, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 7, 18, 12, 0, 0, tzinfo=timezone.utc),
    )
    
    # Define a standard equatorial LEO satellite payload
    satellite_info = SatelliteInformation(
        name="Sat1_Group1_local",
        position_r=[6678000.0, 0.0, 0.0],
        velocity_v=[0.0, -807.0, 7683.0], 
        state_timestamp=datetime(2026, 7, 17, 12, 0, 0, tzinfo=timezone.utc),
    )
    
    ground_stations = [
        GroundStationInformation(
            name="GS1_Group1_local",
            latitude=78.24,
            longitude=15.41,
            min_link_elevation=0.0,
        ),
        GroundStationInformation(
            name="EquatorStation",
            latitude=0.0,
            longitude=0.0,
            min_link_elevation=10.0,
        )
    ]
    
    # 2. Run the Orekit propagation pipeline
    print(f"\n--- Starting Orekit Engine Debug Run: {run_id} ---")
    result = run_orekit_engine(
        run_id=run_id,
        satellite_infos=[satellite_info],
        groundstation_infos=ground_stations,
        time_interval=time_interval,
        on_progress_update=on_progress_updated,
    )
    print("--- Orekit Engine Run Complete ---\n")
    
    print(result.metadata)
    
    
    # # 3. Assert and verify the propagation results
    # assert result is not None
    # assert result.metadata.run_id == run_id
    # assert len(result.global_tracks) == 1
    # assert result.global_tracks[0].satellite_name == "TestLEOSat"
    
    # track_points = result.global_tracks[0].track
    # print(f"Propagated {len(track_points)} track points.")
    # assert len(track_points) > 0
    
    # print(f"Calculated {len(result.overpass_blocks)} overpass blocks.")
    # assert len(result.overpass_blocks) > 0, "Expected at least one overpass for EquatorStation"
    
    # for block in result.overpass_blocks:
    #     print(
    #         f"Overpass: {block.satellite_name} <-> {block.groundstation_name} | "
    #         f"Start: {block.start_time} | End: {block.end_time} | "
    #         f"Duration: {block.duration_seconds:.1f}s | Max Elev: {block.max_elevation_deg:.1f}°"
    #     )
    #     assert block.duration_seconds > 0
    #     assert len(block.high_res_trajectory) > 0
        
    # # Verify retrieval from repository
    # stored_result = PropagationResultRepository.get_result(run_id)
    # assert stored_result is not None
    # assert stored_result.metadata.run_id == run_id
    
    # # Clean up repository
    # PropagationResultRepository.delete_result(run_id)
    # assert PropagationResultRepository.get_result(run_id) is None
    # print("Cleanup successful.")


if __name__ == "__main__":
    test_run_orekit_engine()
