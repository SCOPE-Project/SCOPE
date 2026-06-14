"""Contains all the necessary class to handle the telemetry packets."""

from pydantic import UUID4, UUID7, AwareDatetime, Base64Bytes, BaseModel, Field, conlist


class TmPacketModel(BaseModel):
    """Model to handle telemetry packets.

    This is modeled close to PUS packet structure, but it can also be used for other telemetry packets.
    In the case of a non-PUS satellite, the fields are mission defined.
    """

    uuid: UUID4 | UUID7 = Field(description="UUID of this specific packet")
    id: str = Field(description="Id of this field e.g. Testsat_0.xyz.tm_set_1")
    name: str = Field(description="Name of this ")
    generation_time: AwareDatetime = Field(
        description="Time of generation if available, otherwise equal to the reception time."
    )
    reception_time: AwareDatetime = Field(description="Time of reception in the system.")
    application_process_id: int = Field(description="Mission specific usage.")
    source_sequence_count: int = Field(description="Mission specific usage.")
    message_type_count: int = Field(description="Mission specific usage.")
    service_type: int = Field(description="Mission specific usage.")
    service_subtype: int = Field(description="Mission specific usage.")
    destination: int = Field(description="Mission specific usage.")
    command_uuid: UUID4 | UUID7 | None = Field(
        default=None, description="Set if the system knows that this packet is related to a command."
    )
    raw_data: Base64Bytes | None = Field(default=None, description="Raw data if requested.")


class TmPacketResponse(BaseModel):
    """Response model for telemetry packets.

    Contains a list of telemetry packets.
    """

    packets: conlist(TmPacketModel, min_length=0) = Field(default_factory=list, description="List of packets")
