"""Contains models to handle versions."""

import re

from pydantic import BaseModel, Field

from pydantic_models.descriptions import version_descriptions as desc


class VersionModel(BaseModel):
    """Model to handle versions."""

    major: int = Field(description=desc.major)
    minor: int = Field(description=desc.minor)
    patch: int = Field(description=desc.patch)
    description: str | None = Field(default=None, description=desc.description)

    def to_string(self) -> str:
        """Get a string representation of the object.

        (neglects the description)
        """
        return f"{self.major}.{self.minor}.{self.patch}"

    @staticmethod
    def from_string(version: str) -> "VersionModel":
        """Create a VersionModel from a string.

        :param version: string representation of the version
        :return: VersionModel
        """
        check = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
        if not check.match(version):
            raise ValueError("incorrect version format. should be *.*.*")
        version = version.split(".")
        return VersionModel(major=int(version[0]), minor=int(version[1]), patch=int(version[2]))

    def __str__(self):
        """Get a string representation of the object."""
        return self.to_string()
