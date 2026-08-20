# app/repositories/link_repository.py
import threading
from typing import Dict, List, Optional
from core.models.scheduling import LinkBlock


class LinkRepository:
    """Thread-safe in-memory storage for filtered LinkBlocks."""
    
    _links_by_run: Dict[str, List[LinkBlock]] = {}
    _lock = threading.Lock()

    @classmethod
    def save_links(cls, filter_run_id: str, links: List[LinkBlock]) -> None:
        """Stores a list of LinkBlocks, keyed by their filter_run_id."""
        with cls._lock:
            cls._links_by_run[filter_run_id] = list(links)

    @classmethod
    def get_links(cls, filter_run_id: str) -> Optional[List[LinkBlock]]:
        """Retrieves all LinkBlocks for a given filter_run_id, or None if not found."""
        with cls._lock:
            links = cls._links_by_run.get(filter_run_id)
            return list(links) if links is not None else None

    @classmethod
    def get_link(cls, filter_run_id: str, link_id: str) -> Optional[LinkBlock]:
        """Retrieves a specific LinkBlock by filter_run_id and link_id."""
        with cls._lock:
            links = cls._links_by_run.get(filter_run_id)
            if links:
                for link in links:
                    if link.link_id == link_id:
                        return link
            return None

    @classmethod
    def list_runs(cls) -> List[str]:
        """Lists all stored filter_run_ids."""
        with cls._lock:
            return sorted(list(cls._links_by_run.keys()))

    @classmethod
    def delete_run(cls, filter_run_id: str) -> None:
        """Deletes stored links for a filter_run_id."""
        with cls._lock:
            cls._links_by_run.pop(filter_run_id, None)

    @classmethod
    def clear(cls) -> None:
        """Clears all stored links in memory."""
        with cls._lock:
            cls._links_by_run.clear()
