# core/scheduling/strategy.py
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from core.models.scheduling import (
    LinkBlock,
    OverrideState,
    SatelliteBufferConfig,
    ConflictStructure,
    ScheduledLinkStatus,
    SatelliteBufferProfile,
)
from core.models.activities import Activity


# =====================================================================
# Scoring Strategy Interface & Implementations
# =====================================================================

class BaseScoringRule(ABC):
    """Abstract base class for all link scoring strategies."""

    @abstractmethod
    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        """
        Computes the priority score and the useful data offload for a candidate link.

        :return: (score, useful_data_offloaded_mb)
        """
        pass


def _get_pass_capacity(link: LinkBlock, satellite_config: SatelliteBufferConfig) -> float:
    if link.estimated_data_capacity_mb > 0.0:
        return link.estimated_data_capacity_mb
    if link.duration_seconds > 0.0 and satellite_config.downlink_rate_mbps > 0.0:
        return link.duration_seconds * satellite_config.downlink_rate_mbps
    return 0.0


class BufferUrgencyScoringRule(BaseScoringRule):
    """
    Non-linear buffer urgency scoring rule:
    Score = UsefulData * (1.0 + alpha * (Buffer / Capacity)^exponent)
    """

    def __init__(self, alpha: float = 2.0, exponent: float = 2.0):
        self.alpha = float(alpha)
        self.exponent = float(exponent)

    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = _get_pass_capacity(link, satellite_config)
        useful_data = min(current_buffer_mb, pass_capacity)

        capacity = satellite_config.capacity_mb
        buffer_ratio = (current_buffer_mb / capacity) if capacity > 0 else 0.0
        urgency = 1.0 + self.alpha * (buffer_ratio ** self.exponent)
        return useful_data * urgency, useful_data


class ThroughputScoringRule(BaseScoringRule):
    """Linear throughput scoring: Score = UsefulData."""

    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = _get_pass_capacity(link, satellite_config)
        useful_data = min(current_buffer_mb, pass_capacity)
        return useful_data, useful_data


class DurationScoringRule(BaseScoringRule):
    """Duration scoring: Score = Overpass Duration in seconds."""

    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = _get_pass_capacity(link, satellite_config)
        useful_data = min(current_buffer_mb, pass_capacity)
        return float(link.duration_seconds), useful_data


# Registered Scoring Rules
SCORING_RULE_REGISTRY = {
    "buffer_overflow_avoidance": BufferUrgencyScoringRule,
    "max_downlink_throughput": ThroughputScoringRule,
    "max_pass_duration": DurationScoringRule,
}


def get_scoring_rule(strategy_name: str, **kwargs) -> BaseScoringRule:
    """Factory resolver for scoring strategy instances."""
    cls = SCORING_RULE_REGISTRY.get(strategy_name.lower())
    if cls is None:
        cls = BufferUrgencyScoringRule

    if cls is BufferUrgencyScoringRule:
        alpha = kwargs.get("alpha", 2.0)
        exponent = kwargs.get("exponent", 2.0)
        return BufferUrgencyScoringRule(alpha=alpha, exponent=exponent)

    return cls()


# =====================================================================
# Scheduler Engine Interface
# =====================================================================

class BaseScheduler(ABC):
    """Abstract base class for all scheduling engines (Greedy, ILP, etc.)."""

    @abstractmethod
    def solve(
        self,
        candidate_links: Dict[str, LinkBlock],
        user_overrides: Dict[str, OverrideState],
        satellite_configs: Dict[str, SatelliteBufferConfig],
        conflict_structure: ConflictStructure,
        asset_schedules: Dict[str, List[Activity]],
        scoring_rule: BaseScoringRule,
        scenario_start: datetime,
        scenario_end: datetime,
    ) -> Tuple[Dict[str, ScheduledLinkStatus], Dict[str, SatelliteBufferProfile]]:
        """
        Executes scheduling optimization under user overrides and constraints.

        :return: (current_plan, satellite_buffer_profiles)
        """
        pass
