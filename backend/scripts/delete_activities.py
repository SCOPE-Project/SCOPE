"""
CLI Script: Delete Activities from SatOS.

Usage:
    python scripts/delete_activities.py [--uuids <UUID1> <UUID2> ...] [--schedule-names <SCHED1> <SCHED2> ...] [--dry-run]

Description:
    Deletes specified activities by UUID or clears entire schedules in SatOS.
"""

import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load SatOS credentials from credentials.env
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from app.services.asset_repository import AssetRepository
from app.services.satos_connector import satos_get_activities_list, satos_get_schedule_events


def _clean_item(item: str) -> str:
    """Strip common CLI brackets/quotes if passed inadvertently (e.g. [Sat1_Group1] -> Sat1_Group1)."""
    return item.strip("[]'\"")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete activities or clear schedules in SatOS."
    )
    parser.add_argument(
        "--uuids", "-u",
        nargs="+",
        default=[],
        help="List of activity UUIDs to delete.",
    )
    parser.add_argument(
        "--schedule-names", "-s",
        nargs="+",
        default=[],
        help="List of schedule names to clear (deletes all activities and events in these schedules).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Query and display activities and events to delete without sending delete requests to SatOS API.",
    )

    args = parser.parse_args()

    uuids = [_clean_item(u) for u in args.uuids if u]
    schedule_names = [_clean_item(s) for s in args.schedule_names if s]

    if not uuids and not schedule_names:
        print("HARD FAIL: You must provide at least one --uuids or --schedule-names argument.", file=sys.stderr)
        sys.exit(1)

    print("=== SatOS Activity & Event Deletion ===")
    if uuids:
        print(f"Target UUIDs ({len(uuids)}):")
        for u in uuids:
            print(f"  - {u}")

    if schedule_names:
        print(f"Target Schedules to Clear ({len(schedule_names)}):")
        for s in schedule_names:
            print(f"  - {s}")

    if args.dry_run:
        print("\n[DRY RUN] Simulating deletion...")
        if schedule_names:
            for s in schedule_names:
                try:
                    acts = satos_get_activities_list(s)
                    evs = satos_get_schedule_events(s)
                    print(f"  - Schedule '{s}': Found {len(acts)} activit(ies) and {len(evs)} schedule event(s) that would be deleted.")
                    for a in acts:
                        print(f"      * Activity [{a.uuid}] {getattr(a, 'name', '')}")
                    for e in evs:
                        print(f"      * Event [{e.uuid}] {getattr(e, 'name', getattr(e, 'id', ''))}")
                except Exception as e:
                    print(f"  - Schedule '{s}': Failed to query schedule contents: {e}")
        if uuids:
            print(f"  - Would delete {len(uuids)} individually specified UUID(s) and their anchored schedule events.")
        print("\n[DRY RUN] Completed. No deletions executed.")
        return

    print("\nExecuting deletions in SatOS...")
    try:
        deleted_count = 0
        if schedule_names:
            cleared = AssetRepository.clear_schedules_in_satos(schedule_names)
            for sched, u_list in cleared.items():
                print(f"Cleared schedule '{sched}': {len(u_list)} activit(ies) deleted.")
                deleted_count += len(u_list)

        if uuids:
            deleted_uuids = AssetRepository.delete_activities_from_satos(uuids)
            print(f"Deleted {len(deleted_uuids)} individually requested activit(ies).")
            deleted_count += len(deleted_uuids)

        print(f"\nSuccessfully deleted total {deleted_count} activit(ies) from SatOS.")
    except Exception as e:
        print(f"HARD FAIL: Failed to delete activities: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
