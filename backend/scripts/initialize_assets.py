"""
CLI Script: Initialize Asset Repository from SatOS.

Usage:
    python scripts/initialize_assets.py [--force-refresh] [--show-schedules]

Description:
    Queries SatOS to fetch all registered assets, classifies them into eligible satellites,
    eligible ground stations, or ineligible assets, retrieves baseline activity schedules,
    and populates the in-memory AssetRepository.
"""

import sys
import argparse
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load SatOS credentials from credentials.env
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from app.repositories import AssetRepository


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Initialize AssetRepository by discovering and classifying SatOS assets and schedules."
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Force fresh retrieval from SatOS, clearing existing cached models.",
    )
    parser.add_argument(
        "--show-schedules",
        action="store_true",
        help="Display detailed activity schedule information for each asset.",
    )

    args = parser.parse_args()

    print("=======================================================")
    print("  SatOS Asset Repository Initialization")
    print("=======================================================")
    print(f"Connecting to SatOS (force_refresh={args.force_refresh})...")

    try:
        AssetRepository.initialize_repository(force_refresh=args.force_refresh)
        print("[OK] Successfully queried and initialized assets from SatOS.")
    except Exception as e:
        print(f"HARD FAIL: Could not initialize repository from SatOS: {e}", file=sys.stderr)
        sys.exit(1)

    assets = AssetRepository.get_assets()
    schedules = AssetRepository.get_asset_schedules()

    satellites = [a for a in assets if a.eligible and a.classification == "satellite"]
    groundstations = [a for a in assets if a.eligible and a.classification == "groundstation"]
    ineligible = [a for a in assets if not a.eligible or a.classification == "ineligible"]

    print("\n-------------------------------------------------------")
    print(f"  Summary: {len(assets)} Assets Discovered")
    print("-------------------------------------------------------")
    print(f"  - Eligible Satellites:      {len(satellites)}")
    print(f"  - Eligible Ground Stations: {len(groundstations)}")
    print(f"  - Ineligible Assets:        {len(ineligible)}")
    print(f"  - Baseline Asset Schedules: {len(schedules)}")
    print("-------------------------------------------------------")

    # 1. Eligible Satellites Table
    print("\n[ELIGIBLE SATELLITES]")
    if satellites:
        for idx, sat in enumerate(satellites, 1):
            details = sat.details
            if details:
                pos_str = f"[{details.position_r[0]/1000.0:,.1f}, {details.position_r[1]/1000.0:,.1f}, {details.position_r[2]/1000.0:,.1f}] km"
                vel_str = f"[{details.velocity_v[0]:,.1f}, {details.velocity_v[1]:,.1f}, {details.velocity_v[2]:,.1f}] m/s"
                epoch_str = details.state_timestamp.isoformat() if hasattr(details.state_timestamp, "isoformat") else str(details.state_timestamp)
                print(f"  {idx:02d}. {sat.name}")
                print(f"      Epoch:    {epoch_str}")
                print(f"      Position: {pos_str}")
                print(f"      Velocity: {vel_str}")
            else:
                print(f"  {idx:02d}. {sat.name} (No details)")
    else:
        print("  None")

    # 2. Eligible Ground Stations Table
    print("\n[ELIGIBLE GROUND STATIONS]")
    if groundstations:
        for idx, gs in enumerate(groundstations, 1):
            details = gs.details
            if details:
                print(f"  {idx:02d}. {gs.name} -> Lat: {details.latitude:.4f}°, Lon: {details.longitude:.4f}°, Min Elev: {details.min_link_elevation:.1f}°")
            else:
                print(f"  {idx:02d}. {gs.name} (No details)")
    else:
        print("  None")

    # 3. Ineligible Assets Table
    if ineligible:
        print("\n[INELIGIBLE / INVALID ASSETS]")
        for idx, inelig in enumerate(ineligible, 1):
            print(f"  {idx:02d}. {inelig.name} [{inelig.classification}]")
            print(f"      Reason: {inelig.error or 'Unspecified error'}")

    # 4. Schedule Information
    print("\n[ASSET SCHEDULES & ACTIVITIES]")
    total_activities = sum(len(s.activities) for s in schedules)
    print(f"Total Baseline Activities Across All Assets: {total_activities}")
    for s in schedules:
        print(f"  - {s.name}: {len(s.activities)} activity/activities")
        if args.show_schedules:
            for act in s.activities:
                act_name = act.name or getattr(act, "uuid", "Activity")
                print(f"      • [{act.status}] {act_name} | {act.start_event} -> {act.end_event}")

    print("\n[SUCCESS] Asset repository initialization completed.")


if __name__ == "__main__":
    main()
