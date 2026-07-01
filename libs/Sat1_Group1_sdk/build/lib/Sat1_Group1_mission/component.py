"""Base class for all components including satellites."""


class Component:
    """Base class for all components including satellites."""

    description: str
    id_path: str

    def __init__(self, description: str, id_path: str):
        """Initialize the component object."""
        self.description = description
        self.id_path = id_path
