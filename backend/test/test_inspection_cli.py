import pytest
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

# Paths
backend_dir = Path(__file__).resolve().parent.parent


def test_cli_inspect_help_all():
    """Verify all three inspection scripts display help options correctly."""
    scripts = [
        "scripts/inspect_assets.py",
        "scripts/inspect_propagation.py",
        "scripts/inspect_links.py",
    ]
    for s in scripts:
        res = subprocess.run(
            [sys.executable, s, "--help"],
            cwd=str(backend_dir),
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        assert "--get" in res.stdout
        assert "--list" in res.stdout


def test_cli_inspect_overview():
    """Verify all three inspection scripts handle overview listing without errors."""
    res_assets = subprocess.run(
        [sys.executable, "scripts/inspect_assets.py"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_assets.returncode == 0
    assert "AssetRepository" in res_assets.stdout

    res_prop = subprocess.run(
        [sys.executable, "scripts/inspect_propagation.py"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_prop.returncode == 0
    assert "PropagationResultRepository" in res_prop.stdout

    res_links = subprocess.run(
        [sys.executable, "scripts/inspect_links.py"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_links.returncode == 0
    assert "LinkRepository" in res_links.stdout


def test_cli_inspect_hard_fail_on_missing_entry():
    """Verify inspection scripts hard fail when requested entry is not found."""
    res_assets = subprocess.run(
        [sys.executable, "scripts/inspect_assets.py", "--get", "NonExistentAsset_999"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_assets.returncode == 1
    assert "HARD FAIL" in res_assets.stderr

    res_prop = subprocess.run(
        [sys.executable, "scripts/inspect_propagation.py", "--get", "NonExistentRun_999"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_prop.returncode == 1
    assert "HARD FAIL" in res_prop.stderr

    res_links = subprocess.run(
        [sys.executable, "scripts/inspect_links.py", "--get", "NonExistentFilter_999"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    assert res_links.returncode == 1
    assert "HARD FAIL" in res_links.stderr
