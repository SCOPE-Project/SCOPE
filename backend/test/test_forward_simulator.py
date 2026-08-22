import pytest
import uuid
from datetime import datetime, timezone

from core.models.scheduling import (
    LinkBlock,
    OverrideState,
    SatelliteBufferConfig,
    ConflictStructure,
)
from core.scheduling.conflict_builder import build_conflict_structure
from core.scheduling.forward_simulator import run_forward_simulation, ForwardSimulationScheduler
from core.scheduling.strategy import BufferUrgencyScoringRule, ThroughputScoringRule, DurationScoringRule
from core.models.activities import Activity
from pydantic_models.schedule_event import ScheduleEventModel


def test_forward_simulator_payload_inflow_and_downlink():
    """
    Tests that a payload activity increases the buffer level,
    and a subsequent downlink pass drains the buffer.
    """
    t0 = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)  # Payload 10:00 -> 10:10 (600s * 0.5 MB/s = 300 MB)
    t2 = datetime(2026, 8, 18, 11, 0, 0, tzinfo=timezone.utc)
    t3 = datetime(2026, 8, 18, 11, 10, 0, tzinfo=timezone.utc)  # Downlink 11:00 -> 11:10 (600s * 1 MB/s = 600 MB)

    sat_configs = {
        "Sat-1": SatelliteBufferConfig(
            satellite_name="Sat-1",
            capacity_mb=1000.0,
            initial_level_mb=100.0,
            payload_generation_rate_mbps=0.5,
            downlink_rate_mbps=1.0,
        )
    }

    act = Activity(
        uuid=uuid.uuid4(),
        schedule_name="Sat-1",
        status=1,
        start_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_START", name="Payload", timestamp=t0, schedule_1="Sat-1"),
        end_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_END", name="Payload End", timestamp=t1, schedule_1="Sat-1"),
        name="Payload Observation",
    )
    asset_schedules = {"Sat-1": [act]}

    link = LinkBlock(
        link_id="L1_Sat1",
        overpass_id="op1",
        satellite_name="Sat-1",
        groundstation_name="GS-1",
        start_time=t2,
        end_time=t3,
        duration_seconds=600.0,
        max_elevation_deg=50.0,
    )
    candidate_links = {"L1_Sat1": link}
    conflict_struct = build_conflict_structure([link])

    plan, profiles = run_forward_simulation(
        candidate_links=candidate_links,
        user_overrides={},
        satellite_configs=sat_configs,
        conflict_structure=conflict_struct,
        asset_schedules=asset_schedules,
    )

    assert plan["L1_Sat1"].is_scheduled is True
    assert plan["L1_Sat1"].useful_data_offloaded_mb == 400.0
    assert plan["L1_Sat1"].score > 0.0

    profile = profiles["Sat-1"]
    assert profile.total_generated_mb == 300.0
    assert profile.total_downlinked_mb == 400.0
    assert profile.final_level_mb == 0.0
    assert profile.total_lost_mb == 0.0


def test_forward_simulator_clamping_out_of_window_activities():
    """
    Verifies that SatOS activities outside the scenario time window [T_start, T_end]
    are ignored and do not pollute the simulation.
    """
    # Scenario window is around 2026-08-18 10:00 -> 10:10
    t_pass_s = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t_pass_e = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    # Activity from 3 months ago!
    t_old_s = datetime(2026, 5, 1, 0, 0, 0, tzinfo=timezone.utc)
    t_old_e = datetime(2026, 5, 1, 1, 0, 0, tzinfo=timezone.utc)

    act_old = Activity(
        uuid=uuid.uuid4(),
        schedule_name="Sat-1",
        status=1,
        start_event=ScheduleEventModel(uuid=uuid.uuid4(), id="OLD_START", name="Old Act", timestamp=t_old_s, schedule_1="Sat-1"),
        end_event=ScheduleEventModel(uuid=uuid.uuid4(), id="OLD_END", name="Old Act End", timestamp=t_old_e, schedule_1="Sat-1"),
        name="Ancient Payload Activity",
    )

    sat_configs = {
        "Sat-1": SatelliteBufferConfig(
            satellite_name="Sat-1",
            capacity_mb=1000.0,
            initial_level_mb=50.0,
            payload_generation_rate_mbps=1.0,
            downlink_rate_mbps=1.0,
        )
    }

    link = LinkBlock(
        link_id="L_Now",
        overpass_id="op1",
        satellite_name="Sat-1",
        groundstation_name="GS-1",
        start_time=t_pass_s,
        end_time=t_pass_e,
        duration_seconds=600.0,
        max_elevation_deg=50.0,
    )

    plan, profiles = run_forward_simulation(
        candidate_links={"L_Now": link},
        user_overrides={},
        satellite_configs=sat_configs,
        conflict_structure=build_conflict_structure([link]),
        asset_schedules={"Sat-1": [act_old]},
    )

    prof = profiles["Sat-1"]
    # Ancient activity must NOT be counted in total_generated_mb
    assert prof.total_generated_mb == 0.0


