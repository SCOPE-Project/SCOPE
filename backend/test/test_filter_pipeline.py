import pytest
import uuid
from datetime import datetime, timezone

from core.models.propagation import (
    PropagationMetadata,
    PropagationResult,
    OverpassBlock,
    OverpassProfilePoint,
)
from core.models.scheduling import (
    LinkBlock,
    LinkEligibilityStatus,
)
from core.models.activities import Activity, AssetSchedule
from app.repositories import PropagationResultRepository, LinkRepository, AssetRepository
from core.scheduling.filter_pipeline import derive_and_filter_links, check_peak_elevation, trim_overpass_by_elevation
from pydantic_models.schedule_event import ScheduleEventModel


@pytest.fixture(autouse=True)
def clean_repos():
    PropagationResultRepository.clear()
    LinkRepository.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()
    yield
    PropagationResultRepository.clear()
    LinkRepository.clear()
    AssetRepository._schedules.clear()
    AssetRepository._raw_schedules.clear()


def make_overpass(
    overpass_id: str,
    sat_name: str,
    gs_name: str,
    start_time: datetime,
    end_time: datetime,
    max_elevation: float,
    elevations: list[float],
    overpass_name: str = "",
) -> OverpassBlock:
    duration = (end_time - start_time).total_seconds()
    num_pts = len(elevations)
    pts = []
    for i, elev in enumerate(elevations):
        frac = i / max(1, num_pts - 1)
        t = datetime.fromtimestamp(start_time.timestamp() + frac * duration, tz=timezone.utc)
        pts.append(
            OverpassProfilePoint(
                timestamp=t,
                latitude_deg=0.0,
                longitude_deg=0.0,
                altitude_m=500000.0,
                elevation_deg=elev,
                azimuth_deg=180.0,
                range_m=1000000.0,
            )
        )
    return OverpassBlock(
        overpass_id=overpass_id,
        overpass_name=overpass_name or f"pass__{sat_name}__{gs_name}__001",
        satellite_name=sat_name,
        groundstation_name=gs_name,
        start_time=start_time,
        end_time=end_time,
        duration_seconds=duration,
        max_elevation_deg=max_elevation,
        high_res_trajectory=pts,
    )


def test_filter_pipeline_basic_trimming_and_peak_filter():
    run_id = "test_run_prop_01"
    start_t = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    end_t = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    # op1: Peak is 45 deg, meets min_peak_elevation=10 deg
    op1 = make_overpass("OP_0001", "Sat-1", "GS-1", start_t, end_t, 45.0, [0.0, 5.0, 45.0, 5.0, 0.0])
    # op2: Peak is 8 deg, fails min_peak_elevation=10 deg
    op2 = make_overpass("OP_0002", "Sat-1", "GS-2", start_t, end_t, 8.0, [0.0, 2.0, 8.0, 2.0, 0.0])

    prop_result = PropagationResult(
        metadata=PropagationMetadata(
            run_id=run_id,
            start_time=start_t,
            end_time=end_t,
            global_track_step_seconds=30.0,
            overpass_profile_step_seconds=10.0,
        ),
        global_tracks=[],
        overpass_blocks=[op1, op2],
    )
    PropagationResultRepository.save_result(prop_result)

    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=5.0,
        min_peak_elevation_deg=10.0,
    )
    LinkRepository.save_links(filter_run_id, links)

    assert len(links) == 2
    l1 = links[0]
    assert l1.link_id == "L_0001"
    assert l1.link_name.startswith("link__Sat-1__GS-1__filter_")
    assert l1.overpass_id == "OP_0001"
    assert l1.overpass_name == "pass__Sat-1__GS-1__001"
    assert l1.is_eligible is True
    assert l1.is_available is True
    assert l1.eligibility_status == LinkEligibilityStatus.ELIGIBLE
    assert l1.start_time > start_t
    assert l1.end_time < end_t

    l2 = links[1]
    assert l2.link_id == ""
    assert l2.link_name == ""
    assert l2.overpass_id == "OP_0002"
    assert l2.is_eligible is False
    assert l2.is_available is False
    assert l2.eligibility_status == LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION

    stored_links = LinkRepository.get_links(filter_run_id)
    assert stored_links is not None
    assert len(stored_links) == 2


