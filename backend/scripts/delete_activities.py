"""
CLI Script: Delete Activities from SatOS.

Usage:
    python scripts/delete_activities.py [--uuids <UUID1> <UUID2> ...] [--schedule-names <SCHED1> <SCHED2> ...] [--dry-run]

Description:
    Deletes specified activities by UUID or clears entire schedules in SatOS.
"""

import sys
import uuid
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

from app.repositories import AssetRepository
from app.services.satos_connector import (
    satos_get_activities_list,
    satos_get_schedule_events,
    satos_get_schedules_list,
)


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
        "--clear-all",
        action="store_true",
        help="Clear all schedules that have 'Group1' substring in their schedule names.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Query and display activities and events to delete without sending delete requests to SatOS API.",
    )

    args = parser.parse_args()

    raw_uuids = [_clean_item(u) for u in args.uuids if u]
    uuids = [uuid.UUID(u) for u in raw_uuids]
    schedule_names = [_clean_item(s) for s in args.schedule_names if s]

    if not uuids and not schedule_names and not args.clear_all:
        print("HARD FAIL: You must provide at least one --uuids, --schedule-names, or --clear-all argument.", file=sys.stderr)
        sys.exit(1)

    # If --clear-all is requested, find all schedules with 'Group1' in their name
    if args.clear_all:
        try:
            all_schedules = satos_get_schedules_list()
            group1_schedules = [s.name for s in all_schedules if "Group1" in s.name]
            for s in group1_schedules:
                if s not in schedule_names:
                    schedule_names.append(s)
            print(f"Discovered {len(group1_schedules)} schedule(s) matching 'Group1': {', '.join(group1_schedules)}")
        except Exception as e:
            print(f"HARD FAIL: Failed to query schedules from SatOS: {e}", file=sys.stderr)
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
        total_acts_deleted = 0
        total_evs_deleted = 0
        all_failed_events = []

        if schedule_names:
            cleared_summary = AssetRepository.clear_schedules_in_satos(schedule_names)
            for sched in schedule_names:
                act_list = cleared_summary.deleted_activities.get(sched, [])
                ev_list = cleared_summary.deleted_events.get(sched, [])
                failed_list = cleared_summary.failed_events.get(sched, [])

                print(f"Cleared schedule '{sched}': {len(act_list)} activit(ies) deleted, {len(ev_list)} event(s) deleted.")
                total_acts_deleted += len(act_list)
                total_evs_deleted += len(ev_list)

                if failed_list:
                    all_failed_events.extend(failed_list)
                    for f in failed_list:
                        print(f"  [WARNING] Failed to delete event [{f['uuid']}] '{f['name']}' (id: '{f['id']}'): {f['reason']}")

        if uuids:
            act_summary = AssetRepository.delete_activities_from_satos(uuids)
            print(f"Deleted {len(act_summary.deleted_activities)} individually requested activit(ies) and {len(act_summary.deleted_events)} anchored event(s).")
            total_acts_deleted += len(act_summary.deleted_activities)
            total_evs_deleted += len(act_summary.deleted_events)
            if act_summary.failed_events:
                all_failed_events.extend(act_summary.failed_events)
                for f in act_summary.failed_events:
                    print(f"  [WARNING] Failed to delete anchored event [{f['uuid']}]: {f['reason']}")


        print(f"\nSuccessfully deleted total {total_acts_deleted} activit(ies) and {total_evs_deleted} event(s) from SatOS.")
        if all_failed_events:
            print(f"\n[WARNING] Total {len(all_failed_events)} event(s) failed to delete. Review warnings above for details.", file=sys.stderr)
    except Exception as e:
        print(f"HARD FAIL: Failed to delete activities: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

