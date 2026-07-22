# core/orbit_engine/time_utils.py

from datetime import datetime, timezone


# ==========================================
# TIME FORMATTING
def normalize_datetime_to_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime.

    Naive datetimes are treated as UTC because API callers may send timestamps
    without explicit timezone information.
    """
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def to_utc_iso_string(value: datetime) -> str:
    """Return a UTC ISO timestamp for JSON-friendly engine output."""
    utc_datetime = normalize_datetime_to_utc(value)
    return utc_datetime.isoformat().replace("+00:00", "Z")
