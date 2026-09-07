# app/repositories/scheduling_session_repository.py
import threading
from typing import Dict, List, Optional

from core.models.scheduling import SchedulingSession


class SchedulingSessionRepository:
    """Thread-safe in-memory storage for interactive scheduling sessions."""

    _sessions: Dict[str, SchedulingSession] = {}
    _lock = threading.Lock()

    @classmethod
    def save_session(cls, session: SchedulingSession) -> None:
        """Stores a scheduling session, keyed by its session_id."""
        with cls._lock:
            cls._sessions[session.session_id] = session

    @classmethod
    def get_session(cls, session_id: str) -> Optional[SchedulingSession]:
        """Retrieves a session by session_id, or None if not found."""
        with cls._lock:
            return cls._sessions.get(session_id)

    @classmethod
    def list_sessions(cls) -> List[str]:
        """Returns all active session IDs."""
        with cls._lock:
            return list(cls._sessions.keys())

    @classmethod
    def delete_session(cls, session_id: str) -> None:
        """Removes a session by session_id."""
        with cls._lock:
            cls._sessions.pop(session_id, None)

    @classmethod
    def clear(cls) -> None:
        """Clears all stored sessions."""
        with cls._lock:
            cls._sessions.clear()
