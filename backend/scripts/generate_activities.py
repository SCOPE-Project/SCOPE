"""
Activity Factory & Scenario Generator for SCOPE.

Provides a modular Python factory and CLI to generate synthetic activity JSON datasets
(e.g., default_activities.json) across satellites over arbitrary time windows with
customizable distribution, duration spread, and presets.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

# Ensure backend root is on sys.path if invoked directly
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.models.satos import ActivityDTO
except ImportError:
    ActivityDTO = None  # type: ignore


class DurationDistribution(str, Enum):
    UNIFORM = "uniform"
    NORMAL = "normal"
    LOGNORMAL = "lognormal"
    BETA = "beta"
    EXPONENTIAL = "exponential"


class ScenarioPreset(str, Enum):
    DEFAULT = "default"
    SKEWED_SAT1 = "skewed_sat1"
    SHORT_BURSTS = "short_bursts"
    LONG_DURATIONS = "long_durations"
    HIGH_SPREAD = "high_spread"
    TIGHT_SPREAD = "tight_spread"


@dataclass
class ActivityFactoryConfig:
    """Configuration for synthetic activity generation."""

    total_activities: int = 1000
    satellite_distribution: Union[Dict[str, float], Dict[str, int], List[str]] = field(
        default_factory=lambda: {
            "Sat1_Group1": 1 / 3,
            "Sat2_Group1": 1 / 3,
            "Sat3_Group1": 1 / 3,
        }
    )
    start_time: Union[datetime, str] = "2026-08-18T00:00:00Z"
    end_time: Union[datetime, str] = "2026-09-30T23:59:59Z"

    # Duration controls (in minutes)
    duration_min_minutes: float = 3.0
    duration_max_minutes: float = 15.0
    duration_mean_minutes: Optional[float] = 9.0
    duration_spread: float = 1.0  # 0.0 = deterministic (mean), 1.0 = standard spread, >1.0 = higher dispersion
    duration_distribution: DurationDistribution = DurationDistribution.UNIFORM

    # Spacing and scheduling
    min_gap_minutes: float = 0.5  # minimum idle gap between activities on the same satellite
    round_to_seconds: int = 60  # round start/end timestamps to nearest N seconds (60 = 1 minute)

    # Activity metadata fields
    name: str = "Payload Activity"
    description: str = "Some dummy Payload Activity"
    priority: int = 1
    status: int = 2
    initiator: str = "PL Mission Planner"
    executor: Optional[str] = None  # None = use schedule_name (satellite name)

    # Random seed for reproducible generation
    seed: Optional[int] = None

    def get_parsed_start_time(self) -> datetime:
        if isinstance(self.start_time, datetime):
            dt = self.start_time
        else:
            dt = datetime.fromisoformat(self.start_time.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def get_parsed_end_time(self) -> datetime:
        if isinstance(self.end_time, datetime):
            dt = self.end_time
        else:
            dt = datetime.fromisoformat(self.end_time.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt


class ActivityFactory:
    """Factory to generate activities and activity scenario datasets."""

    @staticmethod
    def get_preset_config(preset: Union[ScenarioPreset, str]) -> ActivityFactoryConfig:
        """Returns a pre-configured ActivityFactoryConfig for a given scenario preset."""
        preset_val = ScenarioPreset(preset) if isinstance(preset, str) else preset

        if preset_val == ScenarioPreset.DEFAULT:
            return ActivityFactoryConfig(
                total_activities=1000,
                satellite_distribution={
                    "Sat1_Group1": 1 / 3,
                    "Sat2_Group1": 1 / 3,
                    "Sat3_Group1": 1 / 3,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=3.0,
                duration_max_minutes=15.0,
                duration_mean_minutes=9.0,
                duration_spread=1.0,
                duration_distribution=DurationDistribution.UNIFORM,
                min_gap_minutes=0.5,
            )

        elif preset_val == ScenarioPreset.SKEWED_SAT1:
            return ActivityFactoryConfig(
                total_activities=1000,
                satellite_distribution={
                    "Sat1_Group1": 0.60,
                    "Sat2_Group1": 0.20,
                    "Sat3_Group1": 0.20,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=3.0,
                duration_max_minutes=15.0,
                duration_mean_minutes=8.0,
                duration_spread=1.0,
                duration_distribution=DurationDistribution.UNIFORM,
                min_gap_minutes=0.5,
            )

        elif preset_val == ScenarioPreset.SHORT_BURSTS:
            return ActivityFactoryConfig(
                total_activities=1500,
                satellite_distribution={
                    "Sat1_Group1": 1 / 3,
                    "Sat2_Group1": 1 / 3,
                    "Sat3_Group1": 1 / 3,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=1.0,
                duration_max_minutes=5.0,
                duration_mean_minutes=2.5,
                duration_spread=0.8,
                duration_distribution=DurationDistribution.UNIFORM,
                min_gap_minutes=0.2,
            )

        elif preset_val == ScenarioPreset.LONG_DURATIONS:
            return ActivityFactoryConfig(
                total_activities=400,
                satellite_distribution={
                    "Sat1_Group1": 1 / 3,
                    "Sat2_Group1": 1 / 3,
                    "Sat3_Group1": 1 / 3,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=30.0,
                duration_max_minutes=120.0,
                duration_mean_minutes=60.0,
                duration_spread=1.0,
                duration_distribution=DurationDistribution.NORMAL,
                min_gap_minutes=5.0,
            )

        elif preset_val == ScenarioPreset.HIGH_SPREAD:
            return ActivityFactoryConfig(
                total_activities=1000,
                satellite_distribution={
                    "Sat1_Group1": 1 / 3,
                    "Sat2_Group1": 1 / 3,
                    "Sat3_Group1": 1 / 3,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=2.0,
                duration_max_minutes=60.0,
                duration_mean_minutes=15.0,
                duration_spread=2.0,
                duration_distribution=DurationDistribution.LOGNORMAL,
                min_gap_minutes=1.0,
            )

        elif preset_val == ScenarioPreset.TIGHT_SPREAD:
            return ActivityFactoryConfig(
                total_activities=1000,
                satellite_distribution={
                    "Sat1_Group1": 1 / 3,
                    "Sat2_Group1": 1 / 3,
                    "Sat3_Group1": 1 / 3,
                },
                start_time="2026-08-18T00:00:00Z",
                end_time="2026-09-30T23:59:59Z",
                duration_min_minutes=9.0,
                duration_max_minutes=11.0,
                duration_mean_minutes=10.0,
                duration_spread=0.1,
                duration_distribution=DurationDistribution.NORMAL,
                min_gap_minutes=1.0,
            )

        else:
            raise ValueError(f"Unknown scenario preset: {preset}")

    @classmethod
    def create_activities(cls, config: Optional[ActivityFactoryConfig] = None, **kwargs: Any) -> Dict[str, List[Dict[str, Any]]]:
        """
        Factory method to generate synthetic activities dataset.
        
        Can accept an ActivityFactoryConfig or keyword arguments matching ActivityFactoryConfig attributes.
        Returns a dict in the exact schema of default_activities.json: {"activities": [...]}
        """
        if config is None:
            config = ActivityFactoryConfig(**kwargs)
        elif kwargs:
            # Override config fields with kwargs
            for k, v in kwargs.items():
                if hasattr(config, k):
                    setattr(config, k, v)

        rng = random.Random(config.seed)
        start_dt = config.get_parsed_start_time()
        end_dt = config.get_parsed_end_time()

        if end_dt <= start_dt:
            raise ValueError(f"End time ({end_dt}) must be strictly after start time ({start_dt}).")

        # 1. Resolve satellite counts
        sat_counts = cls._resolve_satellite_counts(config.satellite_distribution, config.total_activities)

        all_activities: List[Dict[str, Any]] = []

        # 2. For each satellite, generate non-overlapping intervals
        for sat_name, count in sat_counts.items():
            if count <= 0:
                continue

            sat_activities = cls._generate_satellite_intervals(
                sat_name=sat_name,
                count=count,
                start_dt=start_dt,
                end_dt=end_dt,
                config=config,
                rng=rng,
            )
            all_activities.extend(sat_activities)

        # 3. Sort all activities globally by start_time
        all_activities.sort(key=lambda a: a["start_time"])

        return {"activities": all_activities}

    @classmethod
    def create_dtos(cls, config: Optional[ActivityFactoryConfig] = None, **kwargs: Any) -> List[Any]:
        """
        Generate activities directly as Pydantic ActivityDTO objects.
        """
        if ActivityDTO is None:
            raise RuntimeError("ActivityDTO is not available in the current environment.")

        data = cls.create_activities(config=config, **kwargs)
        dtos: List[ActivityDTO] = []
        for item in data["activities"]:
            start_time = datetime.fromisoformat(item["start_time"].replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(item["end_time"].replace("Z", "+00:00"))
            dto = ActivityDTO(
                schedule_name=item["schedule_name"],
                start_time=start_time,
                end_time=end_time,
                name=item.get("name", ""),
                description=item.get("description", ""),
                priority=int(item.get("priority", 1)),
                status=int(item.get("status", 2)),
                initiator=item.get("initiator"),
                executor=item.get("executor"),
            )
            dtos.append(dto)
        return dtos

    @classmethod
    def save_json(
        cls,
        output_path: Union[str, Path],
        config: Optional[ActivityFactoryConfig] = None,
        indent: int = 2,
        **kwargs: Any,
    ) -> Path:
        """
        Generates activities and writes them to a formatted JSON file.
        """
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = cls.create_activities(config=config, **kwargs)
        path.write_text(json.dumps(data, indent=indent), encoding="utf-8")
        return path

    @staticmethod
    def _resolve_satellite_counts(
        sat_dist: Union[Dict[str, float], Dict[str, int], List[str]],
        total_activities: int,
    ) -> Dict[str, int]:
        """
        Allocates exact integer counts across satellites using Largest Remainder (Hamilton) method.
        """
        if isinstance(sat_dist, (list, tuple, set)):
            sats = list(sat_dist)
            if not sats:
                raise ValueError("Satellite distribution list cannot be empty.")
            weights = {s: 1.0 / len(sats) for s in sats}
        elif isinstance(sat_dist, dict):
            if not sat_dist:
                raise ValueError("Satellite distribution dictionary cannot be empty.")
            # Check if values are absolute counts that already sum to total_activities
            if all(isinstance(v, int) for v in sat_dist.values()) and sum(sat_dist.values()) == total_activities:
                return dict(sat_dist)
            total_w = sum(sat_dist.values())
            if total_w <= 0:
                raise ValueError("Sum of satellite distribution weights must be positive.")
            weights = {k: v / total_w for k, v in sat_dist.items()}
        else:
            raise TypeError(f"Unsupported satellite_distribution type: {type(sat_dist)}")

        # Largest remainder method to ensure sum(counts) == total_activities
        allocated: Dict[str, int] = {}
        remainders: List[tuple[float, str]] = []

        current_total = 0
        for sat, w in weights.items():
            exact = w * total_activities
            fl = int(math.floor(exact))
            allocated[sat] = fl
            current_total += fl
            remainders.append((exact - fl, sat))

        # Distribute remaining units to highest remainders
        remainders.sort(reverse=True, key=lambda x: x[0])
        diff = total_activities - current_total
        for i in range(diff):
            sat = remainders[i % len(remainders)][1]
            allocated[sat] += 1

        return allocated

    @classmethod
    def _sample_duration(
        cls,
        config: ActivityFactoryConfig,
        rng: random.Random,
    ) -> float:
        """
        Samples an activity duration in minutes according to configuration.
        """
        d_min = max(0.1, config.duration_min_minutes)
        d_max = max(d_min, config.duration_max_minutes)
        d_mean = config.duration_mean_minutes if config.duration_mean_minutes is not None else (d_min + d_max) / 2.0
        d_mean = max(d_min, min(d_max, d_mean))
        spread = max(0.0, config.duration_spread)

        if spread == 0.0 or math.isclose(d_min, d_max):
            return d_mean

        dist = config.duration_distribution

        if dist == DurationDistribution.UNIFORM:
            # Interpolate between mean and full uniform range using spread
            half_range = ((d_max - d_min) / 2.0) * min(1.0, spread)
            low = max(d_min, d_mean - half_range)
            high = min(d_max, d_mean + half_range)
            return rng.uniform(low, high)

        elif dist == DurationDistribution.NORMAL:
            # Standard deviation scaled by spread
            sigma = ((d_max - d_min) / 6.0) * spread
            val = rng.gauss(d_mean, max(0.001, sigma))
            return max(d_min, min(d_max, val))

        elif dist == DurationDistribution.LOGNORMAL:
            # Lognormal centered around d_mean with dispersion controlled by spread
            target_mean = d_mean
            sigma = 0.35 * spread
            mu = math.log(max(0.1, target_mean)) - 0.5 * (sigma**2)
            val = rng.lognormvariate(mu, sigma)
            return max(d_min, min(d_max, val))

        elif dist == DurationDistribution.BETA:
            # Beta distribution scaled to [d_min, d_max]
            alpha = max(1.0, 3.0 / spread)
            beta_param = max(1.0, 3.0 / spread)
            val_norm = rng.betavariate(alpha, beta_param)
            return d_min + val_norm * (d_max - d_min)

        elif dist == DurationDistribution.EXPONENTIAL:
            # Shifted exponential starting at d_min
            scale = max(0.1, (d_mean - d_min) * spread)
            val = d_min + rng.expovariate(1.0 / scale)
            return min(d_max, val)

        else:
            return rng.uniform(d_min, d_max)

    @classmethod
    def _generate_satellite_intervals(
        cls,
        sat_name: str,
        count: int,
        start_dt: datetime,
        end_dt: datetime,
        config: ActivityFactoryConfig,
        rng: random.Random,
    ) -> List[Dict[str, Any]]:
        """
        Generates non-overlapping intervals strictly within [start_dt, end_dt] for one satellite.
        Guarantees mathematical non-overlap, strict window containment, and grid snapping.
        """
        total_window_seconds = int((end_dt - start_dt).total_seconds())
        if total_window_seconds <= 0:
            raise ValueError("Total window duration must be greater than zero.")

        round_sec = max(1, config.round_to_seconds)
        min_gap_seconds = max(0, int(round((config.min_gap_minutes * 60.0) / round_sec) * round_sec))

        # 1. Sample all activity durations in seconds snapped to round_sec
        durations_sec: List[int] = []
        for _ in range(count):
            dur_min = cls._sample_duration(config, rng)
            dur_sec = max(round_sec, int(round((dur_min * 60.0) / round_sec) * round_sec))
            durations_sec.append(dur_sec)

        total_activity_sec = sum(durations_sec)
        required_gap_sec = (count - 1) * min_gap_seconds if count > 1 else 0
        total_required_sec = total_activity_sec + required_gap_sec

        # 2. Check and scale durations if capacity exceeds window
        if total_required_sec > total_window_seconds:
            avail_for_activities = total_window_seconds - required_gap_sec
            if avail_for_activities < count * round_sec:
                # If even minimum gaps cannot fit, reduce gaps to 0
                min_gap_seconds = 0
                required_gap_sec = 0
                avail_for_activities = total_window_seconds

            scale = max(0.01, avail_for_activities / float(total_activity_sec))
            print(
                f"[ActivityFactory Warning] Total required time ({total_required_sec/3600:.1f}h) for "
                f"satellite '{sat_name}' ({count} activities) exceeds available window "
                f"({total_window_seconds/3600:.1f}h). Scaling durations by factor {scale:.3f}.",
                file=sys.stderr,
            )
            # Re-scale durations to grid
            durations_sec = [
                max(round_sec, int(round((d * scale) / round_sec) * round_sec))
                for d in durations_sec
            ]
            # If rounding still slightly overruns, trim last elements
            while sum(durations_sec) + required_gap_sec > total_window_seconds:
                max_idx = max(range(len(durations_sec)), key=lambda i: durations_sec[i])
                if durations_sec[max_idx] > round_sec:
                    durations_sec[max_idx] -= round_sec
                else:
                    break

            total_activity_sec = sum(durations_sec)

        # 3. Discrete slack partition
        slack_seconds = max(0, total_window_seconds - total_activity_sec - required_gap_sec)
        slack_blocks = slack_seconds // round_sec
        num_gaps = count + 1  # gap before first, gaps between each, gap after last

        # Generate Dirichlet random weights for discrete slack blocks
        gap_weights = [rng.expovariate(1.0) for _ in range(num_gaps)]
        sum_weights = sum(gap_weights)

        # Allocate slack blocks using Largest Remainder (Hamilton) method
        slack_allocations_blocks = [0] * num_gaps
        remainders = []
        allocated_blocks = 0
        for idx, w in enumerate(gap_weights):
            exact = (w / sum_weights) * slack_blocks
            fl = int(math.floor(exact))
            slack_allocations_blocks[idx] = fl
            allocated_blocks += fl
            remainders.append((exact - fl, idx))

        remainders.sort(reverse=True, key=lambda x: x[0])
        diff = slack_blocks - allocated_blocks
        for i in range(diff):
            slack_allocations_blocks[remainders[i % len(remainders)][1]] += 1

        slack_seconds_list = [b * round_sec for b in slack_allocations_blocks]

        # 4. Construct chronological intervals
        activities: List[Dict[str, Any]] = []
        current_time = start_dt + timedelta(seconds=slack_seconds_list[0])

        for i in range(count):
            act_dur = durations_sec[i]
            act_start = current_time
            act_end = act_start + timedelta(seconds=act_dur)

            # Strict guard against rounding beyond end_dt
            if act_end > end_dt:
                act_end = end_dt

            start_str = act_start.strftime("%Y-%m-%dT%H:%M:%SZ")
            end_str = act_end.strftime("%Y-%m-%dT%H:%M:%SZ")

            executor = config.executor if config.executor is not None else sat_name

            activity_obj = {
                "schedule_name": sat_name,
                "start_time": start_str,
                "end_time": end_str,
                "name": config.name,
                "description": config.description,
                "priority": int(config.priority),
                "status": int(config.status),
                "initiator": config.initiator,
                "executor": executor,
            }
            activities.append(activity_obj)

            # Advance current time to next start
            gap_slack = slack_seconds_list[i + 1] if (i + 1) < len(slack_seconds_list) else 0
            current_time = act_end + timedelta(seconds=min_gap_seconds + gap_slack)

        return activities


# ==========================================
# Factory Helper Method (Functional API)
# ==========================================

def generate_activities_dataset(
    total_activities: int = 1000,
    satellite_distribution: Optional[Union[Dict[str, float], Dict[str, int], List[str]]] = None,
    start_time: Union[datetime, str] = "2026-08-18T00:00:00Z",
    end_time: Union[datetime, str] = "2026-09-30T23:59:59Z",
    duration_min_minutes: float = 3.0,
    duration_max_minutes: float = 15.0,
    duration_mean_minutes: Optional[float] = 9.0,
    duration_spread: float = 1.0,
    duration_distribution: Union[DurationDistribution, str] = DurationDistribution.UNIFORM,
    min_gap_minutes: float = 0.5,
    round_to_seconds: int = 60,
    name: str = "Payload Activity",
    description: str = "Some dummy Payload Activity",
    priority: int = 1,
    status: int = 2,
    initiator: str = "PL Mission Planner",
    executor: Optional[str] = None,
    seed: Optional[int] = None,
    output_path: Optional[Union[str, Path]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Convenience factory function to generate an activities dataset dictionary.
    Optionally writes to output_path if provided.
    """
    if satellite_distribution is None:
        satellite_distribution = {
            "Sat1_Group1": 1 / 3,
            "Sat2_Group1": 1 / 3,
            "Sat3_Group1": 1 / 3,
        }

    if isinstance(duration_distribution, str):
        duration_distribution = DurationDistribution(duration_distribution.lower())

    config = ActivityFactoryConfig(
        total_activities=total_activities,
        satellite_distribution=satellite_distribution,
        start_time=start_time,
        end_time=end_time,
        duration_min_minutes=duration_min_minutes,
        duration_max_minutes=duration_max_minutes,
        duration_mean_minutes=duration_mean_minutes,
        duration_spread=duration_spread,
        duration_distribution=duration_distribution,
        min_gap_minutes=min_gap_minutes,
        round_to_seconds=round_to_seconds,
        name=name,
        description=description,
        priority=priority,
        status=status,
        initiator=initiator,
        executor=executor,
        seed=seed,
    )

    data = ActivityFactory.create_activities(config)

    if output_path is not None:
        ActivityFactory.save_json(output_path, config)

    return data


