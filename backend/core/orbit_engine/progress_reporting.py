# core/orbit_engine/progress_reporting.py

from typing import Callable


# ==========================================
# PROGRESS REPORTING
def report_progress(
    task_id: str,
    message: str,
    progress: int,
    on_progress_update: Callable[[str, str, int], None] | None,
) -> None:
    """Send a bounded progress update when a callback is available."""
    if on_progress_update is None:
        return

    bounded_progress = max(0, min(100, int(progress)))
    on_progress_update(task_id, message, bounded_progress)
