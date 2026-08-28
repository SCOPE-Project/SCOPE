import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from datetime import datetime, timezone
import json
import pytest

from scripts.generate_activities import (
    ActivityFactory,
    ActivityFactoryConfig,
    DurationDistribution,
    ScenarioPreset,
    generate_activities_dataset,
)
from scripts.push_activities import load_activities_from_json


def test_default_generation():
    """Verify default generation outputs 1000 activities matching schema."""
    config = ActivityFactoryConfig(
        total_activities=1000,
        seed=42,
    )
    data = ActivityFactory.create_activities(config)
    activities = data["activities"]

    assert len(activities) == 1000

    # Counts distribution across 3 default satellites
    counts = {}
    for a in activities:
        counts[a["schedule_name"]] = counts.get(a["schedule_name"], 0) + 1

    assert counts == {"Sat1_Group1": 334, "Sat2_Group1": 333, "Sat3_Group1": 333}

    # Verify fields
    for a in activities:
        assert "schedule_name" in a
        assert "start_time" in a
        assert "end_time" in a
        assert a["name"] == "Payload Activity"
        assert a["description"] == "Some dummy Payload Activity"
        assert a["priority"] == 1
        assert a["status"] == 2
        assert a["initiator"] == "PL Mission Planner"
        assert a["executor"] == a["schedule_name"]

        # Parse timestamps
        st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))
        et = datetime.fromisoformat(a["end_time"].replace("Z", "+00:00"))
        assert et > st


def test_skewed_satellite_distribution():
    """Verify custom satellite weights are allocated accurately."""
    sat_dist = {
        "Sat_Alpha": 0.70,
        "Sat_Beta": 0.20,
        "Sat_Gamma": 0.10,
    }
    config = ActivityFactoryConfig(
        total_activities=500,
        satellite_distribution=sat_dist,
        seed=123,
    )
    data = ActivityFactory.create_activities(config)
    activities = data["activities"]
    assert len(activities) == 500

    counts = {}
    for a in activities:
        counts[a["schedule_name"]] = counts.get(a["schedule_name"], 0) + 1

    assert counts["Sat_Alpha"] == 350
    assert counts["Sat_Beta"] == 100
    assert counts["Sat_Gamma"] == 50


def test_non_overlapping_guarantee():
    """Ensure zero overlaps exist between activities on the same satellite."""
    for dist_type in [
        DurationDistribution.UNIFORM,
        DurationDistribution.NORMAL,
        DurationDistribution.LOGNORMAL,
        DurationDistribution.BETA,
        DurationDistribution.EXPONENTIAL,
    ]:
        config = ActivityFactoryConfig(
            total_activities=300,
            duration_min_minutes=5.0,
            duration_max_minutes=20.0,
            duration_spread=1.5,
            duration_distribution=dist_type,
            min_gap_minutes=1.0,
            seed=999,
        )
        data = ActivityFactory.create_activities(config)
        activities = data["activities"]

        # Group by satellite
        by_sat = {}
        for a in activities:
            st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))
            et = datetime.fromisoformat(a["end_time"].replace("Z", "+00:00"))
            by_sat.setdefault(a["schedule_name"], []).append((st, et))

        for sat, intervals in by_sat.items():
            intervals.sort(key=lambda x: x[0])
            for i in range(len(intervals) - 1):
                prev_end = intervals[i][1]
                next_start = intervals[i + 1][0]
                assert next_start >= prev_end, f"Overlap detected on {sat}: {prev_end} > {next_start}"


def test_duration_spread_controls():
    """Verify that duration spread factor scales variance properly."""
    # Low spread: tight around mean
    config_tight = ActivityFactoryConfig(
        total_activities=100,
        duration_min_minutes=2.0,
        duration_max_minutes=20.0,
        duration_mean_minutes=10.0,
        duration_spread=0.0,  # deterministic mean
        seed=42,
    )
    data_tight = ActivityFactory.create_activities(config_tight)
    for a in data_tight["activities"]:
        st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))
        et = datetime.fromisoformat(a["end_time"].replace("Z", "+00:00"))
        dur_m = (et - st).total_seconds() / 60.0
        assert pytest.approx(dur_m, abs=1.0) == 10.0

    # Variable spread
    config_var = ActivityFactoryConfig(
        total_activities=100,
        duration_min_minutes=3.0,
        duration_max_minutes=15.0,
        duration_mean_minutes=9.0,
        duration_spread=1.0,
        duration_distribution=DurationDistribution.UNIFORM,
        seed=42,
    )
    data_var = ActivityFactory.create_activities(config_var)
    durations = [
        (datetime.fromisoformat(a["end_time"].replace("Z", "+00:00")) -
         datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))).total_seconds() / 60.0
        for a in data_var["activities"]
    ]
    assert min(durations) >= 3.0
    assert max(durations) <= 15.0


def test_activity_dto_compatibility():
    """Verify generated activities can be instantiated into ActivityDTO objects."""
    dtos = ActivityFactory.create_dtos(total_activities=50, seed=1)
    assert len(dtos) == 50
    assert dtos[0].name == "Payload Activity"
    assert dtos[0].status == 2
    assert dtos[0].end_time > dtos[0].start_time


def test_file_saving_and_push_activities_ingestion(tmp_path):
    """Verify saved file is fully compatible with push_activities.py loader."""
    test_json_path = tmp_path / "test_scenario_activities.json"
    ActivityFactory.save_json(
        output_path=test_json_path,
        total_activities=200,
        seed=42,
    )

    assert test_json_path.exists()

    # Load with push_activities ingestion function
    dtos = load_activities_from_json(test_json_path)
    assert len(dtos) == 200
    assert dtos[0].schedule_name in ["Sat1_Group1", "Sat2_Group1", "Sat3_Group1"]


def test_deterministic_seed():
    """Verify same seed produces identical timestamps and outputs."""
    data1 = generate_activities_dataset(total_activities=100, seed=777)
    data2 = generate_activities_dataset(total_activities=100, seed=777)
    assert data1 == data2


def test_all_presets():
    """Verify that all preset scenarios execute without error and produce valid output."""
    for preset in ScenarioPreset:
        config = ActivityFactory.get_preset_config(preset)
        config.seed = 42
        data = ActivityFactory.create_activities(config)
        assert len(data["activities"]) == config.total_activities
        for a in data["activities"]:
            st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))
            et = datetime.fromisoformat(a["end_time"].replace("Z", "+00:00"))
            assert et > st
