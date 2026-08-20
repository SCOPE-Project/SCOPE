"""
CLI Script: Filter Potential Communication Links.

Usage:
    python scripts/filter_links.py --input-file <PATH_TO_PROPAGATION_JSON> [--min-aos-los-elevation <DEG>] [--min-peak-elevation <DEG>] [--output-file <PATH_TO_OUTPUT_JSON>] [--no-satos]
    python scripts/filter_links.py --run-id <ORBIT_ENGINE_RUN_ID> [--min-aos-los-elevation <DEG>] [--min-peak-elevation <DEG>] [--output-file <PATH_TO_OUTPUT_JSON>]

Note:
    Derives candidate LinkBlock objects from raw OverpassBlocks, applies elevation trimming/filters,
    detects collisions against immutable SatOS baseline activities, and optionally exports the results to JSON.
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

from core.models.propagation import (
    PropagationMetadata,
    PropagationResult,
    OverpassBlock,
    OverpassProfilePoint,
)
from core.models.scheduling import (
    LinkBlock,
    LinkEligibilityStatus,
)
from app.repositories import PropagationResultRepository, LinkRepository, AssetRepository
from core.scheduling.filter_pipeline import derive_and_filter_links
from app.models.scheduling import LinkBlockDTO


def load_propagation_from_json(json_path: Path) -> PropagationResult:
    """Loads a PropagationResult object from a JSON file."""
    if not json_path.exists():
        print(f"HARD FAIL: Input file '{json_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"HARD FAIL: Error reading JSON file '{json_path}': {e}", file=sys.stderr)
        sys.exit(1)

    # Parse metadata
    meta_dict = data.get("metadata", {})
    start_t = datetime.fromisoformat(meta_dict["start_time"]) if "start_time" in meta_dict else datetime.now(timezone.utc)
    end_t = datetime.fromisoformat(meta_dict["end_time"]) if "end_time" in meta_dict else datetime.now(timezone.utc)
    if start_t.tzinfo is None:
        start_t = start_t.replace(tzinfo=timezone.utc)
    if end_t.tzinfo is None:
        end_t = end_t.replace(tzinfo=timezone.utc)

    metadata = PropagationMetadata(
        run_id=meta_dict.get("run_id", str(uuid.uuid4())),
        start_time=start_t,
        end_time=end_t,
        global_track_step_seconds=float(meta_dict.get("global_track_step_seconds", 30.0)),
        overpass_profile_step_seconds=float(meta_dict.get("overpass_profile_step_seconds", 10.0)),
    )

    # Parse overpass blocks
    overpass_blocks: list[OverpassBlock] = []
    for idx, item in enumerate(data.get("overpass_blocks", [])):
        op_start = datetime.fromisoformat(item["start_time"])
        op_end = datetime.fromisoformat(item["end_time"])
        if op_start.tzinfo is None:
            op_start = op_start.replace(tzinfo=timezone.utc)
        if op_end.tzinfo is None:
            op_end = op_end.replace(tzinfo=timezone.utc)

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

        overpass_blocks.append(
            OverpassBlock(
                overpass_id=item.get("overpass_id", f"op_{idx}"),
                satellite_name=item["satellite_name"],
                groundstation_name=item["groundstation_name"],
                start_time=op_start,
                end_time=op_end,
                duration_seconds=float(item.get("duration_seconds", (op_end - op_start).total_seconds())),
                max_elevation_deg=float(item.get("max_elevation_deg", 0.0)),
                high_res_trajectory=pts,
            )
        )

    return PropagationResult(
        metadata=metadata,
        global_tracks=[],
        overpass_blocks=overpass_blocks,
    )


def export_links_to_json(links: list[LinkBlock], output_path: Path) -> None:
    """Serializes a list of LinkBlock objects to a JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dtos = [LinkBlockDTO.from_domain(l).model_dump(mode="json") for l in links]
    output_path.write_text(json.dumps(dtos, indent=2, default=str), encoding="utf-8")
    print(f"Exported {len(links)} link(s) to '{output_path}'.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Filter and derive candidate LinkBlock passes from raw geometric overpasses."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--input-file",
        type=str,
        help="Path to JSON file containing raw PropagationResult or overpass blocks.",
    )
    group.add_argument(
        "--run-id",
        type=str,
        help="Run ID of the PropagationResult already cached in memory repository.",
    )

    parser.add_argument(
        "--min-aos-los-elevation",
        type=float,
        default=None,
        help="Optional minimum elevation (deg) to trim pass start and end.",
    )
    parser.add_argument(
        "--min-peak-elevation",
        type=float,
        default=None,
        help="Optional minimum peak elevation threshold (deg) for eligibility.",
    )
    parser.add_argument(
        "--output-file",
        type=str,
        default=None,
        help="Optional path to export filtered LinkBlock objects to JSON.",
    )
    parser.add_argument(
        "--no-satos",
        action="store_true",
        help="Skip querying SatOS server for live schedules (use local/empty cache).",
    )

    args = parser.parse_args()

    # If SatOS integration is enabled, attempt to initialize AssetRepository
    if not args.no_satos:
        try:
            print("Connecting to SatOS to fetch baseline activities...")
            AssetRepository.initialize_repository()
            print("Successfully loaded baseline schedules from SatOS.")
        except Exception as e:
            print(f"[WARNING] Could not fetch schedules from SatOS: {e}. Proceeding with local/empty cache.")

    # Load or retrieve PropagationResult
    if args.input_file:
        json_path = Path(args.input_file)
        prop_result = load_propagation_from_json(json_path)
        run_id = prop_result.metadata.run_id
        PropagationResultRepository.save_result(prop_result)
        print(f"Loaded {len(prop_result.overpass_blocks)} overpass(es) from '{json_path}' (Run ID: {run_id}).")
    else:
        run_id = args.run_id
        prop_result = PropagationResultRepository.get_result(run_id)
        if not prop_result:
            print(f"HARD FAIL: Propagation run ID '{run_id}' not found in repository.", file=sys.stderr)
            sys.exit(1)

    print(f"\nApplying filters: min_aos_los={args.min_aos_los_elevation}°, min_peak={args.min_peak_elevation}°...")
    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=args.min_aos_los_elevation,
        min_peak_elevation_deg=args.min_peak_elevation,
    )
    LinkRepository.save_links(filter_run_id, links)

    eligible_count = sum(1 for l in links if l.is_eligible)
    ineligible_count = len(links) - eligible_count

    print(f"\n=======================================================")
    print(f"  Filtering Results (Filter Run ID: {filter_run_id})")
    print(f"=======================================================")
    print(f"Total Candidate Links: {len(links)}")
    print(f"  - Eligible:   {eligible_count}")
    print(f"  - Ineligible: {ineligible_count}")
    print("-------------------------------------------------------")

    for idx, l in enumerate(links, 1):
        status_str = "[ELIGIBLE]" if l.is_eligible else f"[INELIGIBLE: {l.eligibility_status.value}]"
        duration_min = l.duration_seconds / 60.0
        print(f"{idx:02d}. {l.satellite_name} <-> {l.groundstation_name} | {l.start_time.isoformat()} -> {l.end_time.isoformat()} ({duration_min:.1f} min, Peak {l.max_elevation_deg:.1f}°) {status_str}")
        if not l.is_eligible and l.ineligibility_reason:
            print(f"    Reason: {l.ineligibility_reason}")

    if args.output_file:
        export_links_to_json(links, Path(args.output_file))

    print("\n[SUCCESS] Link derivation and filtering completed.")


if __name__ == "__main__":
    main()
