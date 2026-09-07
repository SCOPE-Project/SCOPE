# app/repositories/task_repository.py
import uuid
import threading
from datetime import datetime
from typing import Dict, Any, Optional

from app.models.tasks import TaskStatusResponse, TaskResultResponse


class TaskRepository:
    """Thread-safe in-memory storage for task status and execution payloads."""

    _tasks: Dict[str, Dict[str, Any]] = {}
    _lock = threading.Lock()

    @classmethod
    def create_task_entry(cls) -> str:
        """Initializes a new task entry in the queued state and returns its unique task_id."""
        task_id = str(uuid.uuid4())
        with cls._lock:
            cls._tasks[task_id] = {
                "task_id": task_id,
                "status": "queued",
                "message": "Task queued in background.",
                "progress": 0,
                "created_at": datetime.now(),
                "payload": None,
            }
        return task_id

    @classmethod
    def update_task(cls, task_id: str, status: str, message: str, progress: int) -> None:
        """Updates status, message, and progress percentage for a task."""
        with cls._lock:
            if task_id in cls._tasks:
                cls._tasks[task_id].update({
                    "status": status,
                    "message": message,
                    "progress": progress,
                })

    @classmethod
    def complete_task(cls, task_id: str, payload: Any) -> None:
        """Marks a task as completed with progress 100% and stores the result payload."""
        with cls._lock:
            if task_id in cls._tasks:
                cls._tasks[task_id].update({
                    "status": "completed",
                    "message": "Task completed successfully.",
                    "progress": 100,
                    "payload": payload,
                })

    @classmethod
    def get_task(cls, task_id: str) -> Optional[TaskStatusResponse]:
        """Retrieves current task metadata and progress validated into TaskStatusResponse, or None."""
        with cls._lock:
            task = cls._tasks.get(task_id)
            if task:
                return TaskStatusResponse.model_validate(task)
            return None

    @classmethod
    def get_task_result(cls, task_id: str) -> Optional[TaskResultResponse]:
        """Retrieves completed task result payload into TaskResultResponse, or None."""
        with cls._lock:
            task = cls._tasks.get(task_id)
            if task:
                return TaskResultResponse(
                    task_id=task_id,
                    status=task.get("status", "completed"),
                    payload=task.get("payload"),
                )
            return None

    @classmethod
    def clear(cls) -> None:
        """Clears all stored tasks in memory."""
        with cls._lock:
            cls._tasks.clear()
