# core/scheduling/filter_pipeline.py
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple, Dict

from core.models.propagation import (
    OverpassBlock,
    OverpassProfilePoint,
    PropagationResult,
)
from core.models.scheduling import (
    LinkBlock,
    LinkEligibilityStatus,
)
from core.models.activities import Activity


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
    propagation_result: PropagationResult,
    asset_schedules: Optional[Dict[str, List[Activity]]] = None,
    min_aos_los_elevation_deg: Optional[float] = None,
    min_peak_elevation_deg: Optional[float] = None,
    default_downlink_rate_mbps: float = 25.0,
    satellite_downlink_rates_mbps: Optional[Dict[str, float]] = None,
    filter_run_id: Optional[str] = None,
) -> Tuple[str, List[LinkBlock]]:
    """
    Derives candidate LinkBlocks from PropagationResult OverpassBlocks, applying:
    1. Optional min peak elevation filter.
    2. Optional min AOS/LOS elevation trimming (intrinsically filtering non-compliant passes).
    3. Collision detection against immutable baseline SatOS activities.

    Returns (filter_run_id, links).
    """
    if filter_run_id is None:
        filter_run_id = str(uuid.uuid4())

    schedules_map = asset_schedules or {}
    sat_downlink_rates = satellite_downlink_rates_mbps or {}
    derived_links: List[LinkBlock] = []

    link_counter = 0

    for overpass in propagation_result.overpass_blocks:
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
                link_id="",
                link_name="",
                overpass_id=overpass.overpass_id,
                overpass_name=overpass.overpass_name,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=0.0,
                max_elevation_deg=overpass.max_elevation_deg,
                estimated_data_capacity_mb=0.0,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=False,
                is_available=False,
                eligibility_status=LinkEligibilityStatus.EXCLUDED_BY_PEAK_ELEVATION,
                ineligibility_reason=reason,
            )
            derived_links.append(link)
            continue

        # Eligible potential link -> assign next contiguous link_id
        link_counter += 1
        link_id = f"L_{link_counter:04d}"
        link_name = f"link__{overpass.satellite_name}__{overpass.groundstation_name}__filter_{filter_run_id[:8]}__{link_counter:04d}"

        dl_rate = sat_downlink_rates.get(overpass.satellite_name, default_downlink_rate_mbps)
        duration_sec = max(0.0, (trimmed_end - trimmed_start).total_seconds())
        estimated_capacity_mb = round(duration_sec * dl_rate, 2)

        # 2. Check for Collisions with Immutable Baseline SatOS Activities
        sat_activities = schedules_map.get(overpass.satellite_name, [])
        gs_activities = schedules_map.get(overpass.groundstation_name, [])
        all_relevant_activities = [(overpass.satellite_name, act) for act in sat_activities] + \
                                 [(overpass.groundstation_name, act) for act in gs_activities]

        colliding_activity = None
        colliding_asset = None

        for asset_name, act in all_relevant_activities:
            if not act.start_event or getattr(act.start_event, "timestamp", None) is None:
                continue
            if not act.end_event or getattr(act.end_event, "timestamp", None) is None:
                continue
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
                link_name=link_name,
                overpass_id=overpass.overpass_id,
                overpass_name=overpass.overpass_name,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=duration_sec,
                max_elevation_deg=overpass.max_elevation_deg,
                estimated_data_capacity_mb=estimated_capacity_mb,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=True,
                is_available=False,
                eligibility_status=LinkEligibilityStatus.BLOCKED_BY_BASELINE_ACTIVITY,
                ineligibility_reason=f"Collides with immutable SatOS activity '{act_name}' on {colliding_asset}",
                conflicting_activity_uuid=str(colliding_activity.uuid),
            )
        else:
            link = LinkBlock(
                link_id=link_id,
                link_name=link_name,
                overpass_id=overpass.overpass_id,
                overpass_name=overpass.overpass_name,
                satellite_name=overpass.satellite_name,
                groundstation_name=overpass.groundstation_name,
                start_time=trimmed_start,
                end_time=trimmed_end,
                duration_seconds=duration_sec,
                max_elevation_deg=overpass.max_elevation_deg,
                estimated_data_capacity_mb=estimated_capacity_mb,
                high_res_trajectory=trimmed_trajectory,
                is_eligible=True,
                is_available=True,
                eligibility_status=LinkEligibilityStatus.ELIGIBLE,
                ineligibility_reason=None,
                conflicting_activity_uuid=None,
            )

        derived_links.append(link)

    return filter_run_id, derived_links