# ==========================================
# CLI Interface
# ==========================================

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synthetic Activity Generator & Factory for SCOPE.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "--preset",
        type=str,
        choices=[p.value for p in ScenarioPreset],
        default=None,
        help="Scenario preset archetype (overrides default values).",
    )
    parser.add_argument(
        "--total-activities", "-n",
        type=int,
        default=1000,
        help="Total number of activities to generate across all satellites.",
    )
    parser.add_argument(
        "--satellites", "-s",
        nargs="+",
        default=["Sat1_Group1:0.334", "Sat2_Group1:0.333", "Sat3_Group1:0.333"],
        help="Satellites and their relative weights or counts formatted as Name:Weight (e.g. Sat1_Group1:0.6 Sat2_Group1:0.4).",
    )
    parser.add_argument(
        "--start-time",
        type=str,
        default="2026-08-18T00:00:00Z",
        help="Global time window start (ISO format).",
    )
    parser.add_argument(
        "--end-time",
        type=str,
        default="2026-09-30T23:59:59Z",
        help="Global time window end (ISO format).",
    )
    parser.add_argument(
        "--min-duration",
        type=float,
        default=3.0,
        help="Minimum activity duration in minutes.",
    )
    parser.add_argument(
        "--max-duration",
        type=float,
        default=15.0,
        help="Maximum activity duration in minutes.",
    )
    parser.add_argument(
        "--mean-duration",
        type=float,
        default=9.0,
        help="Mean activity duration in minutes.",
    )
    parser.add_argument(
        "--spread",
        type=float,
        default=1.0,
        help="Duration spread / variance factor (0.0 = fixed mean, 1.0 = standard, >1.0 = wide dispersion).",
    )
    parser.add_argument(
        "--distribution",
        type=str,
        choices=[d.value for d in DurationDistribution],
        default=DurationDistribution.UNIFORM.value,
        help="Duration probability distribution model.",
    )
    parser.add_argument(
        "--min-gap",
        type=float,
        default=0.5,
        help="Minimum idle gap between activities on the same satellite (minutes).",
    )
    parser.add_argument(
        "--round-seconds",
        type=int,
        default=60,
        help="Round timestamps to nearest N seconds.",
    )
    parser.add_argument(
        "--name",
        type=str,
        default="Payload Activity",
        help="Activity name field.",
    )
    parser.add_argument(
        "--description",
        type=str,
        default="Some dummy Payload Activity",
        help="Activity description field.",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=1,
        help="Activity priority integer.",
    )
    parser.add_argument(
        "--status",
        type=int,
        default=2,
        help="Activity status integer (2 = SUSPENDED).",
    )
    parser.add_argument(
        "--initiator",
        type=str,
        default="PL Mission Planner",
        help="Activity initiator field.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible outputs.",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=backend_dir / "config" / "default_activities.json",
        help="Output JSON file path.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate generation and print summary statistics without saving to file.",
    )

    return parser.parse_args()


