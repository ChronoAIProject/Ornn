"""Tests for OrnnClient. Mocks httpx transport via respx so no network is required."""

from __future__ import annotations

import pytest
import respx

from ornn_sdk import (
    OrnnClient,
    OrnnError,
    SkillDetail,
    SkillGrant,
    SkillSearchResult,
    UpdateSkillMetadata,
)

BASE = "https://ornn.example.com"


def make_client(**kwargs) -> OrnnClient:
    return OrnnClient(base_url=BASE, **kwargs)


class TestConstruction:
    def test_base_url_required(self) -> None:
        with pytest.raises(ValueError, match="base_url is required"):
            OrnnClient(base_url="")

    def test_strips_trailing_slashes(self) -> None:
        client = OrnnClient(base_url="https://ornn.example.com///")
        assert client._base_url == "https://ornn.example.com"


class TestAuth:
    @respx.mock
    def test_injects_static_token(self) -> None:
        route = respx.get(f"{BASE}/api/v1/me").respond(
            200, json={"data": {"id": "u1"}, "error": None}
        )
        with make_client(token="tok_static") as ornn:
            ornn.request("GET", "/me")
        assert route.calls.last.request.headers["authorization"] == "Bearer tok_static"

    @respx.mock
    def test_resolver_takes_precedence(self) -> None:
        route = respx.get(f"{BASE}/api/v1/me").respond(200, json={"data": {}, "error": None})
        with make_client(
            token="tok_static",
            token_resolver=lambda: "tok_dynamic",
        ) as ornn:
            ornn.request("GET", "/me")
        assert route.calls.last.request.headers["authorization"] == "Bearer tok_dynamic"

    @respx.mock
    def test_no_auth_header_when_no_token(self) -> None:
        route = respx.get(f"{BASE}/api/v1/public").respond(200, json={"data": {}, "error": None})
        with make_client() as ornn:
            ornn.request("GET", "/public")
        assert "authorization" not in route.calls.last.request.headers


