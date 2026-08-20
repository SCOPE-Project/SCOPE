"""
CLI Script: Inspect AssetRepository Databank.

Usage:
    python scripts/inspect_assets.py
    python scripts/inspect_assets.py --get <ASSET_NAME>

Description:
    Displays a top-level list of all discovered assets in AssetRepository,
    or zooms into detailed parameters and activity schedules for a specific asset.
"""

import sys
import argparse
import math
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.repositories import AssetRepository
from core.models.assets import SatelliteInformation, GroundStationInformation


def list_assets() -> None:
    """Prints a top-level overview table of all assets in AssetRepository."""
    assets = AssetRepository.get_assets()
    schedules_by_name = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

    if not assets:
        print("[INFO] AssetRepository is empty. Run 'python scripts/initialize_assets.py' to populate it.")
        return

    print("=======================================================================")
    print(f"  AssetRepository Databank (Total Assets: {len(assets)})")
    print("=======================================================================")
    print(f"{'Name':<22} {'Classification':<16} {'Eligible':<10} {'Activities':<12}")
    print("-" * 71)

    for asset in assets:
        elig_str = "YES" if asset.eligible else "NO"
        act_count = len(schedules_by_name.get(asset.name, []))
        print(f"{asset.name:<22} {asset.classification:<16} {elig_str:<10} {act_count:<12}")

    print("-" * 71)
    print("Use '--get <ASSET_NAME>' to view detailed parameters and baseline activities.")


def show_asset_detail(asset_name: str) -> None:
    """Prints detailed parameters and activity schedules for a specific asset."""
    assets = AssetRepository.get_assets()
    asset = next((a for a in assets if a.name == asset_name), None)

    if not asset:
        print(f"HARD FAIL: Asset '{asset_name}' not found in AssetRepository.", file=sys.stderr)
        sys.exit(1)

    schedules_by_name = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    activities = schedules_by_name.get(asset_name, [])

    status_tag = "ELIGIBLE" if asset.eligible else "NOT ELIGIBLE"
    print("=======================================================================")
    print(f"  Asset Detail: {asset.name} [{asset.classification.upper()} - {status_tag}]")
    print("=======================================================================")

    if asset.classification == "satellite" and isinstance(asset.details, SatelliteInformation):
        det = asset.details
        r = det.position_r
        v = det.velocity_v
        epoch_str = det.state_timestamp.isoformat() if hasattr(det.state_timestamp, "isoformat") else str(det.state_timestamp)

        print(f"State Epoch (UTC): {epoch_str}")
        print(f"Position (km):     [{r[0]/1000.0:,.1f}, {r[1]/1000.0:,.1f}, {r[2]/1000.0:,.1f}]")
        print(f"Velocity (m/s):    [{v[0]:,.1f}, {v[1]:,.1f}, {v[2]:,.1f}]")

    elif asset.classification == "groundstation" and isinstance(asset.details, GroundStationInformation):
        det = asset.details
        print(f"Latitude:          {det.latitude:.4f}°")
        print(f"Longitude:         {det.longitude:.4f}°")
        print(f"Min Elevation:     {det.min_link_elevation:.1f}°")

    if not asset.eligible:
        print(f"\nIneligibility Reason:\n  {asset.error or 'Unspecified error'}")

    print(f"\nBaseline Activities ({len(activities)}):")
    if activities:
        for idx, act in enumerate(activities, 1):
            act_name = act.name or getattr(act, "uuid", "Activity")
            print(f"  {idx:02d}. [{act.status}] {act_name} | {act.start_event} -> {act.end_event} (UUID: {act.uuid})")
    else:
        print("  (No baseline activities recorded)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect AssetRepository databank entries and detailed asset properties."
    )
    parser.add_argument(
        "--get", "-g", "--name",
        type=str,
        default=None,
        help="Asset name to inspect in detail.",
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List all top-level asset entries (default behavior if no arguments provided).",
    )

    args = parser.parse_args()

    if args.get:
        show_asset_detail(args.get.strip("[]'\", "))
    else:
        list_assets()


if __name__ == "__main__":
    main()
