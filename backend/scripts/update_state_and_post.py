import argparse
import sys
from pathlib import Path
import numpy as np

# Ensure backend root is on sys.path
backend_path = Path(__file__).resolve().parent.parent
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from dotenv import load_dotenv
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from app.services.satos_connector import (
    DEFAULT_UPDATE_STATE_CONFIG_PATH,
    load_update_state_config,
    update_and_post_satellite_states,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calculate RV states from Keplerian orbits and update SatOS assets."
    )
    parser.add_argument(
        "--config",
        type=str,
        default=str(DEFAULT_UPDATE_STATE_CONFIG_PATH),
        help=f"Path to JSON config (default: {DEFAULT_UPDATE_STATE_CONFIG_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate states and print to console without posting to SatOS.",
    )

    args = parser.parse_args()

    config_path = Path(args.config)
    print(f"Loading simulation config from: {config_path}")
    config = load_update_state_config(config_path)
    print(f"Scenario Epoch (UTC): {config.epoch_utc.isoformat()}")
    print(f"Configured Satellites: {len(config.satellites)}")

    if not args.dry_run:
        credentials_path = backend_path / "SatOS_credentials" / "credentials.env"
        if not load_dotenv(credentials_path):
            print(f"[WARNING] Could not load credentials from {credentials_path}. Relying on existing environment variables.")

    print("\nCalculating state vectors...")
    states = update_and_post_satellite_states(config=config, dry_run=args.dry_run)

    for state in states:
        pos_str = ", ".join(f"{x:,.2f}" for x in state.position_m)
        vel_str = ", ".join(f"{v:,.2f}" for v in state.velocity_m_s)
        print(f"\nSatellite: {state.name}")
        print(f"  Frame: {state.reference_frame}")
        print(f"  RAAN:  {state.raan_deg:.6f}°")
        print(f"  Pos:   [{pos_str}] m")
        print(f"  Vel:   [{vel_str}] m/s")

    if args.dry_run:
        print("\n[DRY RUN] No changes were written to SatOS.")
    else:
        print("\n[SUCCESS] Successfully updated satellite states in SatOS.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
