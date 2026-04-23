"""Ornn Python SDK.

Quickstart::

    from ornn_sdk import OrnnClient

    ornn = OrnnClient(
        base_url="https://ornn.chrono-ai.fun",
        token=os.environ["NYXID_ACCESS_TOKEN"],
    )

    result = ornn.search(q="pdf", scope="public")
    detail = ornn.get(result.items[0].id)
    pkg = ornn.download_package(detail.id, detail.latest_version)

    ornn.close()  # or use ``with OrnnClient(...) as ornn: ...``

All requests go through ``/api/v1/*``. Errors raise :class:`OrnnError`.
"""

from .client import OrnnClient
from .errors import OrnnError
from .types import (
    SearchMode,
    SearchScope,
    SkillDetail,
    SkillSearchResult,
    SkillSummary,
    SkillVersionEntry,
    SystemFilter,
    UpdateSkillMetadata,
    Visibility,
)

__all__ = [
    "OrnnClient",
    "OrnnError",
    "SearchMode",
    "SearchScope",
    "SkillDetail",
    "SkillSearchResult",
    "SkillSummary",
    "SkillVersionEntry",
    "SystemFilter",
    "UpdateSkillMetadata",
    "Visibility",
]

__version__ = "0.2.0"
