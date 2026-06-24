"""Tiny in-memory task runner for the standalone orbit-processing prototype."""

from __future__ import annotations

import threading
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from models_test import DEFAULT_PROPAGATION_SECONDS, OrbitProcessingTaskState, SAMPLE_OMM_XML
from orekit_service_test import propagate_omm_xml


_TASKS: dict[str, OrbitProcessingTaskState] = {}
_TASKS_LOCK = threading.Lock()


def _save_task(task: OrbitProcessingTaskState) -> None:
    with _TASKS_LOCK:
        _TASKS[task.task_id] = task


def get_orbit_processing_task(task_id: str) -> OrbitProcessingTaskState:
    """Return a snapshot of one in-memory task."""
    with _TASKS_LOCK:
        if task_id not in _TASKS:
            raise KeyError(f"Unknown orbit processing task: {task_id}")
        return deepcopy(_TASKS[task_id])


def _run_task(
    task_id: str,
    omm_xml: str,
    propagation_seconds: float,
    orekit_data_path: str | Path | None,
    download_orekit_data: bool,
) -> None:
    task = get_orbit_processing_task(task_id)
    task.status = "running"
    task.logs.append("Starting Python Orekit OMM propagation.")
    _save_task(task)

    try:
        result = propagate_omm_xml(
            omm_xml=omm_xml,
            propagation_seconds=propagation_seconds,
            orekit_data_path=orekit_data_path,
            download_orekit_data=download_orekit_data,
        )
        task = get_orbit_processing_task(task_id)
        task.status = "completed"
        task.logs.append("Propagation completed.")
        task.result = result
        _save_task(task)
    except Exception as exc:  # pragma: no cover - preserved in task state for manual smoke runs
        task = get_orbit_processing_task(task_id)
        task.status = "failed"
        task.logs.append("Propagation failed.")
        task.error = str(exc)
        _save_task(task)


def start_orbit_processing_task(
    omm_xml: str = SAMPLE_OMM_XML,
    propagation_seconds: float = DEFAULT_PROPAGATION_SECONDS,
    orekit_data_path: str | Path | None = None,
    download_orekit_data: bool = True,
    run_async: bool = False,
) -> OrbitProcessingTaskState:
    """Start one standalone orbit-processing task."""
    task_id = f"prop_{uuid4().hex[:12]}"
    task = OrbitProcessingTaskState(
        task_id=task_id,
        status="queued",
        logs=["Task accepted."],
    )
    _save_task(task)

    if run_async:
        thread = threading.Thread(
            target=_run_task,
            args=(task_id, omm_xml, propagation_seconds, orekit_data_path, download_orekit_data),
            daemon=True,
        )
        thread.start()
        return get_orbit_processing_task(task_id)

    _run_task(task_id, omm_xml, propagation_seconds, orekit_data_path, download_orekit_data)
    return get_orbit_processing_task(task_id)
