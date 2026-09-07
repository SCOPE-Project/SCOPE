# test/test_task_repository.py
import pytest
from app.repositories import TaskRepository
from app.models.tasks import TaskStatusResponse, TaskResultResponse


def test_task_repository_lifecycle():
    TaskRepository.clear()

    # 1. Create task entry
    task_id = TaskRepository.create_task_entry()
    assert task_id is not None
    assert isinstance(task_id, str)

    # 2. Get initial status
    status = TaskRepository.get_task(task_id)
    assert status is not None
    assert isinstance(status, TaskStatusResponse)
    assert status.task_id == task_id
    assert status.status == "queued"
    assert status.progress == 0

    # 3. Update progress
    TaskRepository.update_task(task_id, status="processing", message="Calculating passes...", progress=45)
    updated_status = TaskRepository.get_task(task_id)
    assert updated_status is not None
    assert updated_status.status == "processing"
    assert updated_status.message == "Calculating passes..."
    assert updated_status.progress == 45

    # 4. Complete task
    payload_data = {"test_metric": 42, "links": ["L_01", "L_02"]}
    TaskRepository.complete_task(task_id, payload=payload_data)

    completed_status = TaskRepository.get_task(task_id)
    assert completed_status is not None
    assert completed_status.status == "completed"
    assert completed_status.progress == 100

    # 5. Get task result
    result = TaskRepository.get_task_result(task_id)
    assert result is not None
    assert isinstance(result, TaskResultResponse)
    assert result.task_id == task_id
    assert result.status == "completed"
    assert result.payload == payload_data


def test_task_repository_nonexistent_task():
    TaskRepository.clear()
    assert TaskRepository.get_task("nonexistent-id") is None
    assert TaskRepository.get_task_result("nonexistent-id") is None


def test_task_repository_clear():
    TaskRepository.clear()
    t1 = TaskRepository.create_task_entry()
    t2 = TaskRepository.create_task_entry()
    assert TaskRepository.get_task(t1) is not None
    assert TaskRepository.get_task(t2) is not None

    TaskRepository.clear()
    assert TaskRepository.get_task(t1) is None
    assert TaskRepository.get_task(t2) is None
