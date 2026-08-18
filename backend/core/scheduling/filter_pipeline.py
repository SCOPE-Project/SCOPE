# core/scheduling/filter_pipeline.py
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from core.models.domain import (
    OverpassBlock,
    OverpassProfilePoint,
    LinkBlock,
    LinkEligibilityStatus,
    PropagationResult,
)
from core.repository.propagation_repository import PropagationResultRepository
from core.repository.link_repository import LinkRepository
from app.services.asset_repository import AssetRepository


def _ensure_utc(dt: datetime) -> datetime:
    """Helper to ensure all datetimes are UTC aware for safe comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def check_peak_elevation(
    overpass: OverpassBlock,
    min_peak_elevation_deg: Optional[float] = None,
) -> bool:
    """
    Checks if an overpass reaches the required minimum peak elevation.
    Returns True if compliant or if no threshold is specified.
    """
    if min_peak_elevation_deg is None or min_peak_elevation_deg <= 0.0:
        return True
    return overpass.max_elevation_deg >= min_peak_elevation_deg


def trim_overpass_by_elevation(
    overpass: OverpassBlock,
    min_aos_los_elevation_deg: Optional[float] = None,
    min_peak_elevation_deg: Optional[float] = None,
) -> Tuple[datetime, datetime, List[OverpassProfilePoint], bool]:
    """
    Trims the overpass start and end times based on the min_aos_los_elevation_deg threshold.
    Intrinsically checks peak elevation: if the overpass fails min_peak_elevation_deg or if
    no points satisfy min_aos_los_elevation_deg, is_valid is returned as False.

    :return: (trimmed_start, trimmed_end, trimmed_trajectory, is_valid)
    """
    start_time = _ensure_utc(overpass.start_time)
    end_time = _ensure_utc(overpass.end_time)
    trajectory = overpass.high_res_trajectory or []

    # 1. Peak elevation quality check
    if not check_peak_elevation(overpass, min_peak_elevation_deg):
        return start_time, end_time, trajectory, False

    # 2. AOS/LOS elevation trimming (Optional)
    if min_aos_los_elevation_deg is None or min_aos_los_elevation_deg <= 0.0:
        return start_time, end_time, trajectory, True

    if not trajectory:
        return start_time, end_time, [], True

    # Filter trajectory points that meet the elevation threshold
    valid_points = [p for p in trajectory if p.elevation_deg >= min_aos_los_elevation_deg]

    if not valid_points:
        # No points meet the elevation threshold -> entire overpass is rejected
        return start_time, end_time, [], False

    trimmed_start = _ensure_utc(valid_points[0].timestamp)
    trimmed_end = _ensure_utc(valid_points[-1].timestamp)

    if trimmed_start >= trimmed_end:
        trimmed_end = trimmed_start

    return trimmed_start, trimmed_end, valid_points, True


def derive_and_filter_links(
    orbit_engine_run_id: str,
    min_aos_los_elevation_deg: Optional[float] = None,
    min_peak_elevation_deg: Optional[float] = None,
    default_downlink_rate_mbps: float = 25.0,
    filter_run_id: Optional[str] = None,
) -> Tuple[str, List[LinkBlock]]:
    """
    Derives candidate LinkBlocks from PropagationResult OverpassBlocks, applying:
    1. Optional min peak elevation filter.
    2. Optional min AOS/LOS elevation trimming (intrinsically filtering non-compliant passes).
    3. Collision detection against immutable baseline SatOS activities.

    Saves the resulting LinkBlocks to LinkRepository and returns (filter_run_id, links).
    """
    if filter_run_id is None:
        filter_run_id = str(uuid.uuid4())

    propagation_result: Optional[PropagationResult] = PropagationResultRepository.get_result(orbit_engine_run_id)
    if not propagation_result:
        raise ValueError(f"Propagation result for run_id '{orbit_engine_run_id}' not found in PropagationResultRepository.")

    # Get cached schedules from AssetRepository
    asset_schedules = {s.name: s.activities for s in AssetRepository.get_asset_schedules()}

    derived_links: List[LinkBlock] = []

    for idx, overpass in enumerate(propagation_result.overpass_blocks, start=1):
        link_id = f"link_{overpass.satellite_name}_{overpass.groundstation_name}_{idx:04d}_{filter_run_id[:8]}"

        # 1. Apply Trimming & Peak Elevation Filters
        trimmed_start, trimmed_end, trimmed_trajectory, is_elevation_valid = trim_overpass_by_elevation(
            overpass=overpass,
            min_aos_los_elevation_deg=min_aos_los_elevation_deg,
            min_peak_elevation_deg=min_peak_elevation_deg,
        )

        if not is_elevation_valid:
            reason = (
                f"Peak elevation {overpass.max_elevation_deg:.1f}° is below required threshold"
                if min_peak_elevation_deg is not None and overpass.max_elevation_deg < min_peak_elevation_deg
                else f"No trajectory points meet min AOS/LOS elevation {min_aos_los_elevation_deg}°"
            )
            link = LinkBlock(
                link_id=link_id,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=0.0,
                max_elevation_deg=overpass.max_elevation_deg,
                overpass_id=overpass.overpass_id,
                estimated_data_capacity_mb=0.0,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=False,
                eligibility_status=LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION,
                ineligibility_reason=reason,
            )
            derived_links.append(link)
            continue

        duration_sec = max(0.0, (trimmed_end - trimmed_start).total_seconds())
        estimated_capacity_mb = round(duration_sec * default_downlink_rate_mbps, 2)

        # 2. Check for Collisions with Immutable Baseline SatOS Activities
        sat_activities = asset_schedules.get(overpass.satellite_name, [])
        gs_activities = asset_schedules.get(overpass.groundstation_name, [])
        all_relevant_activities = [(overpass.satellite_name, act) for act in sat_activities] + \
                                 [(overpass.groundstation_name, act) for act in gs_activities]

        colliding_activity = None
        colliding_asset = None

        for asset_name, act in all_relevant_activities:
            act_start = _ensure_utc(act.start_event.timestamp)
            act_end = _ensure_utc(act.end_event.timestamp)

            # Check interval overlap: [trimmed_start, trimmed_end] overlaps with [act_start, act_end]
            if trimmed_start < act_end and trimmed_end > act_start:
                colliding_activity = act
                colliding_asset = asset_name
                break

        if colliding_activity is not None:
            act_name = colliding_activity.name or f"Activity-{colliding_activity.uuid}"
            link = LinkBlock(
                link_id=link_id,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=duration_sec,
                max_elevation_deg=overpass.max_elevation_deg,
                overpass_id=overpass.overpass_id,
                estimated_data_capacity_mb=estimated_capacity_mb,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=False,
                eligibility_status=LinkEligibilityStatus.BLOCKED_BY_BASELINE_ACTIVITY,
                ineligibility_reason=f"Collides with immutable SatOS activity '{act_name}' on {colliding_asset}",
                conflicting_activity_uuid=str(colliding_activity.uuid),
            )
        else:
            link = LinkBlock(
                link_id=link_id,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=duration_sec,
                max_elevation_deg=overpass.max_elevation_deg,
                overpass_id=overpass.overpass_id,
                estimated_data_capacity_mb=estimated_capacity_mb,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=True,
                eligibility_status=LinkEligibilityStatus.ELIGIBLE,
                ineligibility_reason=None,
                conflicting_activity_uuid=None,
            )

        derived_links.append(link)

    # Save to LinkRepository
    LinkRepository.save_links(filter_run_id, derived_links)
    return filter_run_id, derived_links