def test_forward_simulator_custom_scoring_rule_injection():
    """Tests that a custom scoring rule can be injected directly into the scheduler."""
    t_start = datetime(2026, 8, 18, 14, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 14, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="L1", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)
    l2 = LinkBlock(link_id="L2", overpass_id="op2", satellite_name="Sat-2", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=300.0, max_elevation_deg=50.0)

    sat_configs = {
        "Sat-1": SatelliteBufferConfig(satellite_name="Sat-1", capacity_mb=1000.0, initial_level_mb=100.0, downlink_rate_mbps=1.0, payload_generation_rate_mbps=1.0),
        "Sat-2": SatelliteBufferConfig(satellite_name="Sat-2", capacity_mb=1000.0, initial_level_mb=100.0, downlink_rate_mbps=1.0, payload_generation_rate_mbps=1.0),
    }

    scheduler = ForwardSimulationScheduler()
    # Using DurationScoringRule (L1 is 600s, L2 is 300s -> L1 wins)
    plan, _ = scheduler.solve(
        candidate_links={"L1": l1, "L2": l2},
        user_overrides={},
        satellite_configs=sat_configs,
        conflict_structure=build_conflict_structure([l1, l2]),
        asset_schedules={},
        scoring_rule=DurationScoringRule(),
    )

    assert plan["L1"].is_scheduled is True
    assert plan["L2"].is_scheduled is False


def test_forward_simulator_buffer_overflow_detection():
    """
    Tests that when payload generation exceeds capacity, an overflow is recorded.
    """
    t0 = datetime(2026, 8, 18, 8, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 8, 18, 9, 0, 0, tzinfo=timezone.utc)  # 3600 seconds * 1 MB/s = 3600 MB

    sat_configs = {
        "Sat-1": SatelliteBufferConfig(
            satellite_name="Sat-1",
            capacity_mb=1000.0,
            initial_level_mb=0.0,
            payload_generation_rate_mbps=1.0,
            downlink_rate_mbps=2.0,
        )
    }

    act = Activity(
        uuid=uuid.uuid4(),
        schedule_name="Sat-1",
        status=1,
        start_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_START", name="Payload", timestamp=t0, schedule_1="Sat-1"),
        end_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_END", name="Payload End", timestamp=t1, schedule_1="Sat-1"),
        name="Massive Payload",
    )

    dummy_link = LinkBlock(
        link_id="L_Dummy", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1",
        start_time=t0, end_time=t1, duration_seconds=3600.0, max_elevation_deg=50.0
    )

    plan, profiles = run_forward_simulation(
        candidate_links={"L_Dummy": dummy_link},
        user_overrides={"L_Dummy": OverrideState.EXCLUDED},
        satellite_configs=sat_configs,
        conflict_structure=ConflictStructure(),
        asset_schedules={"Sat-1": [act]},
    )

    prof = profiles["Sat-1"]
    assert prof.total_generated_mb == 3600.0
    assert prof.final_level_mb == 1000.0
    assert prof.total_lost_mb == 2600.0
    assert len(prof.overflow_events) == 1
    assert prof.overflow_events[0].lost_data_mb == 2600.0


def test_forward_simulator_user_overrides():
    """
    Tests that user overrides PINNED and EXCLUDED are strictly enforced.
    """
    t_start = datetime(2026, 8, 18, 14, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 14, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(link_id="L1", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)
    l2 = LinkBlock(link_id="L2", overpass_id="op2", satellite_name="Sat-2", groundstation_name="GS-1", start_time=t_start, end_time=t_end, duration_seconds=600.0, max_elevation_deg=50.0)

    sat_configs = {
        "Sat-1": SatelliteBufferConfig(satellite_name="Sat-1", capacity_mb=1000.0, initial_level_mb=100.0, downlink_rate_mbps=1.0, payload_generation_rate_mbps=1.0),
        "Sat-2": SatelliteBufferConfig(satellite_name="Sat-2", capacity_mb=1000.0, initial_level_mb=900.0, downlink_rate_mbps=1.0, payload_generation_rate_mbps=1.0),
    }

    conflict_struct = build_conflict_structure([l1, l2])

    # Case A: Default auto solver would pick Sat-2 (due to higher buffer level)
    plan_auto, _ = run_forward_simulation(
        candidate_links={"L1": l1, "L2": l2},
        user_overrides={},
        satellite_configs=sat_configs,
        conflict_structure=conflict_struct,
        asset_schedules={},
    )
    assert plan_auto["L2"].is_scheduled is True
    assert plan_auto["L1"].is_scheduled is False

    # Case B: User pins L1 (forces L1 ON, forcing L2 OFF)
    plan_pinned, _ = run_forward_simulation(
        candidate_links={"L1": l1, "L2": l2},
        user_overrides={"L1": OverrideState.PINNED},
        satellite_configs=sat_configs,
        conflict_structure=conflict_struct,
        asset_schedules={},
    )
    assert plan_pinned["L1"].is_scheduled is True
    assert plan_pinned["L2"].is_scheduled is False
    assert "pinned" in plan_pinned["L2"].rejection_reason.lower()
