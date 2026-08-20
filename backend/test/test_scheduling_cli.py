import pytest
import subprocess
import sys
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Paths
backend_dir = Path(__file__).resolve().parent.parent


def test_cli_filter_links_hard_fail_missing_file():
    """Verify filter_links CLI hard fails when input file does not exist."""
    res = subprocess.run(
        [sys.executable, "scripts/filter_links.py", "--input-file", "non_existent_propagation_999.json", "--no-satos"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_process_tradeoffs_hard_fail_missing_file():
    """Verify process_tradeoffs CLI hard fails when input file does not exist."""
    res = subprocess.run(
        [sys.executable, "scripts/process_tradeoffs.py", "--input-file", "non_existent_links_999.json", "--no-satos"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_scheduling_pipeline_e2e(tmp_path: Path):
    """
    Tests the complete end-to-end CLI workflow:
    1. Export sample PropagationResult to JSON.
    2. Run scripts/filter_links.py on propagation JSON -> exports filtered_links.json.
    3. Run scripts/process_tradeoffs.py on filtered_links.json -> exports session_plan.json.
    4. Validate outputs and exit codes.
    """
    prop_json_path = tmp_path / "sample_propagation.json"
    filtered_json_path = tmp_path / "filtered_links.json"
    session_json_path = tmp_path / "session_plan.json"

    t0 = datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc).isoformat()
    t1 = datetime(2026, 8, 18, 12, 10, 0, tzinfo=timezone.utc).isoformat()

    sample_propagation = {
        "metadata": {
            "run_id": "test_cli_prop_01",
            "start_time": t0,
            "end_time": t1,
            "global_track_step_seconds": 30.0,
            "overpass_profile_step_seconds": 10.0,
        },
        "overpass_blocks": [
            {
                "overpass_id": "op_001",
                "satellite_name": "Sat-Alpha",
                "groundstation_name": "GS-Kiruna",
                "start_time": t0,
                "end_time": t1,
                "duration_seconds": 600.0,
                "max_elevation_deg": 45.0,
                "high_res_trajectory": [
                    {"timestamp": t0, "elevation_deg": 0.0, "latitude_deg": 0.0, "longitude_deg": 0.0, "altitude_m": 500000.0, "azimuth_deg": 180.0, "range_m": 700000.0},
                    {"timestamp": t1, "elevation_deg": 45.0, "latitude_deg": 0.0, "longitude_deg": 0.0, "altitude_m": 500000.0, "azimuth_deg": 180.0, "range_m": 700000.0},
                ],
            }
        ],
    }
    prop_json_path.write_text(json.dumps(sample_propagation), encoding="utf-8")

    # Step 1: Run filter_links.py
    res_filter = subprocess.run(
        [
            sys.executable,
            "scripts/filter_links.py",
            "--input-file",
            str(prop_json_path),
            "--min-aos-los-elevation",
            "5.0",
            "--min-peak-elevation",
            "10.0",
            "--output-file",
            str(filtered_json_path),
            "--no-satos",
        ],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_filter.returncode == 0
    assert "Filtering Results" in res_filter.stdout
    assert "[SUCCESS] Link derivation and filtering completed." in res_filter.stdout
    assert filtered_json_path.exists()

    filtered_data = json.loads(filtered_json_path.read_text(encoding="utf-8"))
    assert len(filtered_data) == 1
    assert filtered_data[0]["satellite_name"] == "Sat-Alpha"
    assert filtered_data[0]["is_eligible"] is True

    # Step 2: Run process_tradeoffs.py
    res_tradeoffs = subprocess.run(
        [
            sys.executable,
            "scripts/process_tradeoffs.py",
            "--input-file",
            str(filtered_json_path),
            "--strategy",
            "buffer_overflow_avoidance",
            "--urgency-alpha",
            "2.5",
            "--initial-buffers",
            "Sat-Alpha=300.0",
            "--output-file",
            str(session_json_path),
            "--no-satos",
        ],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_tradeoffs.returncode == 0
    assert "Scheduling Plan" in res_tradeoffs.stdout
    assert "Satellite Data Buffer Telemetry" in res_tradeoffs.stdout
    assert "[SUCCESS] Trade-off processing completed." in res_tradeoffs.stdout
    assert session_json_path.exists()

    session_data = json.loads(session_json_path.read_text(encoding="utf-8"))
    assert "current_plan" in session_data
    assert "satellite_buffer_profiles" in session_data
    assert "Sat-Alpha" in session_data["satellite_buffer_profiles"]
