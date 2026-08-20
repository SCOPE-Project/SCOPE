import pytest
import subprocess
import sys
from pathlib import Path

# Paths
backend_dir = Path(__file__).resolve().parent.parent


def test_cli_initialize_assets_help():
    """Verify initialize_assets.py displays CLI help correctly."""
    res = subprocess.run(
        [sys.executable, "scripts/initialize_assets.py", "--help"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "Initialize AssetRepository" in res.stdout
    assert "--force-refresh" in res.stdout


def test_cli_extract_overpasses_help():
    """Verify extract_overpasses.py displays CLI help correctly."""
    res = subprocess.run(
        [sys.executable, "scripts/extract_overpasses.py", "--help"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "Extract geometric overpasses" in res.stdout
    assert "--satellites" in res.stdout
    assert "--groundstations" in res.stdout
    assert "--start-time" in res.stdout
    assert "--end-time" in res.stdout


def test_cli_extract_overpasses_hard_fail_invalid_times():
    """Verify extract_overpasses CLI hard fails when end_time is before start_time."""
    res = subprocess.run(
        [
            sys.executable,
            "scripts/extract_overpasses.py",
            "--satellites", "Sat1_Group1",
            "--groundstations", "GS1_Group1",
            "--start-time", "2026-08-18T12:00:00Z",
            "--end-time", "2026-08-17T12:00:00Z",
        ],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_extract_overpasses_hard_fail_uninitialized_asset():
    """Verify extract_overpasses CLI hard fails when asset is not available."""
    res = subprocess.run(
        [
            sys.executable,
            "scripts/extract_overpasses.py",
            "--satellites", "NonExistentSat_999",
            "--groundstations", "NonExistentGS_999",
            "--start-time", "2026-08-17T12:00:00Z",
            "--end-time", "2026-08-18T12:00:00Z",
        ],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr
