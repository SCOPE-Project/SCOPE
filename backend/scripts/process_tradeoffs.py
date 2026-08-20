"""
CLI Script: Process Trade-Off Groups & Schedule Multi-Pass Downlinks.

Usage:
    python scripts/process_tradeoffs.py --input-file <PATH_TO_LINKS_JSON> [--strategy <NAME>] [--urgency-alpha <FLOAT>] [--initial-buffers <KEY=VAL,...>] [--output-file <PATH_TO_OUTPUT_JSON>] [--commit-to-satos]
    python scripts/process_tradeoffs.py --filter-run-id <FILTER_RUN_ID> [--strategy <NAME>] [--commit-to-satos]

Note:
    Ingests filtered LinkBlock candidates, constructs mutual exclusion trade-off groups, runs the
    multi-pass data buffer forward simulation, and optionally commits confirmed links to SatOS.
"""

import sys
import os
import json
import argparse
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load SatOS credentials
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from core.models.scheduling import (
    LinkBlock,
    LinkEligibilityStatus,
    SchedulingSession,
)
from core.models.propagation import OverpassProfilePoint
from app.repositories import LinkRepository, AssetRepository
from core.scheduling.session_manager import SchedulingSessionManager
from core.scheduling.strategy import get_scoring_rule
from app.models.scheduling import SessionPlanDTO


def load_links_from_json(json_path: Path) -> list[LinkBlock]:
    """Loads a list of LinkBlock objects from a JSON file."""
    if not json_path.exists():
        print(f"HARD FAIL: Input file '{json_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"HARD FAIL: Error reading JSON file '{json_path}': {e}", file=sys.stderr)
        sys.exit(1)

    items = data if isinstance(data, list) else data.get("links", data.get("candidate_links", []))
    links: list[LinkBlock] = []

    for idx, item in enumerate(items):
        start_time = datetime.fromisoformat(item["start_time"])
        end_time = datetime.fromisoformat(item["end_time"])
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)

        pts = []
        for p in item.get("high_res_trajectory", []):
            pt_time = datetime.fromisoformat(p["timestamp"]) if isinstance(p["timestamp"], str) else p["timestamp"]
            if pt_time.tzinfo is None:
                pt_time = pt_time.replace(tzinfo=timezone.utc)
            pts.append(
                OverpassProfilePoint(
                    timestamp=pt_time,
                    latitude_deg=float(p.get("latitude_deg", 0.0)),
                    longitude_deg=float(p.get("longitude_deg", 0.0)),
                    altitude_m=float(p.get("altitude_m", 0.0)),
                    elevation_deg=float(p.get("elevation_deg", 0.0)),
                    azimuth_deg=float(p.get("azimuth_deg", 0.0)),
                    range_m=float(p.get("range_m", 0.0)),
                )
            )

        elig_str = item.get("eligibility_status", "eligible")
        try:
            elig_status = LinkEligibilityStatus(elig_str)
        except Exception:
            elig_status = LinkEligibilityStatus.ELIGIBLE if item.get("is_eligible", True) else LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION

        links.append(
            LinkBlock(
                link_id=item.get("link_id", f"link_{idx}"),
                satellite_name=item["satellite_name"],
                groundstation_name=item["groundstation_name"],
                start_time=start_time,
                end_time=end_time,
                duration_seconds=float(item.get("duration_seconds", (end_time - start_time).total_seconds())),
                max_elevation_deg=float(item.get("max_elevation_deg", 0.0)),
                overpass_id=item.get("overpass_id", ""),
                estimated_data_capacity_mb=float(item.get("estimated_data_capacity_mb", 0.0)),
                high_res_trajectory=pts,
                is_eligible=item.get("is_eligible", True),
                eligibility_status=elig_status,
                ineligibility_reason=item.get("ineligibility_reason"),
                conflicting_activity_uuid=item.get("conflicting_activity_uuid"),
            )
        )

    return links


def parse_initial_buffers(buf_arg: str | None) -> dict[str, float]:
    """Parses buffer definitions like 'Sat-1=100.0,Sat-2=500.0' or JSON string."""
    if not buf_arg:
        return {}
    if buf_arg.startswith("{"):
        return json.loads(buf_arg)
    res = {}
    for pair in buf_arg.split(","):
        if "=" in pair:
            k, v = pair.split("=", 1)
            res[k.strip()] = float(v.strip())
    return res


