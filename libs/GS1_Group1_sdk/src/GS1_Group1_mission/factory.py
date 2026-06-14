"""Factory functions for creating models."""

import sys
from uuid import UUID

if sys.version_info < (3, 14):
    # Python versions before 3.14 do not provide a standard function to generate an uuid7
    from uuid_backport import uuid7
else:
    from uuid import uuid7


from pydantic import AwareDatetime
from pydantic_models.command import CommandModel, CommandState, RelativeInfoModel
from pydantic_models.definitions import CommandDefModel, VersionModel
from pydantic_models.parameter import CommandParameterModel
from pydantic_models.value_field import MatrixModel, OctetStringModel, ValueFieldModel, plain_types

# create a wrong activity uuid to make it possible to detect commands not attached to activities
_wrong_activity_uuid = UUID("deadbeef-cafe-4bad-babe-deadbeefcafe")


def _command_factory(
    cmd_def: CommandDefModel,
    id_path: str,
    command_version: VersionModel,
    params: list[plain_types | MatrixModel | OctetStringModel] | None = None,
    absolute_release_time: AwareDatetime = None,
    relative_release_info: RelativeInfoModel = None,
    absolute_execution_time: AwareDatetime = None,
    relative_execution_info: RelativeInfoModel = None,
) -> CommandModel:
    """Create a command model."""
    cmd_uuid = uuid7()

    cmd_params = [
        CommandParameterModel(
            name=cmd_def.name,
            commandUuid=cmd_uuid,
            id=f"{id_path}.{param_def.name}",
            value=ValueFieldModel().set_value(new_value=params[i]),
            uuid=uuid7(),
        )
        for i, param_def in enumerate(cmd_def.parameters)
    ]

    return CommandModel(
        uuid=cmd_uuid,
        id=id_path,
        name=cmd_def.name,
        relativeExecutionInfo=relative_execution_info,
        relativeReleaseInfo=relative_release_info,
        absoluteReleaseTime=absolute_release_time,
        absoluteExecutionTime=absolute_execution_time,
        parameters=cmd_params,
        activityUuid=_wrong_activity_uuid,
        state=CommandState.EDITABLE,
        rank="zzff",  # much more than 'ffff' to prevent possible collisions caused by bugs in the beginning of stacks
        version=command_version,
    )
