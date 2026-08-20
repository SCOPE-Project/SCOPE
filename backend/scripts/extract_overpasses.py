"""
CLI Script: Extract Orbit Overpasses using Orekit Propagation Engine.

Usage:
    python scripts/extract_overpasses.py --satellites <SAT1> [<SAT2> ...] --groundstations <GS1> [<GS2> ...] --start-time <ISO_UTC> --end-time <ISO_UTC>

Description:
    Fetches satellite and ground station definitions from AssetRepository, validates time intervals,
    and runs the Orekit propagation pipeline. Results are stored in PropagationResultRepository.
"""

import sys
import argparse
import uuid
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import List

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# Load SatOS credentials from credentials.env
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from core.models.assets import (
    SatelliteInformation,
    GroundStationInformation,
    TimeInterval,
)
from app.repositories import (
    AssetRepository,
    PropagationResultRepository,
)
from core.orbit_engine import orekit_engine


def _parse_datetime(dt_str: str) -> datetime:
    """Parse an ISO 8601 string to timezone-aware UTC datetime."""
    try:
        dt = datetime.fromisoformat(dt_str)
    except Exception as e:
        print(f"HARD FAIL: Invalid ISO 8601 datetime format '{dt_str}': {e}", file=sys.stderr)
        sys.exit(1)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract geometric overpasses and trajectories using the Orekit orbit engine."
    )
    parser.add_argument(
        "--satellites", "-s",
        nargs="+",
        required=True,
        help="List of satellite names (must exist in AssetRepository).",
    )
    parser.add_argument(
        "--groundstations", "-g",
        nargs="+",
        required=True,
        help="List of ground station names (must exist in AssetRepository).",
    )
    parser.add_argument(
        "--start-time",
        type=str,
        required=True,
        help="Start time in ISO 8601 format (e.g. '2026-08-17T12:00:00Z').",
    )
    parser.add_argument(
        "--end-time",
        type=str,
        required=True,
        help="End time in ISO 8601 format (e.g. '2026-08-18T12:00:00Z').",
    )
    
    args = parser.parse_args()

    # Print Deprecation Warning
    print("WARNING: THIS SCRIPT IS DEPRECATED. Use the backend API instead.")

    # 1. Parse and validate time interval
    start_time = _parse_datetime(args.start_time)
    end_time = _parse_datetime(args.end_time)

    if end_time <= start_time:
        print(f"HARD FAIL: end_time ({end_time.isoformat()}) must be strictly after start_time ({start_time.isoformat()}).", file=sys.stderr)
        sys.exit(1)

    # 2. Fetch assets from AssetRepository (Hard fail if repository not populated or asset missing)
    satellites: List[SatelliteInformation] = []
    for sat_name in args.satellites:
        clean_name = sat_name.strip("[]'\",")
        try:
            sat_info = AssetRepository.get_satellite_information(clean_name)
            satellites.append(sat_info)
        except Exception as e:
            print(f"HARD FAIL: Satellite '{clean_name}' not available in AssetRepository: {e}. Ensure repository is initialized first.", file=sys.stderr)
            sys.exit(1)

    groundstations: List[GroundStationInformation] = []
    for gs_name in args.groundstations:
        clean_name = gs_name.strip("[]'\",")
        try:
            gs_info = AssetRepository.get_groundstation_information(clean_name)
            groundstations.append(gs_info)
        except Exception as e:
            print(f"HARD FAIL: Ground station '{clean_name}' not available in AssetRepository: {e}. Ensure repository is initialized first.", file=sys.stderr)
            sys.exit(1)

    run_id = f"prop_{uuid.uuid4().hex[:8]}"
    time_interval = TimeInterval(start_time=start_time, end_time=end_time)
    duration_hours = (end_time - start_time).total_seconds() / 3600.0

    print("=======================================================")
    print(f"  Orbit Engine Overpass Extraction (Run ID: {run_id})")
    print("=======================================================")
    print(f"  - Start Time (UTC): {start_time.isoformat()}")
    print(f"  - End Time (UTC):   {end_time.isoformat()}")
    print(f"  - Total Duration:   {duration_hours:.2f} hours")
    print(f"  - Satellites ({len(satellites)}):   {', '.join(s.name for s in satellites)}")
    print(f"  - Ground Stations ({len(groundstations)}): {', '.join(g.name for g in groundstations)}")
    print("-------------------------------------------------------\n")

    # 3. Progress callback
    def on_progress(p_run_id: str, message: str, progress: int) -> None:
        print(f"[{progress:3d}%] {message}")

    # 4. Run Orekit propagation engine
    try:
        prop_result = orekit_engine.run_orekit_engine(
            run_id=run_id,
            satellite_infos=satellites,
            groundstation_infos=groundstations,
            time_interval=time_interval,
            on_progress_update=on_progress,
        )
    except Exception as e:
        print(f"HARD FAIL: Orekit propagation engine execution failed: {e}", file=sys.stderr)
        sys.exit(1)

    # 5. Save in PropagationResultRepository
    PropagationResultRepository.save_result(prop_result)

    total_track_points = sum(len(t.track) for t in prop_result.global_tracks)
    overpasses = prop_result.overpass_blocks

    print("\n=======================================================")
    print(f"  Propagation Results (Run ID: {run_id})")
    print("=======================================================")
    print(f"Total Satellites Propagated: {len(prop_result.global_tracks)}")
    print(f"Total Global Track Points:   {total_track_points}")
    print(f"Total Overpass Blocks:       {len(overpasses)}")
    print("-------------------------------------------------------")

    if overpasses:
        print("\n[DETECTED OVERPASS BLOCKS]")
        for idx, block in enumerate(overpasses, 1):
            dur_min = block.duration_seconds / 60.0
            st_str = block.start_time.isoformat() if hasattr(block.start_time, "isoformat") else str(block.start_time)
            et_str = block.end_time.isoformat() if hasattr(block.end_time, "isoformat") else str(block.end_time)
            print(
                f"  {idx:02d}. [{block.overpass_id}] {block.satellite_name} <-> {block.groundstation_name} | "
                f"{st_str} -> {et_str} "
                f"({dur_min:.1f} min, Peak {block.max_elevation_deg:.1f}°, {len(block.high_res_trajectory)} profile pts)"
            )
    else:
        print("\n[INFO] No overpass blocks detected within the specified time interval.")

    print(f"\n[SUCCESS] Orbit overpass extraction completed. Saved to PropagationResultRepository (Run ID: {run_id}).")


if __name__ == "__main__":
    main()
