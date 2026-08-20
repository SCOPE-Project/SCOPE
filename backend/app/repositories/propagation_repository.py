# app/repositories/propagation_repository.py
import threading
from typing import Dict, List, Optional
from core.models.propagation import PropagationResult


class PropagationResultRepository:
    """Thread-safe in-memory storage for orbit propagation results."""
    
    _results: Dict[str, PropagationResult] = {}
    _lock = threading.Lock()

    @classmethod
    def save_result(cls, result: PropagationResult) -> None:
        """Stores a propagation result, keyed by its run_id."""
        with cls._lock:
            cls._results[result.metadata.run_id] = result

    @classmethod
    def get_result(cls, run_id: str) -> Optional[PropagationResult]:
        """Retrieves a propagation result by run_id, or None if not found."""
        with cls._lock:
            return cls._results.get(run_id)

    @classmethod
    def list_results(cls) -> List[PropagationResult]:
        """Retrieves all propagation results currently stored in memory."""
        with cls._lock:
            return list(cls._results.values())

    @classmethod
    def delete_result(cls, run_id: str) -> None:
        """Deletes a propagation result by run_id."""
        with cls._lock:
            cls._results.pop(run_id, None)

    @classmethod
    def clear(cls) -> None:
        """Clears all stored propagation results in memory."""
        with cls._lock:
            cls._results.clear()
