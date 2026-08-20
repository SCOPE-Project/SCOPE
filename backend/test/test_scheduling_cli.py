import pytest
import subprocess
import sys
from pathlib import Path

# Paths
backend_dir = Path(__file__).resolve().parent.parent


def test_cli_filter_links_hard_fail_missing_run_id():
    """Verify filter_links CLI hard fails when run_id is not in repository."""
    res = subprocess.run(
        [sys.executable, "scripts/filter_links.py", "--run-id", "non_existent_propagation_999"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_process_tradeoffs_hard_fail_missing_filter_run_id():
    """Verify process_tradeoffs CLI hard fails when filter_run_id is not in repository."""
    res = subprocess.run(
        [sys.executable, "scripts/process_tradeoffs.py", "--filter-run-id", "non_existent_filter_999"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 1
    assert "HARD FAIL" in res.stderr


def test_cli_filter_links_help():
    """Verify filter_links CLI displays help options correctly."""
    res = subprocess.run(
        [sys.executable, "scripts/filter_links.py", "--help"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "--run-id" in res.stdout
    assert "--min-aos-los-elevation" in res.stdout
    assert "--min-peak-elevation" in res.stdout


def test_cli_process_tradeoffs_help():
    """Verify process_tradeoffs CLI displays help options correctly."""
    res = subprocess.run(
        [sys.executable, "scripts/process_tradeoffs.py", "--help"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0
    assert "--filter-run-id" in res.stdout
    assert "--strategy" in res.stdout
    assert "--initial-buffers" in res.stdout
    assert "--commit-to-satos" in res.stdout
