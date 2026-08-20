"""
CLI Script: Inspect PropagationResultRepository Databank.

Usage:
    python scripts/inspect_propagation.py
    python scripts/inspect_propagation.py --get <RUN_ID>

Description:
    Displays a top-level list of all stored propagation runs in PropagationResultRepository,
    or zooms into detailed metadata, trajectories, and overpass blocks for a specific run.
"""

import sys
import argparse
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.repositories import PropagationResultRepository


def list_propagation_runs() -> None:
    """Prints a top-level overview table of all runs in PropagationResultRepository."""
    results = PropagationResultRepository.list_results()

    if not results:
        print("[INFO] PropagationResultRepository is empty. Run 'python scripts/extract_overpasses.py' to populate it.")
        return

    print("=======================================================================================")
    print(f"  PropagationResultRepository Databank (Total Runs: {len(results)})")
    print("=======================================================================================")
    print(f"{'Run ID':<20} {'Start Time (UTC)':<24} {'End Time (UTC)':<24} {'Sats':<6} {'Passes':<8}")
    print("-" * 87)

    for res in results:
        meta = res.metadata
        st_str = meta.start_time.isoformat() if hasattr(meta.start_time, "isoformat") else str(meta.start_time)
        et_str = meta.end_time.isoformat() if hasattr(meta.end_time, "isoformat") else str(meta.end_time)
        sat_count = len(res.global_tracks)
        pass_count = len(res.overpass_blocks)
        print(f"{meta.run_id:<20} {st_str:<24} {et_str:<24} {sat_count:<6} {pass_count:<8}")

    print("-" * 87)
    print("Use '--get <RUN_ID>' to view detailed metadata and detected overpass blocks.")


def show_propagation_detail(run_id: str) -> None:
    """Prints detailed metadata, satellites, and overpass blocks for a specific run."""
    result = PropagationResultRepository.get_result(run_id)

    if not result:
        print(f"HARD FAIL: Propagation run ID '{run_id}' not found in PropagationResultRepository.", file=sys.stderr)
        sys.exit(1)

    meta = result.metadata
    st_str = meta.start_time.isoformat() if hasattr(meta.start_time, "isoformat") else str(meta.start_time)
    et_str = meta.end_time.isoformat() if hasattr(meta.end_time, "isoformat") else str(meta.end_time)
    duration_hours = (meta.end_time - meta.start_time).total_seconds() / 3600.0

    print("=======================================================================")
    print(f"  Propagation Run Detail: {meta.run_id}")
    print("=======================================================================")
    print(f"Start Time (UTC):     {st_str}")
    print(f"End Time (UTC):       {et_str}")
    print(f"Total Duration:       {duration_hours:.2f} hours")
    print(f"Global Track Step:    {meta.global_track_step_seconds} s")
    print(f"Overpass Profile Step:{meta.overpass_profile_step_seconds} s")

    print(f"\nPropagated Satellites ({len(result.global_tracks)}):")
    for traj in result.global_tracks:
        print(f"  - {traj.satellite_name}: {len(traj.track)} track points")

    print(f"\nDetected Overpass Blocks ({len(result.overpass_blocks)}):")
    if result.overpass_blocks:
        for idx, block in enumerate(result.overpass_blocks, 1):
            dur_min = block.duration_seconds / 60.0
            bst_str = block.start_time.isoformat() if hasattr(block.start_time, "isoformat") else str(block.start_time)
            bet_str = block.end_time.isoformat() if hasattr(block.end_time, "isoformat") else str(block.end_time)
            print(f"  {idx:02d}. [{block.overpass_id}] {block.satellite_name} <-> {block.groundstation_name}")
            print(f"      Time:      {bst_str} -> {bet_str} ({dur_min:.1f} min)")
            print(f"      Peak Elev: {block.max_elevation_deg:.1f}° | Trajectory: {len(block.high_res_trajectory)} profile points")
    else:
        print("  (No overpasses detected in this run)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect PropagationResultRepository databank entries and detailed run results."
    )
    parser.add_argument(
        "--get", "-g", "--run-id",
        type=str,
        default=None,
        help="Propagation Run ID to inspect in detail.",
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List all top-level propagation runs (default behavior if no arguments provided).",
    )

    args = parser.parse_args()

    if args.get:
        show_propagation_detail(args.get.strip("[]'\", "))
    else:
        list_propagation_runs()


if __name__ == "__main__":
    main()
