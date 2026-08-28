# core/models/activities.py
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
from pydantic import UUID4, UUID7
from pydantic_models.schedule_event import ScheduleEventModel


@dataclass
class Activity:
    uuid: UUID4 | UUID7
    schedule_name: str
    status: int
    start_event: Optional[ScheduleEventModel] = None
    end_event: Optional[ScheduleEventModel] = None
    name: str = ""
    description: str = ""
    priority: int = 0
    initiator: Optional[str] = None
    executor: Optional[str] = None


@dataclass
class AssetSchedule:
    name: str
    activities: List[Activity]
