"""Pydantic model for the link status."""

from enum import IntEnum

from pydantic import AwareDatetime, BaseModel, Field

from pydantic_models.descriptions import link_status_descriptions as desc


class LinkStatusModel(BaseModel):
    """Link status model."""

    class LinkTypeModel(IntEnum):
        """Link type enumeration."""

        # Unspecified link type, should not be used
        UNSPECIFIED = 0

        # Uplink from ground to satellite (might include ISL etc.)
        UPLINK = 1

        # Downlink from satellite to ground
        DOWNLINK = 2

    class LinkStatusType(IntEnum):
        """Link status enumeration."""

        # Unknown link status, should not be used
        UNKNOWN = 0

        # The link is up and running
        CONNECTED = 1

        # The link is down
        DISCONNECTED = 2

        # The link is in a degraded state
        DEGRADED = 3

        # The link was deactivated by the user or system
        DEACTIVATED = 4

    class AdditionalInformationModel(BaseModel):
        """Additional information about the link status."""

        key: str = Field(description=desc.additional_key)
        status: "LinkStatusModel.LinkStatusType" = Field(description=desc.additional_status)
        value: int | float | str | bool | None = Field(default=None, description=desc.additional_value)

    linkType: LinkTypeModel = Field(description=desc.link_type)
    status: LinkStatusType = Field(description=desc.status)
    time: AwareDatetime = Field(description=desc.time)
    linkName: str = Field(description=desc.link_name)
    service: str = Field(description=desc.service)
    asset: str = Field(description=desc.asset)
    additionalInformation: list[AdditionalInformationModel] = Field(
        default_factory=list, description=desc.additional_information
    )