def export_session_to_json(session: SchedulingSession, output_path: Path) -> None:
    """Exports the complete SchedulingSession plan and profiles to a JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dto = SessionPlanDTO.from_domain(session)
    output_path.write_text(json.dumps(dto.model_dump(mode="json"), indent=2, default=str), encoding="utf-8")
    print(f"Exported session plan to '{output_path}'.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build conflict graph, evaluate trade-offs, and simulate satellite data buffer schedule."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--input-file",
        type=str,
        help="Path to JSON file containing filtered LinkBlock candidates.",
    )
    group.add_argument(
        "--filter-run-id",
        type=str,
        help="Filter run ID of LinkBlocks already cached in LinkRepository.",
    )

    parser.add_argument(
        "--strategy",
        type=str,
        default="buffer_overflow_avoidance",
        choices=["buffer_overflow_avoidance", "max_downlink_throughput", "max_pass_duration"],
        help="Objective scoring strategy rule (default: buffer_overflow_avoidance).",
    )
    parser.add_argument(
        "--urgency-alpha",
        type=float,
        default=2.0,
        help="Urgency sensitivity multiplier exponent for buffer urgency scoring (default: 2.0).",
    )
    parser.add_argument(
        "--initial-buffers",
        type=str,
        default=None,
        help="Initial satellite storage levels in MB (e.g. 'Sat-1=100,Sat-2=450').",
    )
    parser.add_argument(
        "--output-file",
        type=str,
        default=None,
        help="Optional path to export full schedule plan and telemetry curves to JSON.",
    )
    parser.add_argument(
        "--commit-to-satos",
        action="store_true",
        help="Push the final scheduled links to SatOS as active schedule events.",
    )
    parser.add_argument(
        "--no-satos",
        action="store_true",
        help="Skip querying SatOS server for live schedules (use local/empty cache).",
    )

    args = parser.parse_args()

    # Initialize SatOS schedules if enabled
    if not args.no_satos:
        try:
            print("Connecting to SatOS to fetch baseline activities...")
            AssetRepository.initialize_repository()
            print("Successfully loaded baseline schedules from SatOS.")
        except Exception as e:
            print(f"[WARNING] Could not fetch schedules from SatOS: {e}. Proceeding with local cache.")

    # Ingest LinkBlocks
    if args.input_file:
        json_path = Path(args.input_file)
        links = load_links_from_json(json_path)
        filter_run_id = f"cli_{uuid.uuid4().hex[:8]}"
        LinkRepository.save_links(filter_run_id, links)
        print(f"Loaded {len(links)} candidate links from '{json_path}' (Filter Run ID: {filter_run_id}).")
    else:
        filter_run_id = args.filter_run_id
        links = LinkRepository.get_links(filter_run_id)
        if not links:
            print(f"HARD FAIL: Filter run ID '{filter_run_id}' not found in LinkRepository.", file=sys.stderr)
            sys.exit(1)

    initial_buffers = parse_initial_buffers(args.initial_buffers)
    print(f"\nExecuting forward simulation with strategy='{args.strategy}' (alpha={args.urgency_alpha})...")

    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    session = SchedulingSessionManager.create_session(
        filter_run_id=filter_run_id,
        candidate_links=links,
        asset_schedules=asset_schedules,
        initial_buffer_levels_mb=initial_buffers,
        scoring_strategy=args.strategy,
        urgency_alpha=args.urgency_alpha,
    )

    # Display Results
    scheduled_links = [status for status in session.current_plan.values() if status.is_scheduled]
    unscheduled_links = [status for status in session.current_plan.values() if not status.is_scheduled]

    print(f"\n=======================================================")
    print(f"  Scheduling Plan (Session ID: {session.session_id})")
    print(f"=======================================================")
    print(f"Total Trade-Off Groups: {len(session.conflict_structure.trade_off_groups)}")
    print(f"Total Candidate Passes: {len(session.current_plan)}")
    print(f"  - Scheduled:   {len(scheduled_links)}")
    print(f"  - Unscheduled: {len(unscheduled_links)}")
    print("-------------------------------------------------------")

    print("\n[SCHEDULED LINKS]")
    for s in sorted(scheduled_links, key=lambda x: x.link.start_time):
        l = s.link
        print(f"  * {l.satellite_name} <-> {l.groundstation_name} | {l.start_time.isoformat()} -> {l.end_time.isoformat()} | Offloaded: {s.useful_data_offloaded_mb:.1f} MB (Group: {s.tradeoff_id})")

    if unscheduled_links:
        print("\n[UNSCHEDULED / REJECTED PASSES]")
        for u in sorted(unscheduled_links, key=lambda x: x.link.start_time):
            l = u.link
            print(f"  x {l.satellite_name} <-> {l.groundstation_name} | {l.start_time.isoformat()} -> {l.end_time.isoformat()} | Reason: {u.rejection_reason}")

    print("\n=======================================================")
    print(f"  Satellite Data Buffer Telemetry")
    print(f"=======================================================")
    for sat, prof in session.satellite_buffer_profiles.items():
        print(f"Satellite: {sat}")
        print(f"  Capacity:    {prof.capacity_mb:.1f} MB")
        print(f"  Generated:   {prof.total_generated_mb:.1f} MB")
        print(f"  Downlinked:  {prof.total_downlinked_mb:.1f} MB")
        print(f"  Final Level: {prof.final_level_mb:.1f} MB (Peak: {prof.peak_level_mb:.1f} MB)")
        if prof.total_lost_mb > 0:
            print(f"  [ALERT] Overflow Data Lost: {prof.total_lost_mb:.1f} MB ({len(prof.overflow_events)} event(s))")

    if args.output_file:
        export_session_to_json(session, Path(args.output_file))

    if args.commit_to_satos:
        print("\nCommitting scheduled links to SatOS...")
        scheduled_domain_links = [s.link for s in scheduled_links]
        if not scheduled_domain_links:
            print("[INFO] No scheduled links to commit.")
        else:
            activities = AssetRepository.push_scheduled_links_to_satos(scheduled_domain_links)
            print(f"[SUCCESS] Pushed {len(activities)} activity record(s) to SatOS.")

    print("\n[SUCCESS] Trade-off processing completed.")


if __name__ == "__main__":
    main()
