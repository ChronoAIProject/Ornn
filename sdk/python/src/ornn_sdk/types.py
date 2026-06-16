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
SkillsetKind = Literal["generic", "consensus-supported"]

# Access level a grant confers (#1123). `read` allows pull/execute;
# `write` additionally allows publishing new versions / editing (and implies read).
SkillPermissionLevel = Literal["read", "write"]
GrantTarget = Literal["user", "org"]


@dataclass
class SkillGrant:
    """One typed ACL entry (#1123) — the canonical sharing primitive for
    skills and skillsets.

    Grants a single user or org a specific access level. Supersedes the
    legacy ``sharedWith*`` arrays (which the server still accepts, mapping
    each entry to a ``read``-level grant).
    """

    # Whether the grant targets an individual user or a whole org.
    type: GrantTarget
    # The user or org id the grant applies to.
    id: str
    # The access level conferred.
    level: SkillPermissionLevel

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillGrant:
        return cls(
            type=raw["type"],
            id=raw["id"],
            level=raw.get("level", "read"),
        )

    def to_json(self) -> dict[str, Any]:
        return {"type": self.type, "id": self.id, "level": self.level}


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
    def from_dict(cls, raw: dict[str, Any]) -> SkillSummary:
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
    storage_key: str | None = None
    shared_with_users: list[str] = field(default_factory=list)
    shared_with_orgs: list[str] = field(default_factory=list)
    # Canonical typed ACL (#1123). Present on detail reads post-#1123;
    # absent on pre-#1123 API responses (left as an empty list).
    grants: list[SkillGrant] = field(default_factory=list)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillDetail:
        base = SkillSummary.from_dict(raw).__dict__
        base.pop("_extra")
        # `ownerId` was removed from the wire in #581 — tolerate it
        # showing up on old API responses (treat as unknown extra).
        known_extra = {"storageKey", "sharedWithUsers", "sharedWithOrgs", "grants"}
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
            if k not in summary_known and k not in known_extra and k != "ownerId"
        }
        return cls(
            **base,
            storage_key=raw.get("storageKey"),
            shared_with_users=list(raw.get("sharedWithUsers") or []),
            shared_with_orgs=list(raw.get("sharedWithOrgs") or []),
            grants=[SkillGrant.from_dict(g) for g in raw.get("grants") or []],
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
    def from_dict(cls, raw: dict[str, Any]) -> SkillVersionEntry:
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
    def from_dict(cls, raw: dict[str, Any]) -> SkillSearchResult:
        return cls(
            items=[SkillSummary.from_dict(i) for i in raw.get("items") or []],
            total=int(raw.get("total", 0)),
            page=int(raw.get("page", 1)),
            page_size=int(raw.get("pageSize", 0)),
            total_pages=int(raw.get("totalPages", 0)),
            mode=raw.get("mode"),
        )


@dataclass
class ClosureNode:
    """One node in a resolved dependency closure (#968).

    Mirrors the items returned by
    ``GET /api/v1/skills/{id_or_name}/closure``. Nodes arrive in
    deps-first topological order — every dependency precedes the
    dependents that pin it.
    """

    guid: str
    name: str
    version: str
    depth: int
    skill_hash: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ClosureNode:
        return cls(
            guid=raw.get("guid", ""),
            name=raw["name"],
            version=raw["version"],
            depth=int(raw.get("depth", 0)),
            skill_hash=raw.get("skillHash"),
        )


@dataclass
class ClosureResult:
    """Result of :meth:`OrnnClient.resolve_closure` — the ordered closure."""

    items: list[ClosureNode]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> ClosureResult:
        return cls(items=[ClosureNode.from_dict(i) for i in raw.get("items") or []])


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


# ---------------------------------------------------------------------------
# Skillsets (#969)
# ---------------------------------------------------------------------------


@dataclass
class SkillsetDetail:
    """Full skillset detail returned by single-skillset reads.

    A ``consensus-supported`` skillset is an author CLAIM that the members
    are an independent, comparable set suitable for agent-side consensus —
    not a guarantee. ``generic`` is a plain curated bundle.
    """

    guid: str
    name: str
    description: str
    kind: SkillsetKind
    version: str
    latest_version: str
    is_private: bool
    created_by: str
    # Master prompt (#978) — the per-version usage instructions for agents.
    instructions: str = ""
    tags: list[str] = field(default_factory=list)
    members: list[str] = field(default_factory=list)
    shared_with_users: list[str] = field(default_factory=list)
    shared_with_orgs: list[str] = field(default_factory=list)
    # Canonical typed ACL (#1123). Present on detail reads post-#1123;
    # absent on pre-#1123 API responses (left as an empty list).
    grants: list[SkillGrant] = field(default_factory=list)
    created_on: str = ""
    updated_on: str = ""

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillsetDetail:
        return cls(
            guid=raw.get("guid", ""),
            name=raw["name"],
            description=raw.get("description", ""),
            kind=raw.get("kind", "generic"),
            version=raw.get("version", ""),
            latest_version=raw.get("latestVersion", ""),
            is_private=bool(raw.get("isPrivate", False)),
            created_by=raw.get("createdBy", ""),
            instructions=raw.get("instructions", ""),
            tags=list(raw.get("tags") or []),
            members=list(raw.get("members") or []),
            shared_with_users=list(raw.get("sharedWithUsers") or []),
            shared_with_orgs=list(raw.get("sharedWithOrgs") or []),
            grants=[SkillGrant.from_dict(g) for g in raw.get("grants") or []],
            created_on=raw.get("createdOn", ""),
            updated_on=raw.get("updatedOn", ""),
        )


@dataclass
class SkillsetSummary:
    """Lighter skillset summary returned by search."""

    guid: str
    name: str
    description: str
    kind: SkillsetKind
    member_count: int
    latest_version: str
    is_private: bool
    created_by: str
    tags: list[str] = field(default_factory=list)
    created_on: str = ""
    updated_on: str = ""

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillsetSummary:
        return cls(
            guid=raw.get("guid", ""),
            name=raw["name"],
            description=raw.get("description", ""),
            kind=raw.get("kind", "generic"),
            member_count=int(raw.get("memberCount", 0)),
            latest_version=raw.get("latestVersion", ""),
            is_private=bool(raw.get("isPrivate", False)),
            created_by=raw.get("createdBy", ""),
            tags=list(raw.get("tags") or []),
            created_on=raw.get("createdOn", ""),
            updated_on=raw.get("updatedOn", ""),
        )


@dataclass
class SkillsetSearchResult:
    items: list[SkillsetSummary]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillsetSearchResult:
        return cls(
            items=[SkillsetSummary.from_dict(i) for i in raw.get("items") or []],
            total=int(raw.get("total", 0)),
            page=int(raw.get("page", 1)),
            page_size=int(raw.get("pageSize", 0)),
            total_pages=int(raw.get("totalPages", 0)),
        )


@dataclass
class SkillsetClosureResult:
    """Result of :meth:`OrnnClient.resolve_skillset_closure` (#978).

    The resolved delivery closure PLUS the version's master prompt. A
    dedicated type (NOT the shared :class:`ClosureResult`): the skillset
    closure carries ``instructions`` as a root sibling of ``items``, while
    the skill closure (#968) stays ``{items}``.
    """

    instructions: str
    items: list[ClosureNode]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SkillsetClosureResult:
        return cls(
            instructions=raw.get("instructions", ""),
            items=[ClosureNode.from_dict(i) for i in raw.get("items") or []],
        )
