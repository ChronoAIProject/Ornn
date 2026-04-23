"""Tests for OrnnClient. Mocks httpx transport via respx so no network is required."""

from __future__ import annotations

import httpx
import pytest
import respx

from ornn_sdk import (
    OrnnClient,
    OrnnError,
    SkillDetail,
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
        route = respx.get(f"{BASE}/api/v1/me").respond(
            200, json={"data": {}, "error": None}
        )
        with make_client(
            token="tok_static",
            token_resolver=lambda: "tok_dynamic",
        ) as ornn:
            ornn.request("GET", "/me")
        assert route.calls.last.request.headers["authorization"] == "Bearer tok_dynamic"

    @respx.mock
    def test_no_auth_header_when_no_token(self) -> None:
        route = respx.get(f"{BASE}/api/v1/public").respond(
            200, json={"data": {}, "error": None}
        )
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
    def test_raises_ornn_error_on_failure_envelope(self) -> None:
        respx.get(f"{BASE}/api/v1/admin").respond(
            403,
            json={
                "data": None,
                "error": {
                    "code": "permission_denied",
                    "message": "Missing ornn:skill:admin",
                    "requestId": "req_01HXYZ",
                },
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
        respx.post(f"{BASE}/api/v1/skills").respond(
            400,
            json={
                "data": None,
                "error": {
                    "code": "validation_error",
                    "message": "Validation failed",
                    "errors": [
                        {"path": "name", "code": "required", "message": "name is required"},
                    ],
                },
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
    def test_maps_q_to_query_param(self) -> None:
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
        assert "query=pdf" in req_url
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
                    "ownerId": "u1",
                },
                "error": None,
            },
        )
        with make_client() as ornn:
            detail = ornn.get("my/weird name")
        assert isinstance(detail, SkillDetail)
        assert detail.owner_id == "u1"
        assert route.called

    @respx.mock
    def test_raises_ornn_error_on_404(self) -> None:
        respx.get(f"{BASE}/api/v1/skills/nope").respond(
            404,
            json={
                "data": None,
                "error": {"code": "resource_not_found", "message": "no such skill"},
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
                "data": None,
                "error": {"code": "resource_not_found", "message": "no such version"},
            },
        )
        with make_client() as ornn:
            with pytest.raises(OrnnError) as excinfo:
                ornn.download_package("abc", "9.9")
        assert excinfo.value.status == 404
        assert excinfo.value.code == "resource_not_found"


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
                    "ownerId": "u1",
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
                    "ownerId": "admin",
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
                    "ownerId": "u1",
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
                    "ownerId": "u1",
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