def test_filter_pipeline_no_filters_applied():
    """Verify that when no filters are provided, overpasses are retained untrimmed."""
    run_id = "test_run_prop_nofilter"
    start_t = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    end_t = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    op1 = make_overpass("op_01", "Sat-1", "GS-1", start_t, end_t, 6.0, [0.0, 2.0, 6.0, 2.0, 0.0])
    prop_result = PropagationResult(
        metadata=PropagationMetadata(
            run_id=run_id, start_time=start_t, end_time=end_t,
            global_track_step_seconds=30.0, overpass_profile_step_seconds=10.0
        ),
        global_tracks=[],
        overpass_blocks=[op1],
    )
    PropagationResultRepository.save_result(prop_result)

    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=None,
        min_peak_elevation_deg=None,
    )
    LinkRepository.save_links(filter_run_id, links)

    assert len(links) == 1
    l = links[0]
    assert l.link_id == "L_0001"
    assert l.is_eligible is True
    assert l.is_available is True
    assert l.start_time == start_t
    assert l.end_time == end_t
    assert l.duration_seconds == 600.0


def test_filter_pipeline_trimming_without_compliant_points():
    """If min_aos_los_elevation_deg is 20 deg, but pass max elevation is 10 deg, reject entire pass."""
    run_id = "test_run_prop_no_compliant"
    start_t = datetime(2026, 8, 18, 10, 0, 0, tzinfo=timezone.utc)
    end_t = datetime(2026, 8, 18, 10, 10, 0, tzinfo=timezone.utc)

    op1 = make_overpass("op_01", "Sat-1", "GS-1", start_t, end_t, 10.0, [0.0, 5.0, 10.0, 5.0, 0.0])
    prop_result = PropagationResult(
        metadata=PropagationMetadata(
            run_id=run_id, start_time=start_t, end_time=end_t,
            global_track_step_seconds=30.0, overpass_profile_step_seconds=10.0
        ),
        global_tracks=[],
        overpass_blocks=[op1],
    )
    PropagationResultRepository.save_result(prop_result)

    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=20.0,
        min_peak_elevation_deg=None,
    )
    LinkRepository.save_links(filter_run_id, links)

    assert len(links) == 1
    assert links[0].link_id == ""
    assert links[0].is_eligible is False
    assert links[0].is_available is False
    assert links[0].eligibility_status == LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION


def test_filter_pipeline_baseline_collision():
    run_id = "test_run_prop_02"
    start_t = datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc)
    end_t = datetime(2026, 8, 18, 12, 10, 0, tzinfo=timezone.utc)

    op1 = make_overpass("op_03", "Sat-2", "GS-1", start_t, end_t, 50.0, [5.0, 25.0, 50.0, 25.0, 5.0])
    prop_result = PropagationResult(
        metadata=PropagationMetadata(
            run_id=run_id,
            start_time=start_t,
            end_time=end_t,
            global_track_step_seconds=30.0,
            overpass_profile_step_seconds=10.0,
        ),
        global_tracks=[],
        overpass_blocks=[op1],
    )
    PropagationResultRepository.save_result(prop_result)

    # Create conflicting activity on Sat-2
    act_start = datetime(2026, 8, 18, 12, 5, 0, tzinfo=timezone.utc)
    act_end = datetime(2026, 8, 18, 12, 15, 0, tzinfo=timezone.utc)
    act_uuid = uuid.uuid4()
    act = Activity(
        uuid=act_uuid,
        schedule_name="Sat-2",
        status=1,
        start_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_START", name="Imaging", timestamp=act_start, schedule_1="Sat-2"),
        end_event=ScheduleEventModel(uuid=uuid.uuid4(), id="ACT_END", name="Imaging End", timestamp=act_end, schedule_1="Sat-2"),
        name="Payload Imaging Pass",
    )
    AssetRepository._schedules = [AssetSchedule(name="Sat-2", activities=[act])]

    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}
    filter_run_id, links = derive_and_filter_links(
        propagation_result=prop_result,
        asset_schedules=asset_schedules,
        min_aos_los_elevation_deg=5.0,
        min_peak_elevation_deg=10.0,
    )
    LinkRepository.save_links(filter_run_id, links)

    assert len(links) == 1
    link = links[0]
    assert link.link_id == "L_0001"
    assert link.is_eligible is True
    assert link.is_available is False
    assert link.eligibility_status == LinkEligibilityStatus.BLOCKED_BY_BASELINE_ACTIVITY
    assert link.conflicting_activity_uuid == str(act_uuid)
    assert "Payload Imaging Pass" in link.ineligibility_reason
