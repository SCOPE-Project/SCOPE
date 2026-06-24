"""Shared models and constants for the standalone OMM propagation prototype."""

from __future__ import annotations

import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator


REPO_ROOT = Path(__file__).resolve().parents[2]
SATOS_SDK_SRC = REPO_ROOT / "libs" / "GS1_Group1_sdk" / "src"
DEFAULT_OREKIT_DATA_PATH = REPO_ROOT / "orekit-data.zip"

ORBIT_OMM_VARIABLE_NAME = "orbit_omm_xml"
ORBIT_OMM_VARIABLE_DESCRIPTION = "Latest CCSDS OMM XML message used as Python Orekit propagation seed."
DEFAULT_PROPAGATION_SECONDS = 600.0

# CelesTrak-style ISS OMM XML, normalized with non-empty mandatory header fields
# so Orekit can parse it without relying on live network data.
SAMPLE_OMM_XML = """<?xml version="1.0" encoding="UTF-8"?>
<omm id="CCSDS_OMM_VERS" version="2.0">
  <header>
    <CREATION_DATE>2026-06-23T16:53:55.777920</CREATION_DATE>
    <ORIGINATOR>CELESTRAK</ORIGINATOR>
  </header>
  <body>
    <segment>
      <metadata>
        <OBJECT_NAME>ISS (ZARYA)</OBJECT_NAME>
        <OBJECT_ID>1998-067A</OBJECT_ID>
        <CENTER_NAME>EARTH</CENTER_NAME>
        <REF_FRAME>TEME</REF_FRAME>
        <TIME_SYSTEM>UTC</TIME_SYSTEM>
        <MEAN_ELEMENT_THEORY>SGP4</MEAN_ELEMENT_THEORY>
      </metadata>
      <data>
        <meanElements>
          <EPOCH>2026-06-23T16:53:55.777920</EPOCH>
          <MEAN_MOTION>15.49389560</MEAN_MOTION>
          <ECCENTRICITY>.00044483</ECCENTRICITY>
          <INCLINATION>51.6324</INCLINATION>
          <RA_OF_ASC_NODE>267.8348</RA_OF_ASC_NODE>
          <ARG_OF_PERICENTER>222.5563</ARG_OF_PERICENTER>
          <MEAN_ANOMALY>137.5081</MEAN_ANOMALY>
        </meanElements>
        <tleParameters>
          <EPHEMERIS_TYPE>0</EPHEMERIS_TYPE>
          <CLASSIFICATION_TYPE>U</CLASSIFICATION_TYPE>
          <NORAD_CAT_ID>25544</NORAD_CAT_ID>
          <ELEMENT_SET_NO>999</ELEMENT_SET_NO>
          <REV_AT_EPOCH>57276</REV_AT_EPOCH>
          <BSTAR>.14592391E-3</BSTAR>
          <MEAN_MOTION_DOT>.7707E-4</MEAN_MOTION_DOT>
          <MEAN_MOTION_DDOT>0</MEAN_MOTION_DDOT>
        </tleParameters>
      </data>
    </segment>
  </body>
</omm>
"""


def ensure_satos_sdk_on_path() -> None:
    """Make the downloaded SatOS SDK importable for standalone scripts."""
    sdk_src = str(SATOS_SDK_SRC)
    if SATOS_SDK_SRC.exists() and sdk_src not in sys.path:
        sys.path.insert(0, sdk_src)


def orbit_omm_variable_id(satellite_name: str) -> str:
    """Return the SatOS telemetry id for the root-level OMM XML variable."""
    clean_name = satellite_name.strip()
    if not clean_name:
        raise ValueError("satellite_name must not be empty")
    return f"{clean_name}.{ORBIT_OMM_VARIABLE_NAME}"


class SatOSVersion(BaseModel):
    """Small local version model that can be converted to the SDK VersionModel."""

    major: int = Field(ge=0)
    minor: int = Field(ge=0)
    patch: int = Field(ge=0)

    @classmethod
    def from_string(cls, version: str) -> "SatOSVersion":
        parts = version.strip().split(".")
        if len(parts) != 3:
            raise ValueError("Version must use MAJOR.MINOR.PATCH format")
        return cls(major=int(parts[0]), minor=int(parts[1]), patch=int(parts[2]))

    def to_sdk_version_model(self):
        ensure_satos_sdk_on_path()
        from pydantic_models.definitions import VersionModel

        return VersionModel(major=self.major, minor=self.minor, patch=self.patch)


class OrbitOmmTelemetryInput(BaseModel):
    """Input contract for building SatOS OMM telemetry."""

    satellite_name: str
    omm_xml: str = Field(min_length=1)
    version: SatOSVersion = Field(default_factory=lambda: SatOSVersion(major=1, minor=0, patch=0))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    validity: bool = True

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_be_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must be timezone-aware")
        return value

    @property
    def telemetry_id(self) -> str:
        return orbit_omm_variable_id(self.satellite_name)


class OrbitPropagationResult(BaseModel):
    """Serializable result from the Python Orekit hello-world propagation."""

    object_name: str | None
    object_id: str | None
    mean_element_theory: str
    tle_line_1: str
    tle_line_2: str
    epoch_utc: datetime
    target_utc: datetime
    propagation_seconds: float
    frame: str
    position_m: tuple[float, float, float]
    velocity_m_per_s: tuple[float, float, float]

    def is_finite(self) -> bool:
        values = (*self.position_m, *self.velocity_m_per_s)
        return all(math.isfinite(value) for value in values)


class OrbitProcessingTaskState(BaseModel):
    """In-memory task state for the standalone background-task prototype."""

    task_id: str
    status: Literal["queued", "running", "completed", "failed"]
    logs: list[str] = Field(default_factory=list)
    result: OrbitPropagationResult | None = None
    error: str | None = None
