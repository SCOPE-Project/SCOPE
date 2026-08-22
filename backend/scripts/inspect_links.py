"""
CLI Script: Inspect LinkRepository Databank.

Usage:
    python scripts/inspect_links.py
    python scripts/inspect_links.py --get <FILTER_RUN_ID>

Description:
    Displays a top-level list of all stored link filtering runs in LinkRepository,
    or zooms into detailed candidate LinkBlocks and eligibility statuses for a specific run.
"""

import sys
import argparse
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.repositories import LinkRepository


def list_link_runs() -> None:
    """Prints a top-level overview table of all filter runs in LinkRepository."""
    run_ids = LinkRepository.list_runs()

    if not run_ids:
        print("[INFO] LinkRepository is empty. Run 'python scripts/filter_links.py' to populate it.")
        return

    print("=======================================================================")
    print(f"  LinkRepository Databank (Total Filter Runs: {len(run_ids)})")
    print("=======================================================================")
    print(f"{'Filter Run ID':<40} {'Total Links':<14} {'Eligible':<10} {'Ineligible':<10}")
    print("-" * 74)

    for run_id in run_ids:
        links = LinkRepository.get_links(run_id) or []
        eligible_count = sum(1 for l in links if l.is_eligible)
        ineligible_count = len(links) - eligible_count
        print(f"{run_id:<40} {len(links):<14} {eligible_count:<10} {ineligible_count:<10}")

    print("-" * 74)
    print("Use '--get <FILTER_RUN_ID>' to view candidate links and eligibility details.")


def show_link_run_detail(filter_run_id: str) -> None:
    """Prints detailed candidate LinkBlocks and eligibility statuses for a specific filter run."""
    links = LinkRepository.get_links(filter_run_id)

    if links is None:
        print(f"HARD FAIL: Filter run ID '{filter_run_id}' not found in LinkRepository.", file=sys.stderr)
        sys.exit(1)

    eligible_count = sum(1 for l in links if l.is_eligible)
    available_count = sum(1 for l in links if l.is_eligible and l.is_available)
    blocked_count = sum(1 for l in links if l.is_eligible and not l.is_available)
    ineligible_count = len(links) - eligible_count

    print("=======================================================================")
    print(f"  Filter Run Detail: {filter_run_id}")
    print("=======================================================================")
    print(f"Total Overpasses: {len(links)} (Eligible: {eligible_count} [{available_count} Available, {blocked_count} Blocked], Ineligible: {ineligible_count})")
    print("-" * 71)

    if links:
        for idx, l in enumerate(links, 1):
            dur_min = l.duration_seconds / 60.0
            st_str = l.start_time.isoformat() if hasattr(l.start_time, "isoformat") else str(l.start_time)
            et_str = l.end_time.isoformat() if hasattr(l.end_time, "isoformat") else str(l.end_time)
            if l.is_eligible and l.is_available:
                status_str = "[ELIGIBLE - AVAILABLE]"
            elif l.is_eligible and not l.is_available:
                status_str = "[ELIGIBLE - BLOCKED BY SATOS]"
            else:
                status_str = f"[INELIGIBLE: {l.eligibility_status.value}]"

            lid_display = f"[{l.link_id}]" if l.link_id else "[--]"
            print(f"{idx:02d}. {lid_display} ({l.link_name or 'N/A'}) {l.satellite_name} <-> {l.groundstation_name}")
            print(f"    Time:      {st_str} -> {et_str} ({dur_min:.1f} min)")
            print(f"    Peak Elev: {l.max_elevation_deg:.1f}° | Status: {status_str}")
            if l.ineligibility_reason:
                print(f"    Reason:    {l.ineligibility_reason}")
    else:
        print("  (No candidate links stored under this run ID)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect LinkRepository databank entries and candidate LinkBlock details."
    )
    parser.add_argument(
        "--get", "-g", "--filter-run-id",
        type=str,
        default=None,
        help="Filter Run ID to inspect in detail.",
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List all top-level filter runs (default behavior if no arguments provided).",
    )

    args = parser.parse_args()

    if args.get:
        show_link_run_detail(args.get.strip("[]'\", "))
    else:
        list_link_runs()


if __name__ == "__main__":
    main()
