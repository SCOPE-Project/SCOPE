import pytest
from datetime import datetime, timezone

from core.models.scheduling import LinkBlock, LinkEligibilityStatus
from core.scheduling.conflict_builder import build_conflict_structure


def test_conflict_builder_2sat_2gs_clique():
    """
    Tests the classic 2 Satellite / 2 Ground Station simultaneous pass scenario.
    All 4 links overlap in the exact same time window, forming a single TradeOffGroup.
    """
    t_start = datetime(2026, 8, 18, 14, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2026, 8, 18, 14, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(
        link_id="L1_Sat1_GS1",
        overpass_id="op1",
        satellite_name="Sat-1",
        groundstation_name="GS-1",
        start_time=t_start,
        end_time=t_end,
        duration_seconds=600.0,
        max_elevation_deg=45.0,
    )
    l2 = LinkBlock(
        link_id="L2_Sat1_GS2",
        overpass_id="op2",
        satellite_name="Sat-1",
        groundstation_name="GS-2",
        start_time=t_start,
        end_time=t_end,
        duration_seconds=600.0,
        max_elevation_deg=45.0,
    )
    l3 = LinkBlock(
        link_id="L3_Sat2_GS1",
        overpass_id="op3",
        satellite_name="Sat-2",
        groundstation_name="GS-1",
        start_time=t_start,
        end_time=t_end,
        duration_seconds=600.0,
        max_elevation_deg=45.0,
    )
    l4 = LinkBlock(
        link_id="L4_Sat2_GS2",
        overpass_id="op4",
        satellite_name="Sat-2",
        groundstation_name="GS-2",
        start_time=t_start,
        end_time=t_end,
        duration_seconds=600.0,
        max_elevation_deg=45.0,
    )

    conflict_struct = build_conflict_structure([l1, l2, l3, l4])

    # L1 conflicts with L2 (same sat) and L3 (same GS)
    assert conflict_struct.adjacency_list["L1_Sat1_GS1"] == {"L2_Sat1_GS2", "L3_Sat2_GS1"}
    assert conflict_struct.adjacency_list["L4_Sat2_GS2"] == {"L2_Sat1_GS2", "L3_Sat2_GS1"}

    # All 4 should belong to exactly one TradeOffGroup
    assert len(conflict_struct.trade_off_groups) == 1
    group = list(conflict_struct.trade_off_groups.values())[0]
    assert set(group.link_ids) == {"L1_Sat1_GS1", "L2_Sat1_GS2", "L3_Sat2_GS1", "L4_Sat2_GS2"}
    assert group.participating_satellites == ["Sat-1", "Sat-2"]
    assert group.participating_groundstations == ["GS-1", "GS-2"]
    assert group.is_trivial is False
    assert group.tradeoff_id == "TOG-0001"


def test_conflict_builder_isolated_passes():
    """Tests two completely disjoint passes in separate time windows."""
    t1_s = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    t1_e = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)
    t2_s = datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc)
    t2_e = datetime(2026, 8, 18, 12, 10, 0, tzinfo=timezone.utc)

    l1 = LinkBlock(
        link_id="L1", overpass_id="op1", satellite_name="Sat-1", groundstation_name="GS-1",
        start_time=t1_s, end_time=t1_e, duration_seconds=600.0, max_elevation_deg=50.0
    )
    l2 = LinkBlock(
        link_id="L2", overpass_id="op2", satellite_name="Sat-2", groundstation_name="GS-2",
        start_time=t2_s, end_time=t2_e, duration_seconds=600.0, max_elevation_deg=50.0
    )

    conflict_struct = build_conflict_structure([l1, l2])

    assert len(conflict_struct.trade_off_groups) == 2
    assert conflict_struct.adjacency_list["L1"] == set()
    assert conflict_struct.adjacency_list["L2"] == set()

    for g in conflict_struct.trade_off_groups.values():
        assert g.is_trivial is True
