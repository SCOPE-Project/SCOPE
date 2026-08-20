"""
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

from app.repositories import PropagationResultRepository, LinkRepository, AssetRepository
from core.scheduling.filter_pipeline import derive_and_filter_links


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

    args = parser.parse_args()

    # 1. Fetch PropagationResult from PropagationResultRepository (Hard fail if missing)
    run_id = args.run_id
    prop_result = PropagationResultRepository.get_result(run_id)
    if not prop_result:
        print(f"HARD FAIL: Propagation run ID '{run_id}' not found in PropagationResultRepository. Ensure overpasses have been extracted first.", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(prop_result.overpass_blocks)} overpass(es) from PropagationResultRepository (Run ID: {run_id}).")
    print(f"Applying filters: min_aos_los={args.min_aos_los_elevation}°, min_peak={args.min_peak_elevation}°...")

    # 2. Fetch baseline activity schedules from AssetRepository
    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

    # 3. Derive and filter links
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=args.min_aos_los_elevation,
        min_peak_elevation_deg=args.min_peak_elevation,
    )

    # 4. Save to LinkRepository
    LinkRepository.save_links(filter_run_id, links)

    eligible_count = sum(1 for l in links if l.is_eligible)
    ineligible_count = len(links) - eligible_count

    print(f"\n=======================================================")
    print(f"  Filtering Results (Filter Run ID: {filter_run_id})")
    print("=======================================================")
    print(f"Total Candidate Links: {len(links)}")
    print(f"  - Eligible:   {eligible_count}")
    print(f"  - Ineligible: {ineligible_count}")
    print("-------------------------------------------------------")

    for idx, l in enumerate(links, 1):
        status_str = "[ELIGIBLE]" if l.is_eligible else f"[INELIGIBLE: {l.eligibility_status.value}]"
        duration_min = l.duration_seconds / 60.0
        st_str = l.start_time.isoformat() if hasattr(l.start_time, "isoformat") else str(l.start_time)
        et_str = l.end_time.isoformat() if hasattr(l.end_time, "isoformat") else str(l.end_time)
        print(f"{idx:02d}. {l.satellite_name} <-> {l.groundstation_name} | {st_str} -> {et_str} ({duration_min:.1f} min, Peak {l.max_elevation_deg:.1f}°) {status_str}")
        if not l.is_eligible and l.ineligibility_reason:
            print(f"    Reason: {l.ineligibility_reason}")

    print(f"\n[SUCCESS] Link derivation and filtering completed. Saved to LinkRepository (Filter Run ID: {filter_run_id}).")


if __name__ == "__main__":
    main()
