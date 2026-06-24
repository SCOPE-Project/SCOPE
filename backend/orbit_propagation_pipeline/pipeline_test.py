"""Runnable standalone entry point for the Python Orekit OMM hello-world pipeline."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from models_test import DEFAULT_OREKIT_DATA_PATH, DEFAULT_PROPAGATION_SECONDS, SAMPLE_OMM_XML, SatOSVersion
from orekit_service_test import propagate_omm_xml
from satos_omm_test import build_orbit_omm_telemetry, fetch_latest_orbit_omm_xml, post_orbit_omm_telemetry
from tasks_test import start_orbit_processing_task


def _read_omm_xml(path: str | None) -> str:
    if path is None:
        return SAMPLE_OMM_XML
    return Path(path).read_text(encoding="utf-8")


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def run_offline_hello_world(
    omm_xml: str = SAMPLE_OMM_XML,
    propagation_seconds: float = DEFAULT_PROPAGATION_SECONDS,
    orekit_data_path: str | Path | None = None,
    download_orekit_data: bool = True,
):
    """Run the standalone offline propagation flow and return the PV result."""
    task = start_orbit_processing_task(
        omm_xml=omm_xml,
        propagation_seconds=propagation_seconds,
        orekit_data_path=orekit_data_path,
        download_orekit_data=download_orekit_data,
        run_async=False,
    )
    if task.status != "completed" or task.result is None:
        raise RuntimeError(task.error or "Orbit processing task did not complete")
    return task.result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone SatOS OMM to Python Orekit hello-world pipeline.")
    parser.add_argument("--satellite-name", default="DemoSat", help="SatOS satellite root asset name.")
    parser.add_argument("--satellite-version", default="1.0.0", help="SatOS satellite version MAJOR.MINOR.PATCH.")
    parser.add_argument("--omm-xml-file", help="Path to an OMM XML file. Defaults to the embedded ISS sample.")
    parser.add_argument("--orekit-data", default=str(DEFAULT_OREKIT_DATA_PATH), help="Path to orekit-data zip/folder.")
    parser.add_argument("--no-download-orekit-data", action="store_true", help="Fail instead of downloading orekit data.")
    parser.add_argument("--propagation-seconds", type=float, default=DEFAULT_PROPAGATION_SECONDS)
    parser.add_argument("--post-live", action="store_true", help="Post the OMM XML to SatOS telemetry.")
    parser.add_argument("--fetch-live", action="store_true", help="Fetch latest OMM XML from SatOS before propagating.")
    parser.add_argument("--start-time", help="Live fetch start time, ISO-8601.")
    parser.add_argument("--end-time", help="Live fetch end time, ISO-8601.")
    args = parser.parse_args(argv)

    omm_xml = _read_omm_xml(args.omm_xml_file)
    sat_version = SatOSVersion.from_string(args.satellite_version)

    if args.post_live:
        response = post_orbit_omm_telemetry(
            satellite_name=args.satellite_name,
            omm_xml=omm_xml,
            version=sat_version,
        )
        print(f"Posted OMM telemetry to SatOS: HTTP {response.status_code}")

    if args.fetch_live:
        omm_xml = fetch_latest_orbit_omm_xml(
            satellite_name=args.satellite_name,
            start_time=_parse_datetime(args.start_time),
            end_time=_parse_datetime(args.end_time),
        )

    result = propagate_omm_xml(
        omm_xml=omm_xml,
        propagation_seconds=args.propagation_seconds,
        orekit_data_path=args.orekit_data,
        download_orekit_data=not args.no_download_orekit_data,
    )
    print(result.model_dump_json(indent=2))
    return 0


def test_satos_payload_uses_orbit_omm_string_value():
    telemetry = build_orbit_omm_telemetry(
        satellite_name="DemoSat",
        omm_xml=SAMPLE_OMM_XML,
        version=SatOSVersion(major=1, minor=0, patch=0),
    )
    assert telemetry.id == "DemoSat.orbit_omm_xml"
    assert telemetry.value.stringValue == SAMPLE_OMM_XML
    assert telemetry.validity is True


def test_offline_sample_omm_propagates_when_orekit_data_is_available():
    import pytest

    pytest.importorskip("orekit_jpype")
    if not DEFAULT_OREKIT_DATA_PATH.exists():
        pytest.skip(f"Orekit data not found at {DEFAULT_OREKIT_DATA_PATH}")

    completed = subprocess.run(
        [sys.executable, __file__, "--no-download-orekit-data"],
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)
    assert result["mean_element_theory"] == "SGP4"
    values = [*result["position_m"], *result["velocity_m_per_s"]]
    assert all(isinstance(value, float) and math.isfinite(value) for value in values)


if __name__ == "__main__":
    raise SystemExit(main())
