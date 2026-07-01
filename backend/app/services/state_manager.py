import uuid
import threading
from datetime import datetime
from typing import Dict, Any, Optional
from app.models.tasks import TaskStatusResponse, TaskResultResponse

class InMemoryStateManager:
    """Encapsulates task state storage in-memory with thread-safe operations."""
    def __init__(self):
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create_task_entry(self) -> str:
        task_id = str(uuid.uuid4())
        with self._lock:
            self._tasks[task_id] = {
                "task_id": task_id,
                "status": "queued",
                "message": "Task queued in background.",
                "progress": 0,
                "created_at": datetime.now(),
                "payload": None
            }
        return task_id

    def update_task(self, task_id: str, status: str, message: str, progress: int) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update({
                    "status": status,
                    "message": message,
                    "progress": progress
                })

    def complete_task(self, task_id: str, payload: Any) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update({
                    "status": "completed",
                    "message": "Task completed successfully.",
                    "progress": 100,
                    "payload": payload
                })

    def get_task(self, task_id: str) -> Optional[TaskStatusResponse]:
        with self._lock:
            # Return a copy to prevent external mutations from bypassing the lock
            task = self._tasks.get(task_id)
            if task:
                return TaskStatusResponse.model_validate(task)
            return None

    def get_task_result(self, task_id: str) -> Optional[TaskResultResponse]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task:
                return TaskResultResponse(
                    task_id=task_id,
                    status=task.get("status", "completed"),
                    payload=task.get("payload")
                )
            return None


# Instantiate the private singleton instance
_manager = InMemoryStateManager()

# Expose standard module functions that delegate to the manager instance
def create_task_entry() -> str:
    return _manager.create_task_entry()

def update_task(task_id: str, status: str, message: str, progress: int) -> None:
    _manager.update_task(task_id, status, message, progress)

def complete_task(task_id: str, payload: Any) -> None:
    _manager.complete_task(task_id, payload)

def get_task(task_id: str) -> Optional[TaskStatusResponse]:
    return _manager.get_task(task_id)

def get_task_result(task_id: str) -> Optional[TaskResultResponse]:
    return _manager.get_task_result(task_id)