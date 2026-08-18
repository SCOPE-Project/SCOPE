"""
CLI Script: Push Scheduled Links to SatOS.

Usage:
    python scripts/push_scheduled_links.py --input-file <PATH_TO_JSON> [--dry-run]

Note:
    Ingests scheduled link object data from a JSON file and pushes them to SatOS.
    Does not reference raw propagation repository runs.
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

from dotenv import load_dotenv
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load SatOS credentials from credentials.env
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from core.models.domain import LinkBlock, OverpassProfilePoint
from app.services.asset_repository import AssetRepository


def load_links_from_json(json_path: Path) -> list[LinkBlock]:
    """Load LinkBlock objects from a JSON file."""
    if not json_path.exists():
        print(f"HARD FAIL: Input file '{json_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"HARD FAIL: Error reading JSON file '{json_path}': {e}", file=sys.stderr)
        sys.exit(1)

    links_raw = data if isinstance(data, list) else data.get("scheduled_links", data.get("links", []))
    if not links_raw:
        print(f"HARD FAIL: No scheduled links found in JSON file '{json_path}'.", file=sys.stderr)
        sys.exit(1)

    links: list[LinkBlock] = []
    for idx, item in enumerate(links_raw):
        try:
            start_time = datetime.fromisoformat(item["start_time"])
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=timezone.utc)

            end_time = datetime.fromisoformat(item["end_time"])
            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=timezone.utc)

            high_res = []
            for pt in item.get("high_res_trajectory", []):
                pt_time = datetime.fromisoformat(pt["timestamp"]) if isinstance(pt["timestamp"], str) else pt["timestamp"]
                high_res.append(
                    OverpassProfilePoint(
                        timestamp=pt_time,
                        latitude_deg=pt["latitude_deg"],
                        longitude_deg=pt["longitude_deg"],
                        altitude_m=pt["altitude_m"],
                        elevation_deg=pt["elevation_deg"],
                        azimuth_deg=pt["azimuth_deg"],
                        range_m=pt["range_m"],
                    )
                )

            links.append(
                LinkBlock(
                    link_id=item.get("link_id", f"link_{idx}"),
                    satellite_name=item["satellite_name"],
                    groundstation_name=item["groundstation_name"],
                    start_time=start_time,
                    end_time=end_time,
                    duration_seconds=float(item.get("duration_seconds", (end_time - start_time).total_seconds())),
                    max_elevation_deg=float(item.get("max_elevation_deg", 0.0)),
                    high_res_trajectory=high_res,
                )
            )
        except Exception as e:
            print(f"HARD FAIL: Error parsing scheduled link at index {idx}: {e}", file=sys.stderr)
            sys.exit(1)

    return links


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Push ScheduledLinks to SatOS (Ingests JSON file containing scheduled link objects)."
    )
    parser.add_argument(
        "--input-file", "-f",
        type=Path,
        required=True,
        help="Path to JSON file containing ScheduledLink records."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate events and activities without pushing to SatOS."
    )

    args = parser.parse_args()

    scheduled_links = load_links_from_json(args.input_file)
    print(f"Found {len(scheduled_links)} scheduled link(s) to process.")

    activities = AssetRepository.create_activities_from_link_blocks(scheduled_links)
    print(f"Generated {len(activities)} Activity record(s) (2 per link):")

    for act in activities:
        print(f"  - [{act.schedule_name}] {act.name} (UUID: {act.uuid})")
        print(f"      Start Event: {act.start_event.name} @ {act.start_event.timestamp.isoformat()} (UUID: {act.start_event.uuid})")
        print(f"      End Event:   {act.end_event.name} @ {act.end_event.timestamp.isoformat()} (UUID: {act.end_event.uuid})")

    if args.dry_run:
        print("\n[DRY RUN] Completed. No requests sent to SatOS API.")
        return

    print("\nPushing activities and events to SatOS...")
    try:
        pushed = AssetRepository.push_scheduled_links_to_satos(scheduled_links)
        print(f"Successfully pushed {len(pushed)} activities to SatOS!")
    except Exception as e:
        print(f"HARD FAIL: Failed to push activities to SatOS: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
