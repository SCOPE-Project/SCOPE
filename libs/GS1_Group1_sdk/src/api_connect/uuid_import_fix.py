"""This is a temporary solution to allow an import of uuid7 instead of uuid4 until python3.14 is the standard."""

import sys

if sys.version_info < (3, 14):
    from uuid_backport import uuid7
else:
    # Used for reimport
    from uuid import uuid7

__all__ = ["uuid7"]
