"""
WARNING: THIS SCRIPT CAN NOT WORK AS THE REPOSITORY IS ONLY STATIC AND WILL NEVER FIND THE RUN-ID
CLI Script: Filter Potential Communication Links.

Usage:
    python scripts/filter_links.py --run-id <ORBIT_ENGINE_RUN_ID> [--min-aos-los-elevation <DEG>] [--min-peak-elevation <DEG>]

Description:
    Fetches raw OverpassBlocks from PropagationResultRepository by run_id, applies elevation
    trimming and thresholds, checks for collisions against SatOS baseline activities from AssetRepository,
    and saves candidate LinkBlock objects to LinkRepository.
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

# Load SatOS credentials
credentials_path = backend_dir / "SatOS_credentials" / "credentials.env"
if credentials_path.exists():
    load_dotenv(credentials_path)

from typing import Dict, Optional
from app.repositories import PropagationResultRepository, LinkRepository, AssetRepository
from core.scheduling.filter_pipeline import derive_and_filter_links


def parse_key_value_pairs(kv_string: str) -> Dict[str, float]:
    """Parse comma-separated key=value pairs into a float dictionary."""
    result: Dict[str, float] = {}
    if not kv_string:
        return result
    for pair in kv_string.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            raise ValueError(f"Invalid key=value format in '{pair}'. Expected 'KEY=FLOAT'.")
        k, v = pair.split("=", 1)
        try:
            result[k.strip()] = float(v.strip())
        except ValueError:
            raise ValueError(f"Value for key '{k}' must be a float, got '{v}'.")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Filter and derive candidate LinkBlock passes from raw geometric overpasses in repository."
    )
    parser.add_argument(
        "--run-id", "-r",
        type=str,
        required=True,
        help="Run ID of the PropagationResult cached in PropagationResultRepository.",
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
        "--downlink-rate", "-d",
        type=float,
        default=25.0,
        help="Default downlink transmission data rate in MB/s for estimated capacity (default: 25.0).",
    )
    parser.add_argument(
        "--satellite-downlink-rates",
        type=str,
        default="",
        help="Comma-separated per-satellite downlink transmission data rates in MB/s (e.g. 'Sat1=50.0,Sat2=100.0').",
    )

    args = parser.parse_args()

    # Print Deprecation Warning
    print("WARNING: THIS SCRIPT IS DEPRECATED. Use the backend API instead.")
    
    # 1. Fetch PropagationResult from PropagationResultRepository (Hard fail if missing)
    run_id = args.run_id
    prop_result = PropagationResultRepository.get_result(run_id)
    if not prop_result:
        print(f"HARD FAIL: Propagation run ID '{run_id}' not found in PropagationResultRepository. Ensure overpasses have been extracted first.", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(prop_result.overpass_blocks)} overpass(es) from PropagationResultRepository (Run ID: {run_id}).")
    print(f"Applying filters: min_aos_los={args.min_aos_los_elevation}°, min_peak={args.min_peak_elevation}°...")

    # 2. Parse satellite downlink rates if provided
    try:
        sat_dl_rates = parse_key_value_pairs(args.satellite_downlink_rates) if args.satellite_downlink_rates else None
    except ValueError as e:
        print(f"HARD FAIL: Invalid parameter format: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Fetch baseline activity schedules from AssetRepository
    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

    # 4. Derive and filter links
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=args.min_aos_los_elevation,
        min_peak_elevation_deg=args.min_peak_elevation,
        default_downlink_rate_mbps=args.downlink_rate,
        satellite_downlink_rates_mbps=sat_dl_rates,
    )

    # 4. Save to LinkRepository with propagation metadata
    LinkRepository.save_links(
        filter_run_id=filter_run_id,
        links=links,
        orbit_engine_run_id=args.propagation_run_id,
        start_time=prop_result.metadata.start_time,
        end_time=prop_result.metadata.end_time,
    )

    eligible_count = sum(1 for l in links if l.is_eligible)
    available_count = sum(1 for l in links if l.is_eligible and l.is_available)
    blocked_count = sum(1 for l in links if l.is_eligible and not l.is_available)
    ineligible_count = len(links) - eligible_count

    print(f"\n=======================================================")
    print(f"  Filtering Results (Filter Run ID: {filter_run_id})")
    print("=======================================================")
    print(f"Total Overpasses Processed: {len(links)}")
    print(f"  - Eligible Potential Links: {eligible_count} ({available_count} Available, {blocked_count} SatOS Blocked)")
    print(f"  - Elevation Ineligible:     {ineligible_count}")
    print("-------------------------------------------------------")

    for idx, l in enumerate(links, 1):
        if l.is_eligible and l.is_available:
            status_str = "[ELIGIBLE - AVAILABLE]"
        elif l.is_eligible and not l.is_available:
            status_str = "[ELIGIBLE - BLOCKED BY SATOS]"
        else:
            status_str = f"[INELIGIBLE: {l.eligibility_status.value}]"

        lid_str = f"[{l.link_id}] " if l.link_id else "[--] "
        duration_min = l.duration_seconds / 60.0
        st_str = l.start_time.isoformat() if hasattr(l.start_time, "isoformat") else str(l.start_time)
        et_str = l.end_time.isoformat() if hasattr(l.end_time, "isoformat") else str(l.end_time)
        print(f"{idx:02d}. {lid_str}{l.satellite_name} <-> {l.groundstation_name} | {st_str} -> {et_str} ({duration_min:.1f} min, Peak {l.max_elevation_deg:.1f}°) {status_str}")
        if l.ineligibility_reason:
            print(f"    Reason: {l.ineligibility_reason}")

    print(f"\n[SUCCESS] Link derivation and filtering completed. Saved to LinkRepository (Filter Run ID: {filter_run_id}).")


if __name__ == "__main__":
    main()
