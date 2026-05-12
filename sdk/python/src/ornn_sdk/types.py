"""Public types for the Ornn Python SDK.

Shapes mirror the TypeScript SDK and what `/api/v1/*` actually returns.
Dataclasses keep the wire format explicit without pulling in pydantic.

Responses from the server arrive as plain dicts; the client methods
convert them into these dataclasses via `from_dict` helpers so callers
get typed objects. Unknown fields are preserved on a dataclass's
`_extra` dict for forward-compat.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Visibility = Literal["public", "private"]
SearchScope = Literal["public", "private", "mine", "mixed", "shared-with-me"]
SearchMode = Literal["keyword", "semantic", "hybrid"]
SystemFilter = Literal["any", "only", "exclude"]


@dataclass
class SkillSummary:
    id: str
    name: str
    description: str
    is_private: bool
    created_by: str
    created_on: str
    is_system: bool | None = None
    updated_on: str | None = None
    latest_version: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    _extra: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SkillSummary":
        known = {
            "id",
            "name",
            "description",
            "isPrivate",
            "isSystem",
            "createdBy",
            "createdOn",
            "updatedOn",
            "latestVersion",
            "metadata",
        }
        extra = {k: v for k, v in raw.items() if k not in known}
        return cls(
            id=raw["id"],
            name=raw["name"],
            description=raw.get("description", ""),
            is_private=bool(raw.get("isPrivate", False)),
            is_system=raw.get("isSystem"),
            created_by=raw.get("createdBy", ""),
            created_on=raw.get("createdOn", ""),
            updated_on=raw.get("updatedOn"),
            latest_version=raw.get("latestVersion"),
            metadata=raw.get("metadata") or {},
            _extra=extra,
        )


@dataclass
class SkillDetail(SkillSummary):
    owner_id: str = ""
    storage_key: str | None = None
    shared_with_users: list[str] = field(default_factory=list)
    shared_with_orgs: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SkillDetail":
        base = SkillSummary.from_dict(raw).__dict__
        base.pop("_extra")
        known_extra = {"ownerId", "storageKey", "sharedWithUsers", "sharedWithOrgs"}
        summary_known = {
            "id",
            "name",
            "description",
            "isPrivate",
            "isSystem",
            "createdBy",
            "createdOn",
            "updatedOn",
            "latestVersion",
            "metadata",
        }
        extra = {
            k: v
            for k, v in raw.items()
            if k not in summary_known and k not in known_extra
        }
        return cls(
            **base,
            owner_id=raw.get("ownerId", ""),
            storage_key=raw.get("storageKey"),
            shared_with_users=list(raw.get("sharedWithUsers") or []),
            shared_with_orgs=list(raw.get("sharedWithOrgs") or []),
            _extra=extra,
        )


@dataclass
class SkillVersionEntry:
    version: str
    created_on: str
    hash: str | None = None
    is_latest: bool | None = None
    is_deprecated: bool | None = None
    deprecation_note: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SkillVersionEntry":
        return cls(
            version=raw["version"],
            created_on=raw.get("createdOn", ""),
            hash=raw.get("hash"),
            is_latest=raw.get("isLatest"),
            is_deprecated=raw.get("isDeprecated"),
            deprecation_note=raw.get("deprecationNote"),
        )


@dataclass
class SkillSearchResult:
    items: list[SkillSummary]
    total: int
    page: int
    page_size: int
    total_pages: int
    mode: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SkillSearchResult":
        return cls(
            items=[SkillSummary.from_dict(i) for i in raw.get("items") or []],
            total=int(raw.get("total", 0)),
            page=int(raw.get("page", 1)),
            page_size=int(raw.get("pageSize", 0)),
            total_pages=int(raw.get("totalPages", 0)),
            mode=raw.get("mode"),
        )


@dataclass
class UpdateSkillMetadata:
    """Partial metadata update payload. Omit fields you don't want to change."""

    name: str | None = None
    description: str | None = None
    is_private: bool | None = None
    metadata: dict[str, Any] | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.name is not None:
            out["name"] = self.name
        if self.description is not None:
            out["description"] = self.description
        if self.is_private is not None:
            out["isPrivate"] = self.is_private
        if self.metadata is not None:
            out["metadata"] = self.metadata
        return out