def print_summary(data: Dict[str, List[Dict[str, Any]]], config: ActivityFactoryConfig) -> None:
    activities = data["activities"]
    print("\n========================================================")
    print("           ACTIVITY FACTORY GENERATION SUMMARY          ")
    print("========================================================")
    print(f"Total Activities Generated: {len(activities)}")

    sat_counts: Dict[str, int] = {}
    sat_durations: Dict[str, List[float]] = {}
    sat_times: Dict[str, List[tuple[datetime, datetime]]] = {}

    all_durations: List[float] = []

    for a in activities:
        sat = a["schedule_name"]
        sat_counts[sat] = sat_counts.get(sat, 0) + 1
        st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00"))
        et = datetime.fromisoformat(a["end_time"].replace("Z", "+00:00"))
        dur_m = (et - st).total_seconds() / 60.0
        all_durations.append(dur_m)

        if sat not in sat_durations:
            sat_durations[sat] = []
            sat_times[sat] = []
        sat_durations[sat].append(dur_m)
        sat_times[sat].append((st, et))

    print("\n--- Per-Satellite Breakdown ---")
    for sat, count in sat_counts.items():
        pct = (count / len(activities)) * 100.0
        durs = sat_durations[sat]
        min_d = min(durs)
        max_d = max(durs)
        avg_d = sum(durs) / len(durs)

        # Check overlaps
        times = sorted(sat_times[sat], key=lambda x: x[0])
        overlaps = 0
        min_gap = float("inf")
        for i in range(len(times) - 1):
            gap = (times[i + 1][0] - times[i][1]).total_seconds() / 60.0
            if gap < 0:
                overlaps += 1
            min_gap = min(min_gap, gap)
        min_gap_str = f"{min_gap:.1f}m" if min_gap != float("inf") else "N/A"

        print(
            f"  * {sat:12s} | Count: {count:4d} ({pct:5.1f}%) | "
            f"Durations: [{min_d:4.1f}m - {max_d:4.1f}m] (avg {avg_d:4.1f}m) | "
            f"Min Gap: {min_gap_str} | Overlaps: {overlaps}"
        )

    if all_durations:
        print("\n--- Global Statistics ---")
        print(f"  Duration Range : [{min(all_durations):.1f} min - {max(all_durations):.1f} min]")
        print(f"  Duration Mean  : {sum(all_durations)/len(all_durations):.2f} min")
        first_st = min(datetime.fromisoformat(a["start_time"].replace("Z", "+00:00")) for a in activities)
        last_et = max(datetime.fromisoformat(a["end_time"].replace("Z", "+00:00")) for a in activities)
        print(f"  Earliest Start : {first_st.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        print(f"  Latest End     : {last_et.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        print(f"  Distribution   : {config.duration_distribution.value} (Spread factor: {config.duration_spread})")
    print("========================================================\n")


def main() -> None:
    args = parse_args()

    # If preset is specified, start from preset configuration
    if args.preset:
        config = ActivityFactory.get_preset_config(args.preset)
        # Apply command-line overrides if explicitly provided
        if args.total_activities != 1000:
            config.total_activities = args.total_activities
        if args.seed is not None:
            config.seed = args.seed
        if args.start_time != "2026-08-18T00:00:00Z":
            config.start_time = args.start_time
        if args.end_time != "2026-09-30T23:59:59Z":
            config.end_time = args.end_time
    else:
        # Parse satellites input
        sat_dist: Dict[str, float] = {}
        for s_spec in args.satellites:
            if ":" in s_spec:
                sat_name, weight_str = s_spec.split(":", 1)
                sat_dist[sat_name.strip()] = float(weight_str.strip())
            else:
                sat_dist[s_spec.strip()] = 1.0

        config = ActivityFactoryConfig(
            total_activities=args.total_activities,
            satellite_distribution=sat_dist,
            start_time=args.start_time,
            end_time=args.end_time,
            duration_min_minutes=args.min_duration,
            duration_max_minutes=args.max_duration,
            duration_mean_minutes=args.mean_duration,
            duration_spread=args.spread,
            duration_distribution=DurationDistribution(args.distribution),
            min_gap_minutes=args.min_gap,
            round_to_seconds=args.round_seconds,
            name=args.name,
            description=args.description,
            priority=args.priority,
            status=args.status,
            initiator=args.initiator,
            seed=args.seed,
        )

    data = ActivityFactory.create_activities(config)
    print_summary(data, config)

    if args.dry_run:
        print("[DRY RUN] Completed. File was not written.")
    else:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Successfully wrote {len(data['activities'])} activities to '{out_path.resolve()}'")


if __name__ == "__main__":
    main()
