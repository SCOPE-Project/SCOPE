"""Python Orekit OMM parsing and SGP4 propagation helpers."""

from __future__ import annotations

import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from models_test import DEFAULT_OREKIT_DATA_PATH, DEFAULT_PROPAGATION_SECONDS, OrbitPropagationResult


_OREKIT_READY_PATH: Path | None = None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_first(root: ET.Element, local_name: str) -> ET.Element | None:
    for element in root.iter():
        if _local_name(element.tag) == local_name:
            return element
    return None


def normalize_omm_xml_for_orekit(omm_xml: str) -> str:
    """Fill blank CelesTrak OMM header fields that Orekit treats as mandatory."""
    try:
        root = ET.fromstring(omm_xml)
    except ET.ParseError:
        return omm_xml

    epoch = _find_first(root, "EPOCH")
    creation_date = _find_first(root, "CREATION_DATE")
    if creation_date is not None and not (creation_date.text or "").strip():
        creation_date.text = (epoch.text or "").strip() if epoch is not None else "1970-01-01T00:00:00"

    originator = _find_first(root, "ORIGINATOR")
    if originator is not None and not (originator.text or "").strip():
        originator.text = "CELESTRAK"

    serialized = ET.tostring(root, encoding="unicode")
    if not serialized.lstrip().startswith("<?xml"):
        serialized = f'<?xml version="1.0" encoding="UTF-8"?>\n{serialized}'
    return serialized


def ensure_orekit_ready(
    orekit_data_path: str | Path | None = None,
    download_if_missing: bool = True,
) -> Path:
    """Start the Python Orekit JVM and load orekit-data exactly when needed."""
    global _OREKIT_READY_PATH

    path_from_env = os.getenv("OREKIT_DATA_PATH")
    resolved_data_path = Path(orekit_data_path or path_from_env or DEFAULT_OREKIT_DATA_PATH).resolve()
    if _OREKIT_READY_PATH == resolved_data_path:
        return resolved_data_path

    try:
        import jpype
        import orekit_jpype
    except ImportError as exc:
        raise RuntimeError("Install backend requirements first: orekit-jpype==13.1.5.0 is required.") from exc

    if not jpype.isJVMStarted():
        orekit_jpype.initVM()

    from orekit_jpype.pyhelpers import download_orekit_data_curdir, setup_orekit_data

    if not resolved_data_path.exists():
        if not download_if_missing:
            raise FileNotFoundError(
                f"Orekit data not found at {resolved_data_path}. "
                "Provide --orekit-data or allow the helper to download orekit-data.zip."
            )
        resolved_data_path.parent.mkdir(parents=True, exist_ok=True)
        download_orekit_data_curdir(str(resolved_data_path))

    setup_orekit_data(str(resolved_data_path), from_pip_library=False)
    _OREKIT_READY_PATH = resolved_data_path
    return resolved_data_path


def _parse_omm_message(omm_xml: str):
    normalized_xml = normalize_omm_xml_for_orekit(omm_xml)
    root = ET.fromstring(normalized_xml)

    from org.orekit.data import DataSource
    from org.orekit.files.ccsds.ndm import ParserBuilder

    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False, encoding="utf-8") as tmp:
        tmp.write(normalized_xml)
        tmp_path = Path(tmp.name)

    try:
        builder = ParserBuilder()
        if _local_name(root.tag).lower() == "ndm":
            ndm = builder.buildNdmParser().parseMessage(DataSource(str(tmp_path)))
            for constituent in ndm.getConstituents():
                if hasattr(constituent, "generateTLE"):
                    return constituent
            raise ValueError("NDM XML did not contain an OMM constituent")

        return builder.buildOmmParser().parseMessage(DataSource(str(tmp_path)))
    finally:
        tmp_path.unlink(missing_ok=True)


def propagate_omm_xml(
    omm_xml: str,
    propagation_seconds: float = DEFAULT_PROPAGATION_SECONDS,
    orekit_data_path: str | Path | None = None,
    download_orekit_data: bool = True,
    output_frame: str = "TEME",
) -> OrbitPropagationResult:
    """Parse OMM XML, generate an internal TLE, and propagate once with SGP4."""
    ensure_orekit_ready(orekit_data_path=orekit_data_path, download_if_missing=download_orekit_data)

    from orekit_jpype.pyhelpers import absolutedate_to_datetime
    from org.orekit.frames import FramesFactory
    from org.orekit.propagation.analytical.tle import TLEPropagator

    omm = _parse_omm_message(omm_xml)
    metadata = omm.getMetadata()
    theory = str(metadata.getMeanElementTheory()).upper()
    if theory != "SGP4":
        raise ValueError(f"Only SGP4 OMM messages are supported by this hello-world workflow, got {theory!r}")

    tle = omm.generateTLE()
    propagator = TLEPropagator.selectExtrapolator(tle)
    target_date = tle.getDate().shiftedBy(float(propagation_seconds))
    state = propagator.propagate(target_date)

    frame_label = output_frame.upper()
    frame = FramesFactory.getEME2000() if frame_label == "EME2000" else propagator.getFrame()
    pv_coordinates = state.getPVCoordinates(frame)
    position = pv_coordinates.getPosition()
    velocity = pv_coordinates.getVelocity()

    return OrbitPropagationResult(
        object_name=str(metadata.getObjectName()) if metadata.getObjectName() is not None else None,
        object_id=str(metadata.getObjectID()) if metadata.getObjectID() is not None else None,
        mean_element_theory=theory,
        tle_line_1=str(tle.getLine1()),
        tle_line_2=str(tle.getLine2()),
        epoch_utc=absolutedate_to_datetime(tle.getDate(), tz_aware=True),
        target_utc=absolutedate_to_datetime(target_date, tz_aware=True),
        propagation_seconds=float(propagation_seconds),
        frame=str(frame.getName()),
        position_m=(float(position.getX()), float(position.getY()), float(position.getZ())),
        velocity_m_per_s=(float(velocity.getX()), float(velocity.getY()), float(velocity.getZ())),
    )
