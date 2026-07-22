"""Models for the Grafana endpoints.

The returned models correspond to the ones the JSON plugin expects. For documentation on options in those
models see the json plugin docs (https://github.com/simPod/GrafanaJsonDatasource).
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class PayloadKey(StrEnum):
    """Used in /metrics endpoint request."""

    sat_version_selection = "sat_version_selection"
    type_selection = "type_selection"
    event_selection = "event_selection"
    packet_selection = "packet_selection"
    packet_time_selection = "packet_time_selection"
    packet_raw_data = "packet_raw_data"
    tm_parameter_selection = "tm_parameter_selection"
    matrix_row_selection = "matrix_row_selection"
    matrix_col_selection = "matrix_col_selection"
    fetch_invalid = "validity_selection"


class MetricRequest(BaseModel):
    """Request received in /metrics endpoint."""

    metric: str | None = None
    payload: Mapping[PayloadKey, str] | None = None


class PayloadType(StrEnum):
    """Used in /metrics endpoint to describe select fields."""

    select = "select"  # Radio box
    multi_select = "multi-select"  # Multi selection box
    input = "input"  # Text input box
    textarea = "textarea"  # Multi-line text input box


class PayloadSelectOption(BaseModel):
    """Used in /metrics endpoint response to describe options in select fields."""

    label: str | None = None
    value: str


class PayloadConfiguration(BaseModel):
    """Part of /metrics endpoint response."""

    label: str | None = None
    name: PayloadKey
    type_: PayloadType | None = Field(None, alias="type")
    placeholder: str | None = None
    reload_metric: bool | None = Field(None, alias="reloadMetric")
    width: int | None = None
    options: list[PayloadSelectOption] | None = None
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class MetricResponse(BaseModel):
    """Response type used in /metrics endpoint."""

    label: str | None = None
    value: str
    payloads: list[PayloadConfiguration]


class RangeRaw(BaseModel):
    """Raw part of the requested range."""

    from_: str | None = Field(None, alias="from")
    to: str | None = None
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class Range(BaseModel):
    """Range as used in /query request."""

    from_: AwareDatetime = Field(alias="from")
    to: AwareDatetime
    raw: RangeRaw | None = None
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class Target(BaseModel):
    """Target as used in /query request."""

    target: str
    ref_id: str | None = Field(None, alias="refId")
    payload: Mapping[PayloadKey, str] | None = None
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class AdhocFilter(BaseModel):
    """Adhoc filter as received in /query request."""

    key: str | None = None
    operator: str | None = None
    value: str | None = None


class QueryRequest(BaseModel):
    """Used in /query endpoint as request."""

    panel_id: str | int | float | None = Field(None, alias="panelId")
    range_: Range = Field(alias="range")
    range_raw: RangeRaw | None = Field(None, alias="rangeRaw")
    interval: str | None = None
    interval_ms: int | float | None = Field(None, alias="intervalMs")
    max_data_points: int | float | None = Field(None, alias="maxDataPoints")
    targets: list[Target]
    scoped_vars: dict | None = Field(None, alias="scopeVars")
    adhoc_filters: list[AdhocFilter] | None = Field(None, alias="adhocFilters")
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)


class Timeseries(BaseModel):
    """TODO unused?."""

    target: str
    datapoints: list[tuple[float | int | str, AwareDatetime]]


class FieldType(StrEnum):
    """Part of dataframe."""

    time = "time"  # or date
    number = "number"
    string = "string"
    boolean = "boolean"
    # Used to detect that the value is some kind of trace data to help with the visualisation and processing.
    trace = "trace"
    geo = "geo"
    enum = "enum"
    other = "other"  # Object, Array etc.
    frame = "frame"  # DataFrame


class FieldColor(BaseModel):
    """Part of dataframe."""

    mode: str
    fixedColor: str | None = None


class FieldConfig(BaseModel):
    """Part of dataframe."""

    displayNameFromDS: str | None = None
    description: str | None = None
    unit: str | None = None
    color: FieldColor | None = None


class FieldDTO(BaseModel):
    """Part of dataframe."""

    name: str
    type: FieldType | None = None
    config: FieldConfig | None = None
    values: list[Any]
    labels: dict[str, str] | None = None


class Dataframe(BaseModel):
    """Grafana dataframe used in /query response."""

    name: str | None = None
    fields: list[FieldDTO]


class MetricPayloadOptionsRequest(BaseModel):
    """Used in /metric-payload-options endpoint."""

    metric: str
    payload: dict
    name: str


class TagKey(BaseModel):
    """Response used in /tag-keys as list."""

    type: str
    text: str


class TagValuesRequest(BaseModel):
    """Received in /tag-values endpoint."""

    key: str


class TagValuesResponseType(BaseModel):
    """Used in /tag-values endpoint as list."""

    text: str
