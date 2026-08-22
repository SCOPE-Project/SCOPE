"""
WARNING: THIS SCRIPT IS DEPRECATED. Use the backend API instead.
CLI Script: Process Trade-Off Groups & Schedule Multi-Pass Downlinks.

Usage:
    python scripts/process_tradeoffs.py --filter-run-id <FILTER_RUN_ID> [--strategy <NAME>] [--strategy-params <KEY=VAL,...>] [--initial-buffers <KEY=VAL,...>] [--commit-to-satos]

Description:
    Fetches filtered LinkBlock candidates from LinkRepository, constructs mutual exclusion trade-off groups,
    runs the multi-pass data buffer forward simulation, and optionally commits confirmed links to SatOS.
"""

import sys
import argparse
from typing import Dict, Any
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

from app.repositories import LinkRepository, AssetRepository
from core.models.scheduling import SatelliteBufferConfig
from core.scheduling.session_manager import SchedulingSessionManager
from core.scheduling.strategy import get_scoring_rule


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


def parse_generic_params(param_string: str) -> Dict[str, Any]:
    """Parse comma-separated key=value parameter string into typed Python dictionary."""
    params: Dict[str, Any] = {}
    if not param_string:
        return params
    for pair in param_string.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            raise ValueError(f"Invalid parameter format in '{pair}'. Expected 'KEY=VALUE'.")
        k, v = pair.split("=", 1)
        k = k.strip()
        v = v.strip()
        try:
            if "." in v:
                params[k] = float(v)
            else:
                params[k] = int(v)
        except ValueError:
            if v.lower() in ("true", "yes"):
                params[k] = True
            elif v.lower() in ("false", "no"):
                params[k] = False
            else:
                params[k] = v
    return params


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run multi-pass downlink scheduling and trade-off optimization from LinkRepository."
    )
    parser.add_argument(
        "--filter-run-id", "-f",
        type=str,
        required=True,
        help="Filter Run ID of candidate LinkBlocks in LinkRepository.",
    )
    parser.add_argument(
        "--strategy", "-s",
        type=str,
        default="buffer_overflow_avoidance",
        help="Pluggable scoring strategy name (default: 'buffer_overflow_avoidance').",
    )
    parser.add_argument(
        "--strategy-params",
        type=str,
        default="",
        help="Comma-separated strategy hyperparameters (e.g. 'alpha=2.5,exponent=2.0').",
    )
    parser.add_argument(
        "--initial-buffers", "-b",
        type=str,
        default="",
        help="Comma-separated initial satellite buffer levels in MB (e.g. 'Sat1_Group1=500.0,Sat2_Group1=200.0').",
    )
    parser.add_argument(
        "--capacities", "-c",
        type=str,
        default="",
        help="Comma-separated satellite buffer capacities in MB (e.g. 'Sat1_Group1=3000.0,Sat2_Group1=4000.0').",
    )
    parser.add_argument(
        "--generation-rates", "-g",
        type=str,
        default="",
        help="Comma-separated satellite payload generation rates in MB/s (e.g. 'Sat1_Group1=10.0,Sat2_Group1=20.0').",
    )
    parser.add_argument(
        "--downlink-rates", "-d",
        type=str,
        default="",
        help="Comma-separated satellite downlink transmission rates in MB/s (e.g. 'Sat1_Group1=50.0,Sat2_Group1=100.0').",
    )
    parser.add_argument(
        "--default-capacity",
        type=float,
        default=2000.0,
        help="Default buffer capacity in MB for any unlisted satellite (default: 2000.0).",
    )
    parser.add_argument(
        "--default-generation-rate",
        type=float,
        default=15.0,
        help="Default payload generation data rate in MB/s for any unlisted satellite (default: 15.0).",
    )
    parser.add_argument(
        "--default-downlink-rate",
        type=float,
        default=25.0,
        help="Default downlink transmission data rate in MB/s for any unlisted satellite (default: 25.0).",
    )
    parser.add_argument(
        "--commit-to-satos",
        action="store_true",
        help="Push confirmed scheduled link activities directly to SatOS schedule.",
    )

    args = parser.parse_args()

    # Print Deprecation Warning
    print("WARNING: THIS SCRIPT IS DEPRECATED. Use the backend API instead.")
    # 1. Fetch links from LinkRepository (Hard fail if missing)
    filter_run_id = args.filter_run_id
    links = LinkRepository.get_links(filter_run_id)
    if links is None:
        print(f"HARD FAIL: Filter run ID '{filter_run_id}' not found in LinkRepository. Ensure links have been filtered first.", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(links)} candidate links from LinkRepository (Filter Run ID: {filter_run_id}).")

    # 2. Parse initial buffers, capacities, rates, and hyperparameters
    try:
        initial_buffers = parse_key_value_pairs(args.initial_buffers) if args.initial_buffers else None
        capacities = parse_key_value_pairs(args.capacities) if args.capacities else None
        generation_rates = parse_key_value_pairs(args.generation_rates) if args.generation_rates else None
        downlink_rates = parse_key_value_pairs(args.downlink_rates) if args.downlink_rates else None
        strategy_params = parse_generic_params(args.strategy_params) if args.strategy_params else {}
    except ValueError as e:
        print(f"HARD FAIL: Invalid parameter format: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Instantiate scoring rule and SchedulingSessionManager
    try:
        scoring_rule = get_scoring_rule(args.strategy, **strategy_params)
    except Exception as e:
        print(f"HARD FAIL: Error configuring strategy '{args.strategy}': {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Executing forward simulation with strategy='{args.strategy}' (parameters={strategy_params})...")
    asset_scheds = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

    all_sats = set()
    if initial_buffers:
        all_sats.update(initial_buffers.keys())
    if capacities:
        all_sats.update(capacities.keys())
    if generation_rates:
        all_sats.update(generation_rates.keys())
    if downlink_rates:
        all_sats.update(downlink_rates.keys())

    satellite_configs = {}
    for sat in all_sats:
        satellite_configs[sat] = SatelliteBufferConfig(
            satellite_name=sat,
            capacity_mb=capacities.get(sat, args.default_capacity) if capacities else args.default_capacity,
            initial_level_mb=initial_buffers.get(sat, 0.0) if initial_buffers else 0.0,
            payload_generation_rate_mbps=generation_rates.get(sat, args.default_generation_rate) if generation_rates else args.default_generation_rate,
            downlink_rate_mbps=downlink_rates.get(sat, args.default_downlink_rate) if downlink_rates else args.default_downlink_rate,
        )

    scenario_start, scenario_end = LinkRepository.get_time_window(filter_run_id)
    if scenario_start is None or scenario_end is None:
        print(f"HARD FAIL: Scenario time window (start_time, end_time) could not be resolved from LinkRepository metadata for filter run '{filter_run_id}'.", file=sys.stderr)
        sys.exit(1)

    session = SchedulingSessionManager.create_session(
        filter_run_id=args.filter_run_id,
        candidate_links=links,
        scenario_start=scenario_start,
        scenario_end=scenario_end,
        asset_schedules=asset_scheds,
        satellite_configs=satellite_configs if satellite_configs else None,
        default_capacity_mb=args.default_capacity,
        default_payload_generation_rate_mbps=args.default_generation_rate,
        default_downlink_rate_mbps=args.default_downlink_rate,
        scoring_strategy=args.strategy,
        scoring_parameters=strategy_params,
    )

    plan = session.current_plan
    scheduled_statuses = [st for st in plan.values() if st.is_scheduled]
    unscheduled_statuses = [st for st in plan.values() if not st.is_scheduled]

    print("\n=======================================================")
    print(f"  Scheduling Plan (Session ID: {session.session_id})")
    print("=======================================================")
    print(f"Total Trade-Off Groups: {len(session.conflict_structure.trade_off_groups)}")
    print(f"Total Candidate Passes: {len(links)}")
    print(f"  - Scheduled:   {len(scheduled_statuses)}")
    print(f"  - Unscheduled: {len(unscheduled_statuses)}")
    print("-------------------------------------------------------")

    if scheduled_statuses:
        print("\n[SCHEDULED LINKS]")
        for sp in scheduled_statuses:
            l = sp.link
            st_str = l.start_time.isoformat() if hasattr(l.start_time, "isoformat") else str(l.start_time)
            et_str = l.end_time.isoformat() if hasattr(l.end_time, "isoformat") else str(l.end_time)
            print(f"  * {l.satellite_name} <-> {l.groundstation_name} | {st_str} -> {et_str} | Offloaded: {sp.useful_data_offloaded_mb:.1f} MB (Group: {sp.tradeoff_id})")

    if unscheduled_statuses:
        print("\n[UNSCHEDULED / REJECTED PASSES]")
        for up in unscheduled_statuses:
            l = up.link
            st_str = l.start_time.isoformat() if hasattr(l.start_time, "isoformat") else str(l.start_time)
            et_str = l.end_time.isoformat() if hasattr(l.end_time, "isoformat") else str(l.end_time)
            print(f"  x {l.satellite_name} <-> {l.groundstation_name} | {st_str} -> {et_str} | Reason: {up.rejection_reason}")

    print("\n=======================================================")
    print("  Satellite Data Buffer Telemetry")
    print("=======================================================")
    for sat_name, prof in session.satellite_buffer_profiles.items():
        print(f"Satellite: {sat_name}")
        print(f"  Capacity:    {prof.capacity_mb:.1f} MB")
        print(f"  Generated:   {prof.total_generated_mb:.1f} MB")
        print(f"  Downlinked:  {prof.total_downlinked_mb:.1f} MB")
        print(f"  Final Level: {prof.final_level_mb:.1f} MB (Peak: {prof.peak_level_mb:.1f} MB)")

    # 4. Commit to SatOS if requested
    if args.commit_to_satos:
        if not scheduled_statuses:
            print("\n[WARNING] No scheduled passes to commit to SatOS.")
        else:
            print(f"\nPushing {len(scheduled_statuses)} scheduled links to SatOS...")
            scheduled_links = [sp.link for sp in scheduled_statuses]
            try:
                pushed_activities = AssetRepository.push_scheduled_links_to_satos(scheduled_links)
                print(f"[OK] Successfully created and pushed {len(pushed_activities)} activities to SatOS.")
            except Exception as e:
                print(f"HARD FAIL: Failed to commit scheduled links to SatOS: {e}", file=sys.stderr)
                sys.exit(1)

    print("\n[SUCCESS] Trade-off processing completed.")


if __name__ == "__main__":
    main()