class TestEnvelope:
    @respx.mock
    def test_unwraps_success(self) -> None:
        respx.get(f"{BASE}/api/v1/thing").respond(
            200, json={"data": {"hello": "world"}, "error": None}
        )
        with make_client() as ornn:
            result = ornn.request("GET", "/thing")
        assert result == {"hello": "world"}

    @respx.mock
    def test_raises_ornn_error_on_problem_json(self) -> None:
        # 4xx body is RFC 7807 problem+json (#456) — root-level fields.
        respx.get(f"{BASE}/api/v1/admin").respond(
            403,
            json={
                "type": "https://github.com/.../ERRORS.md#permission_denied",
                "title": "Permission denied",
                "status": 403,
                "code": "permission_denied",
                "detail": "Missing ornn:skill:admin",
                "instance": "/v1/admin",
                "requestId": "req_01HXYZ",
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.request("GET", "/admin")
        err = excinfo.value
        assert err.status == 403
        assert err.code == "permission_denied"
        assert err.request_id == "req_01HXYZ"
        assert err.message == "Missing ornn:skill:admin"

    @respx.mock
    def test_raises_on_unenveloped_5xx(self) -> None:
        respx.get(f"{BASE}/api/v1/any").respond(502, text="bad gateway")
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.request("GET", "/any")
        err = excinfo.value
        assert err.status == 502
        assert err.code == "unknown_error"

    @respx.mock
    def test_preserves_structured_errors_list(self) -> None:
        # `errors[]` rides at the body root inside problem+json (#456).
        respx.post(f"{BASE}/api/v1/skills").respond(
            400,
            json={
                "type": "https://github.com/.../ERRORS.md#validation_error",
                "title": "Validation failed",
                "status": 400,
                "code": "validation_error",
                "detail": "Validation failed",
                "instance": "/v1/skills",
                "errors": [
                    {"path": "name", "code": "required", "message": "name is required"},
                ],
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.publish(b"PK\x03\x04")
        assert excinfo.value.errors == [
            {"path": "name", "code": "required", "message": "name is required"},
        ]


class TestSearch:
    @respx.mock
    def test_maps_q_to_canonical_q_param(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skill-search").respond(
            200,
            json={
                "data": {
                    "items": [],
                    "total": 0,
                    "page": 1,
                    "pageSize": 20,
                    "totalPages": 0,
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.search(q="pdf", scope="public", page=2, page_size=50)
        assert isinstance(result, SkillSearchResult)
        req_url = str(route.calls.last.request.url)
        # Canonical search param is `q` (CONVENTIONS.md §4.1 / #586).
        assert "q=pdf" in req_url
        assert "query=pdf" not in req_url
        assert "scope=public" in req_url
        assert "page=2" in req_url
        assert "pageSize=50" in req_url

    @respx.mock
    def test_parses_items_as_skill_summaries(self) -> None:
        respx.get(f"{BASE}/api/v1/skill-search").respond(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "id": "abc",
                            "name": "pdf-extract",
                            "description": "Extract pdf text",
                            "isPrivate": False,
                            "createdBy": "u1",
                            "createdOn": "2026-01-01T00:00:00Z",
                            "latestVersion": "1.2",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "pageSize": 20,
                    "totalPages": 1,
                    "mode": "keyword",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.search()
        assert result.total == 1
        assert result.mode == "keyword"
        assert result.items[0].id == "abc"
        assert result.items[0].latest_version == "1.2"
        assert result.items[0].is_private is False


class TestGet:
    @respx.mock
    def test_url_encodes_path_segment(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skills/my%2Fweird%20name").respond(
            200,
            json={
                "data": {
                    "id": "x",
                    "name": "my/weird name",
                    "description": "",
                    "isPrivate": False,
                    "createdBy": "u1",
                    "createdOn": "2026-01-01T00:00:00Z",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            detail = ornn.get("my/weird name")
        assert isinstance(detail, SkillDetail)
        assert detail.created_by == "u1"
        assert route.called

    @respx.mock
    def test_raises_ornn_error_on_404(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/nope").respond(
            404,
            json={
                "type": "https://github.com/.../ERRORS.md#resource_not_found",
                "title": "Resource not found",
                "status": 404,
                "code": "resource_not_found",
                "detail": "no such skill",
                "instance": "/v1/skills/nope",
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.get("nope")
        assert excinfo.value.status == 404
        assert excinfo.value.code == "resource_not_found"


class TestVersions:
    @respx.mock
    def test_list_versions_unwraps_items(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/abc/versions").respond(
            200,
            json={
                "data": {
                    "items": [
                        {"version": "1.0", "createdOn": "2026-01-01T00:00:00Z", "isLatest": True},
                        {"version": "0.9", "createdOn": "2025-12-01T00:00:00Z"},
                    ],
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            versions = ornn.list_versions("abc")
        assert [v.version for v in versions] == ["1.0", "0.9"]
        assert versions[0].is_latest is True


class TestDownload:
    @respx.mock
    def test_download_returns_raw_bytes(self) -> None:
        zip_bytes = b"PK\x03\x04\x01\x02\x03"
        respx.get(f"{BASE}/api/v1/skills/abc/versions/1.0/download").respond(
            200,
            content=zip_bytes,
            headers={"Content-Type": "application/zip"},
        )
        with make_client() as ornn:
            result = ornn.download_package("abc", "1.0")
        assert result == zip_bytes

    @respx.mock
    def test_download_raises_on_error(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/abc/versions/9.9/download").respond(
            404,
            json={
                "type": "https://github.com/.../ERRORS.md#resource_not_found",
                "title": "Resource not found",
                "status": 404,
                "code": "resource_not_found",
                "detail": "no such version",
                "instance": "/v1/skills/abc/versions/9.9/download",
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.download_package("abc", "9.9")
        assert excinfo.value.status == 404
        assert excinfo.value.code == "resource_not_found"


class TestClosure:
    @respx.mock
    def test_resolve_closure_parses_topo_items(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skills/report-gen/closure").respond(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "guid": "g-c",
                            "name": "c",
                            "version": "1.0",
                            "skillHash": "h-c",
                            "depth": 1,
                        },
                        {
                            "guid": "g-b",
                            "name": "b",
                            "version": "1.0",
                            "skillHash": "h-b",
                            "depth": 0,
                        },
                    ],
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.resolve_closure("report-gen", version="1.0")
        assert [n.name for n in result.items] == ["c", "b"]
        assert result.items[0].depth == 1
        assert result.items[0].guid == "g-c"
        # version query is forwarded.
        assert route.calls.last.request.url.params["version"] == "1.0"

    @respx.mock
    def test_resolve_closure_omits_version_when_absent(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skills/report-gen/closure").respond(
            200, json={"data": {"items": []}, "error": None}
        )
        with make_client() as ornn:
            ornn.resolve_closure("report-gen")
        assert "version" not in route.calls.last.request.url.params

    @respx.mock
    def test_resolve_closure_raises_on_dependency_cycle(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/a/closure").respond(
            409,
            json={
                "type": "https://github.com/.../ERRORS.md#resource_conflict",
                "title": "Conflict",
                "status": 409,
                "code": "dependency_cycle",
                "detail": "cycle at a@1.0",
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.resolve_closure("a")
        assert excinfo.value.status == 409
        assert excinfo.value.code == "dependency_cycle"

    @respx.mock
    def test_pull_closure_downloads_in_topo_order(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/report-gen/closure").respond(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "guid": "g-c",
                            "name": "c",
                            "version": "1.0",
                            "skillHash": "h-c",
                            "depth": 1,
                        },
                        {
                            "guid": "g-b",
                            "name": "b",
                            "version": "1.0",
                            "skillHash": "h-b",
                            "depth": 0,
                        },
                    ],
                },
                "error": None,
            },
        )
        dl_c = respx.get(f"{BASE}/api/v1/skills/g-c/versions/1.0/download").respond(
            200, content=b"PKc", headers={"Content-Type": "application/zip"}
        )
        dl_b = respx.get(f"{BASE}/api/v1/skills/g-b/versions/1.0/download").respond(
            200, content=b"PKb", headers={"Content-Type": "application/zip"}
        )
        with make_client() as ornn:
            closure, packages = ornn.pull_closure("report-gen")
        assert [n.name for n in closure.items] == ["c", "b"]
        # Downloads follow the closure order — c (deps-first) before b.
        assert [node.name for node, _ in packages] == ["c", "b"]
        assert packages[0][1] == b"PKc"
        assert dl_c.called and dl_b.called


class TestPublish:
    @respx.mock
    def test_publish_sends_zip_bytes(self) -> None:
        route = respx.post(f"{BASE}/api/v1/skills").respond(
            200,
            json={
                "data": {
                    "id": "new_abc",
                    "name": "my-skill",
                    "description": "",
                    "isPrivate": True,
                    "createdBy": "u1",
                    "createdOn": "2026-01-01T00:00:00Z",
                },
                "error": None,
            },
        )
        zip_bytes = b"PK\x03\x04fakezip"
        with make_client() as ornn:
            detail = ornn.publish(zip_bytes)
        assert detail.id == "new_abc"
        req = route.calls.last.request
        assert req.headers["content-type"] == "application/zip"
        assert req.content == zip_bytes

    @respx.mock
    def test_publish_adds_skip_validation_query(self) -> None:
        route = respx.post(f"{BASE}/api/v1/skills", params={"skip_validation": "true"}).respond(
            200,
            json={
                "data": {
                    "id": "admin_x",
                    "name": "admin-skill",
                    "description": "",
                    "isPrivate": False,
                    "createdBy": "admin",
                    "createdOn": "2026-01-01T00:00:00Z",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            ornn.publish(b"PK", skip_validation=True)
        assert route.called


class TestUpdate:
    @respx.mock
    def test_update_metadata_sends_json(self) -> None:
        import json as _json

        route = respx.put(f"{BASE}/api/v1/skills/abc").respond(
            200,
            json={
                "data": {
                    "id": "abc",
                    "name": "abc",
                    "description": "updated",
                    "isPrivate": False,
                    "createdBy": "u1",
                    "createdOn": "2026-01-01T00:00:00Z",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            ornn.update("abc", metadata=UpdateSkillMetadata(description="updated"))
        req = route.calls.last.request
        assert "application/json" in req.headers["content-type"]
        assert _json.loads(req.content) == {"description": "updated"}

    @respx.mock
    def test_update_with_zip_sends_zip(self) -> None:
        route = respx.put(f"{BASE}/api/v1/skills/abc").respond(
            200,
            json={
                "data": {
                    "id": "abc",
                    "name": "abc",
                    "description": "",
                    "isPrivate": False,
                    "createdBy": "u1",
                    "createdOn": "2026-01-01T00:00:00Z",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            ornn.update("abc", zip_bytes=b"PK\x03\x04new")
        assert route.calls.last.request.headers["content-type"] == "application/zip"

    def test_update_requires_one_of_metadata_or_zip(self) -> None:
        with make_client() as ornn:
            with pytest.raises(ValueError, match="exactly one"):
                ornn.update("abc")

    def test_update_rejects_both_metadata_and_zip(self) -> None:
        with make_client() as ornn:
            with pytest.raises(ValueError, match="exactly one"):
                ornn.update("abc", metadata={"name": "x"}, zip_bytes=b"PK")


class TestDelete:
    @respx.mock
    def test_delete_fires_http_delete(self) -> None:
        route = respx.delete(f"{BASE}/api/v1/skills/abc").respond(
            200, json={"data": {"success": True}, "error": None}
        )
        with make_client() as ornn:
            ornn.delete("abc")
        assert route.called
        assert route.calls.last.request.method == "DELETE"


def _skillset_data(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "guid": "ss-1",
        "name": "review-set",
        "description": "a set",
        "instructions": "Run a, then feed its output to b.",
        "kind": "generic",
        "tags": [],
        "members": ["a@1.0", "b@1.0"],
        "version": "1.0",
        "latestVersion": "1.0",
        "isPrivate": False,
        "createdBy": "owner-1",
        "sharedWithUsers": [],
        "sharedWithOrgs": [],
        "createdOn": "2026-01-01T00:00:00Z",
        "updatedOn": "2026-01-01T00:00:00Z",
    }
    base.update(overrides)
    return base


class TestSkillsets:
    @respx.mock
    def test_create_skillset_posts_json(self) -> None:
        route = respx.post(f"{BASE}/api/v1/skillsets").respond(
            201, json={"data": _skillset_data(guid="ss-new"), "error": None}
        )
        with make_client() as ornn:
            result = ornn.create_skillset(
                name="review-set",
                description="d",
                instructions="Run a, then feed its output to b.",
                members=["a@1.0", "b@1.0"],
                kind="consensus-supported",
            )
        assert route.called
        assert route.calls.last.request.method == "POST"
        import json as _json

        sent = _json.loads(route.calls.last.request.content)
        assert sent["members"] == ["a@1.0", "b@1.0"]
        assert sent["kind"] == "consensus-supported"
        # The master prompt (#978) is sent on the wire.
        assert sent["instructions"] == "Run a, then feed its output to b."
        assert result.guid == "ss-new"
        assert result.instructions == "Run a, then feed its output to b."

    @respx.mock
    def test_get_skillset_url_encodes_and_forwards_version(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skillsets/review%20set").respond(
            200, json={"data": _skillset_data(), "error": None}
        )
        with make_client() as ornn:
            result = ornn.get_skillset("review set", version="1.1")
        assert route.called
        assert route.calls.last.request.url.params["version"] == "1.1"
        assert result.name == "review-set"

    @respx.mock
    def test_get_skillset_raises_on_404(self) -> None:
        respx.get(f"{BASE}/api/v1/skillsets/ghost").respond(
            404,
            json={"status": 404, "code": "skillset_not_found", "detail": "nope"},
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.get_skillset("ghost")
        assert excinfo.value.status == 404
        assert excinfo.value.code == "skillset_not_found"

    @respx.mock
    def test_publish_skillset_puts_json(self) -> None:
        route = respx.put(f"{BASE}/api/v1/skillsets/ss-1").respond(
            200, json={"data": _skillset_data(version="1.1", latestVersion="1.1"), "error": None}
        )
        with make_client() as ornn:
            result = ornn.publish_skillset(
                "ss-1",
                members=["a@1.0", "b@1.0"],
                version="1.1",
                instructions="v1.1 prompt: b first this time",
            )
        assert route.called
        assert route.calls.last.request.method == "PUT"
        import json as _json

        sent = _json.loads(route.calls.last.request.content)
        # The master prompt (#978) is sent on publish too (no carry-forward).
        assert sent["instructions"] == "v1.1 prompt: b first this time"
        assert result.version == "1.1"

    @respx.mock
    def test_set_skillset_permissions_unwraps_envelope(self) -> None:
        respx.put(f"{BASE}/api/v1/skillsets/ss-1/permissions").respond(
            200,
            json={"data": {"skillset": _skillset_data(isPrivate=False)}, "error": None},
        )
        with make_client() as ornn:
            result = ornn.set_skillset_permissions("ss-1", is_private=False)
        assert result.guid == "ss-1"
        assert result.is_private is False

    @respx.mock
    def test_set_skillset_permissions_omits_grants_when_not_passed(self) -> None:
        # Pre-#1123 behaviour: no `grants` key on the wire so the server
        # falls back to the legacy lists.
        import json as _json

        route = respx.put(f"{BASE}/api/v1/skillsets/ss-1/permissions").respond(
            200,
            json={"data": {"skillset": _skillset_data(isPrivate=True)}, "error": None},
        )
        with make_client() as ornn:
            ornn.set_skillset_permissions("ss-1", is_private=True, shared_with_users=["alice"])
        sent = _json.loads(route.calls.last.request.content)
        assert "grants" not in sent
        assert sent["sharedWithUsers"] == ["alice"]

    @respx.mock
    def test_delete_skillset_fires_delete(self) -> None:
        route = respx.delete(f"{BASE}/api/v1/skillsets/ss-1").respond(
            200, json={"data": {"success": True}, "error": None}
        )
        with make_client() as ornn:
            ornn.delete_skillset("ss-1")
        assert route.called
        assert route.calls.last.request.method == "DELETE"

    @respx.mock
    def test_resolve_skillset_closure_parses_items(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skillsets/review-set/closure").respond(
            200,
            json={
                "data": {
                    "instructions": "master prompt: leaf-d feeds pdf-tools",
                    "items": [
                        {"guid": "g-d", "name": "leaf-d", "version": "1.0", "depth": 1},
                        {"guid": "g-a", "name": "pdf-tools", "version": "1.0", "depth": 0},
                    ],
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.resolve_skillset_closure("review-set", version="1.0")
        assert [n.name for n in result.items] == ["leaf-d", "pdf-tools"]
        # The master prompt (#978) parses as a root sibling of items.
        assert result.instructions == "master prompt: leaf-d feeds pdf-tools"
        assert route.calls.last.request.url.params["version"] == "1.0"

    @respx.mock
    def test_resolve_skillset_closure_raises_on_conflict(self) -> None:
        respx.get(f"{BASE}/api/v1/skillsets/ss-1/closure").respond(
            409,
            json={"status": 409, "code": "dependency_conflict", "detail": "two versions"},
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.resolve_skillset_closure("ss-1")
        assert excinfo.value.status == 409
        assert excinfo.value.code == "dependency_conflict"

    @respx.mock
    def test_search_skillsets_forwards_kind_and_tags(self) -> None:
        route = respx.get(f"{BASE}/api/v1/skillset-search").respond(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "guid": "ss-1",
                            "name": "review-set",
                            "description": "d",
                            "kind": "consensus-supported",
                            "tags": ["alpha"],
                            "memberCount": 2,
                            "latestVersion": "1.0",
                            "isPrivate": False,
                            "createdBy": "owner-1",
                            "createdOn": "2026-01-01T00:00:00Z",
                            "updatedOn": "2026-01-01T00:00:00Z",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "pageSize": 20,
                    "totalPages": 1,
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.search_skillsets(kind="consensus-supported", tag="alpha", scope="public")
        params = route.calls.last.request.url.params
        assert params["kind"] == "consensus-supported"
        assert params["tags"] == "alpha"
        assert params["scope"] == "public"
        assert result.items[0].kind == "consensus-supported"
        assert result.items[0].member_count == 2


def _skill_data(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": "sk-1",
        "name": "pdf-extract",
        "description": "Extract pdf text",
        "isPrivate": True,
        "createdBy": "owner-1",
        "createdOn": "2026-01-01T00:00:00Z",
        "latestVersion": "1.0",
    }
    base.update(overrides)
    return base


class TestPermissionGrants:
    """Typed ACL grants on skills + skillsets (#1123)."""

    @respx.mock
    def test_set_skill_permissions_sends_grants_and_unwraps_skill(self) -> None:
        import json as _json

        route = respx.put(f"{BASE}/api/v1/skills/sk-1/permissions").respond(
            200,
            json={
                "data": {
                    "skill": _skill_data(
                        isPrivate=True,
                        grants=[{"type": "user", "id": "bob", "level": "write"}],
                    )
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.set_skill_permissions(
                "sk-1",
                is_private=True,
                grants=[SkillGrant(type="user", id="bob", level="write")],
            )
        # The typed grant rides on the wire in canonical shape.
        sent = _json.loads(route.calls.last.request.content)
        assert sent["isPrivate"] is True
        assert sent["grants"] == [{"type": "user", "id": "bob", "level": "write"}]
        # Response `{ skill }` envelope is unwrapped + grants parse back.
        assert isinstance(result, SkillDetail)
        assert result.grants == [SkillGrant(type="user", id="bob", level="write")]
        assert route.called

    @respx.mock
    def test_set_skill_permissions_omits_grants_when_not_passed(self) -> None:
        import json as _json

        route = respx.put(f"{BASE}/api/v1/skills/sk-1/permissions").respond(
            200, json={"data": {"skill": _skill_data()}, "error": None}
        )
        with make_client() as ornn:
            ornn.set_skill_permissions("sk-1", is_private=False, shared_with_orgs=["acme"])
        sent = _json.loads(route.calls.last.request.content)
        assert "grants" not in sent
        assert sent["sharedWithOrgs"] == ["acme"]

    @respx.mock
    def test_set_skillset_permissions_sends_grants(self) -> None:
        import json as _json

        route = respx.put(f"{BASE}/api/v1/skillsets/ss-1/permissions").respond(
            200,
            json={
                "data": {
                    "skillset": _skillset_data(
                        grants=[{"type": "org", "id": "acme", "level": "read"}]
                    )
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            result = ornn.set_skillset_permissions(
                "ss-1",
                is_private=True,
                grants=[SkillGrant(type="org", id="acme", level="read")],
            )
        sent = _json.loads(route.calls.last.request.content)
        assert sent["grants"] == [{"type": "org", "id": "acme", "level": "read"}]
        assert result.grants == [SkillGrant(type="org", id="acme", level="read")]

    @respx.mock
    def test_skill_detail_parses_grants(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/sk-1").respond(
            200,
            json={
                "data": _skill_data(
                    grants=[
                        {"type": "user", "id": "u1", "level": "read"},
                        {"type": "org", "id": "o1", "level": "write"},
                    ]
                ),
                "error": None,
            },
        )
        with make_client() as ornn:
            detail = ornn.get("sk-1")
        assert detail.grants == [
            SkillGrant(type="user", id="u1", level="read"),
            SkillGrant(type="org", id="o1", level="write"),
        ]

    @respx.mock
    def test_skill_detail_defaults_grants_empty_when_absent(self) -> None:
        # Pre-#1123 API response carries no `grants` key.
        respx.get(f"{BASE}/api/v1/skills/sk-1").respond(
            200, json={"data": _skill_data(), "error": None}
        )
        with make_client() as ornn:
            detail = ornn.get("sk-1")
        assert detail.grants == []


class TestTransferOwnership:
    """Ownership transfer for skills + skillsets (#1123)."""

    @respx.mock
    def test_transfer_skill_ownership_posts_new_owner_and_unwraps(self) -> None:
        import json as _json

        route = respx.post(f"{BASE}/api/v1/skills/sk-1/transfer-ownership").respond(
            200,
            json={"data": {"skill": _skill_data(createdBy="alice")}, "error": None},
        )
        with make_client() as ornn:
            result = ornn.transfer_skill_ownership("sk-1", "alice")
        assert route.calls.last.request.method == "POST"
        sent = _json.loads(route.calls.last.request.content)
        assert sent == {"newOwnerUserId": "alice"}
        assert isinstance(result, SkillDetail)
        assert result.created_by == "alice"

    @respx.mock
    def test_transfer_skillset_ownership_posts_new_owner_and_unwraps(self) -> None:
        import json as _json

        route = respx.post(f"{BASE}/api/v1/skillsets/ss-1/transfer-ownership").respond(
            200,
            json={"data": {"skillset": _skillset_data(createdBy="alice")}, "error": None},
        )
        with make_client() as ornn:
            result = ornn.transfer_skillset_ownership("ss-1", "alice")
        assert route.calls.last.request.method == "POST"
        sent = _json.loads(route.calls.last.request.content)
        assert sent == {"newOwnerUserId": "alice"}
        assert result.created_by == "alice"

    @respx.mock
    def test_transfer_skill_ownership_raises_on_invalid_target(self) -> None:
        # Target who never signed in to Ornn → 400 invalid_transfer_target.
        respx.post(f"{BASE}/api/v1/skills/sk-1/transfer-ownership").respond(
            400,
            json={
                "type": "https://github.com/.../ERRORS.md#invalid_transfer_target",
                "title": "Invalid transfer target",
                "status": 400,
                "code": "invalid_transfer_target",
                "detail": "unknown Ornn user",
                "instance": "/v1/skills/sk-1/transfer-ownership",
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.transfer_skill_ownership("sk-1", "ghost")
        assert excinfo.value.status == 400
        assert excinfo.value.code == "invalid_transfer_target"
