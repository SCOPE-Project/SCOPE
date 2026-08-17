"""
CLI Script: Push Activities to SatOS.

Usage:
    python scripts/push_activities.py [--input-file <PATH_TO_JSON>] [--dry-run]

Note:
    Ingests activity object data from a JSON file (or default config) and pushes them to SatOS.
    Generates start and end ScheduleEvent objects and UUIDs internally.
"""

import sys
import os
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.models.satos import ActivityDTO
from app.services.asset_repository import AssetRepository

DEFAULT_CONFIG_PATH = backend_dir / "config" / "default_activities.json"


def load_activities_from_json(json_path: Path) -> list[ActivityDTO]:
    """Load ActivityDTO objects from a JSON file."""
    if not json_path.exists():
        print(f"HARD FAIL: Input file '{json_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"HARD FAIL: Error reading JSON file '{json_path}': {e}", file=sys.stderr)
        sys.exit(1)

    activities_raw = data if isinstance(data, list) else data.get("activities", [])
    if not activities_raw:
        print(f"HARD FAIL: No activities found in JSON file '{json_path}'.", file=sys.stderr)
        sys.exit(1)

    dtos: list[ActivityDTO] = []
    for idx, item in enumerate(activities_raw):
        try:
            if not isinstance(item, dict):
                raise ValueError("Activity item must be a JSON object.")
            if "schedule_name" not in item:
                raise ValueError("Missing required field 'schedule_name'.")
            if "start_time" not in item:
                raise ValueError("Missing required field 'start_time'.")
            if "end_time" not in item:
                raise ValueError("Missing required field 'end_time'.")

            start_time = datetime.fromisoformat(item["start_time"])
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=timezone.utc)

            end_time = datetime.fromisoformat(item["end_time"])
            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=timezone.utc)

            dto = ActivityDTO(
                schedule_name=item["schedule_name"],
                start_time=start_time,
                end_time=end_time,
                name=item.get("name", ""),
                description=item.get("description", ""),
                priority=int(item.get("priority", 0)),
                status=int(item.get("status", 2)),
                initiator=item.get("initiator"),
                executor=item.get("executor"),
            )
            dtos.append(dto)
        except Exception as e:
            print(f"HARD FAIL: Error parsing activity at index {idx}: {e}", file=sys.stderr)
            sys.exit(1)

    return dtos


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Push generic activities to SatOS (Ingests JSON file containing activity objects)."
    )
    parser.add_argument(
        "--input-file", "-f",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help=f"Path to JSON file containing activity records (defaults to {DEFAULT_CONFIG_PATH})."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate events and activities without pushing to SatOS."
    )

    args = parser.parse_args()

    activity_dtos = load_activities_from_json(args.input_file)
    print(f"Found {len(activity_dtos)} activity record(s) to process.")

    activities = AssetRepository.create_activities_from_dtos(activity_dtos)
    print(f"Generated {len(activities)} Activity record(s):")

    for act in activities:
        print(f"  - [{act.schedule_name}] {act.name} (UUID: {act.uuid})")
        print(f"      Priority: {act.priority} | Status: {act.status}")
        print(f"      Initiator: {act.initiator} | Executor: {act.executor}")
        print(f"      Start Event: {act.start_event.name} @ {act.start_event.timestamp.isoformat()} (UUID: {act.start_event.uuid})")
        print(f"      End Event:   {act.end_event.name} @ {act.end_event.timestamp.isoformat()} (UUID: {act.end_event.uuid})")

    if args.dry_run:
        print("\n[DRY RUN] Completed. No requests sent to SatOS API.")
        return

    print("\nPushing activities and events to SatOS...")
    try:
        pushed = AssetRepository.push_activities_to_satos(activities)
        print(f"Successfully pushed {len(pushed)} activities to SatOS!")
    except Exception as e:
        print(f"HARD FAIL: Failed to push activities to SatOS: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
