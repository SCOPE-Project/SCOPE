# core/scheduling/strategy.py
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple

from core.models.domain import (
    LinkBlock,
    OverrideState,
    SatelliteBufferConfig,
    ConflictStructure,
    ScheduledLinkStatus,
    SatelliteBufferProfile,
)
from app.models.tasks import Activity


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


class BufferUrgencyScoringRule(BaseScoringRule):
    """
    Non-linear buffer urgency scoring rule:
    Score = UsefulData * (1.0 + alpha * (Buffer / Capacity)^exponent)
    """
    def __init__(self, alpha: float = 2.0, exponent: float = 2.0):
        self.alpha = alpha
        self.exponent = exponent

    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = link.duration_seconds * satellite_config.downlink_rate_mbps
        useful_data = min(current_buffer_mb, pass_capacity)

        capacity = satellite_config.capacity_mb
        buffer_ratio = (current_buffer_mb / capacity) if capacity > 0 else 0.0
        urgency = 1.0 + self.alpha * (buffer_ratio ** self.exponent)
        score = useful_data * urgency
        return score, useful_data


class ThroughputScoringRule(BaseScoringRule):
    """Linear data throughput scoring rule (maximizes raw megabytes offloaded)."""
    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = link.duration_seconds * satellite_config.downlink_rate_mbps
        useful_data = min(current_buffer_mb, pass_capacity)
        return useful_data, useful_data


class DurationScoringRule(BaseScoringRule):
    """Pure geometric pass duration scoring rule."""
    def compute_score(
        self,
        link: LinkBlock,
        current_buffer_mb: float,
        satellite_config: SatelliteBufferConfig,
    ) -> Tuple[float, float]:
        pass_capacity = link.duration_seconds * satellite_config.downlink_rate_mbps
        useful_data = min(current_buffer_mb, pass_capacity)
        return link.duration_seconds, useful_data


# Registry helper for instantiating scoring rules by name/config
SCORING_RULE_REGISTRY = {
    "buffer_overflow_avoidance": BufferUrgencyScoringRule,
    "max_downlink_throughput": ThroughputScoringRule,
    "max_pass_duration": DurationScoringRule,
}

def get_scoring_rule(name: str, **kwargs) -> BaseScoringRule:
    """Factory helper to obtain a scoring rule instance by name."""
    cls = SCORING_RULE_REGISTRY.get(name.lower(), BufferUrgencyScoringRule)
    if cls is BufferUrgencyScoringRule:
        alpha = kwargs.get("alpha", kwargs.get("urgency_alpha", 2.0))
        exponent = kwargs.get("exponent", 2.0)
        return BufferUrgencyScoringRule(alpha=alpha, exponent=exponent)
    return cls()


# =====================================================================
# Solver / Scheduler Interface
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
    ) -> Tuple[Dict[str, ScheduledLinkStatus], Dict[str, SatelliteBufferProfile]]:
        """
        Executes scheduling optimization under user overrides and constraints.

        :return: (current_plan, satellite_buffer_profiles)
        """
        pass
