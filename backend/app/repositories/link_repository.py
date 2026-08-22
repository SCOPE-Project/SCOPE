# app/repositories/link_repository.py
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from core.models.scheduling import LinkBlock


class LinkRepository:
    """Thread-safe in-memory storage for filtered LinkBlocks and run metadata."""
    
    _links_by_run: Dict[str, List[LinkBlock]] = {}
    _metadata_by_run: Dict[str, Dict[str, Any]] = {}
    _lock = threading.Lock()

    @classmethod
    def save_links(
        cls,
        filter_run_id: str,
        links: List[LinkBlock],
        orbit_engine_run_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Stores a list of LinkBlocks and associated scenario metadata, keyed by filter_run_id."""
        with cls._lock:
            cls._links_by_run[filter_run_id] = list(links)
            meta = dict(metadata or {})
            if orbit_engine_run_id is not None:
                meta["orbit_engine_run_id"] = orbit_engine_run_id
            if start_time is not None:
                meta["start_time"] = start_time
            if end_time is not None:
                meta["end_time"] = end_time
            cls._metadata_by_run[filter_run_id] = meta

    @classmethod
    def get_links(cls, filter_run_id: str) -> Optional[List[LinkBlock]]:
        """Retrieves all LinkBlocks for a given filter_run_id, or None if not found."""
        with cls._lock:
            links = cls._links_by_run.get(filter_run_id)
            return list(links) if links is not None else None

    @classmethod
    def get_metadata(cls, filter_run_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves scenario and propagation metadata for a given filter_run_id, or None if not found."""
        with cls._lock:
            meta = cls._metadata_by_run.get(filter_run_id)
            return dict(meta) if meta is not None else None

    @classmethod
    def get_time_window(cls, filter_run_id: str) -> Tuple[Optional[datetime], Optional[datetime]]:
        """Retrieves (start_time, end_time) tuple for a given filter_run_id."""
        with cls._lock:
            meta = cls._metadata_by_run.get(filter_run_id)
            if meta:
                return meta.get("start_time"), meta.get("end_time")
            return None, None

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
        """Deletes stored links and metadata for a filter_run_id."""
        with cls._lock:
            cls._links_by_run.pop(filter_run_id, None)
            cls._metadata_by_run.pop(filter_run_id, None)

    @classmethod
    def clear(cls) -> None:
        """Clears all stored links and metadata in memory."""
        with cls._lock:
            cls._links_by_run.clear()
            cls._metadata_by_run.clear()

