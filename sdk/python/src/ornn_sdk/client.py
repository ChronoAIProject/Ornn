"""Ornn HTTP client (sync).

Thin wrapper over httpx that mirrors the TypeScript SDK:

* Path prefixing -- every call hits ``/api/v1/*``
* Auth header injection -- static token or a ``token_resolver`` callable
* Response envelope unwrapping -- ``{data, error}`` -> ``data`` or raises :class:`OrnnError`
* Structured error propagation via :class:`OrnnError`

The client is synchronous by default (easier in notebooks, scripts, simple
agents). An async flavor can be added later by swapping ``httpx.Client``
for ``httpx.AsyncClient``; the shape is identical.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

import httpx

from .errors import OrnnError
from .types import (
    SearchMode,
    SearchScope,
    SkillDetail,
    SkillSearchResult,
    SkillVersionEntry,
    SystemFilter,
    UpdateSkillMetadata,
)


class OrnnClient:
    """Synchronous client for Ornn's ``/api/v1/*`` surface.

    Example:

        >>> from ornn_sdk import OrnnClient
        >>> ornn = OrnnClient(
        ...     base_url="https://ornn.chrono-ai.fun",
        ...     token=os.environ["NYXID_ACCESS_TOKEN"],
        ... )
        >>> result = ornn.search(q="pdf", scope="public")
        >>> for skill in result.items:
        ...     print(skill.id, skill.name)

    For dynamic token refresh, pass a ``token_resolver`` callable instead
    of a static ``token``::

        >>> ornn = OrnnClient(
        ...     base_url="https://ornn.chrono-ai.fun",
        ...     token_resolver=lambda: session.access_token(),
        ... )
    """

    def __init__(
        self,
        *,
        base_url: str,
        token: str | None = None,
        token_resolver: Callable[[], str] | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float | httpx.Timeout = 30.0,
    ) -> None:
        if not base_url:
            raise ValueError("OrnnClient: base_url is required")
        self._base_url = base_url.rstrip("/")
        self._static_token = token
        self._token_resolver = token_resolver
        self._http = httpx.Client(
            base_url=f"{self._base_url}/api/v1",
            transport=transport,
            timeout=timeout,
        )

    # ---- Resource lifecycle -------------------------------------------------

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> OrnnClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ---- Public API ---------------------------------------------------------

    def search(
        self,
        *,
        q: str | None = None,
        scope: SearchScope | None = None,
        category: str | None = None,
        tag: str | None = None,
        runtime: str | None = None,
        mode: SearchMode | None = None,
        system_filter: SystemFilter | None = None,
        page: int | None = None,
        page_size: int | None = None,
    ) -> SkillSearchResult:
        """Search skills. Returns a paginated :class:`SkillSearchResult`."""
        params: dict[str, str] = {}
        if q is not None:
            # Canonical search param is `q` per CONVENTIONS.md §4.1 (#586).
            params["q"] = q
        if scope is not None:
            params["scope"] = scope
        if category is not None:
            params["category"] = category
        if tag is not None:
            params["tag"] = tag
        if runtime is not None:
            params["runtime"] = runtime
        if mode is not None:
            params["mode"] = mode
        if system_filter is not None:
            params["systemFilter"] = system_filter
        if page is not None:
            params["page"] = str(page)
        if page_size is not None:
            params["pageSize"] = str(page_size)
        qs = f"?{urlencode(params)}" if params else ""
        data = self.request("GET", f"/skill-search{qs}")
        return SkillSearchResult.from_dict(data)

    def get(self, guid_or_name: str, *, version: str | None = None) -> SkillDetail:
        """Fetch a single skill by GUID or name."""
        suffix = f"?version={httpx.QueryParams({'version': version})['version']}" if version else ""
        data = self.request("GET", f"/skills/{_quote(guid_or_name)}{suffix}")
        return SkillDetail.from_dict(data)

    def list_versions(self, guid_or_name: str) -> list[SkillVersionEntry]:
        """List versions for a skill (newest first)."""
        data = self.request("GET", f"/skills/{_quote(guid_or_name)}/versions")
        return [SkillVersionEntry.from_dict(v) for v in data.get("items") or []]

    def download_package(self, guid: str, version: str) -> bytes:
        """Download a skill package ZIP. Returns raw bytes."""
        path = f"/skills/{_quote(guid)}/versions/{_quote(version)}/download"
        res = self._raw_request("GET", path)
        if res.status_code >= 400:
            raise _build_error(res)
        # httpx exposes res.content as bytes at runtime; the typeshed
        # stub annotates it as Any. Cast explicitly so strict mypy is
        # happy without disabling the rule.
        return bytes(res.content)

    def publish(self, zip_bytes: bytes, *, skip_validation: bool = False) -> SkillDetail:
        """Publish a new skill from a ZIP package (raw bytes)."""
        qs = "?skip_validation=true" if skip_validation else ""
        data = self.request(
            "POST",
            f"/skills{qs}",
            content=zip_bytes,
            headers={"Content-Type": "application/zip"},
        )
        return SkillDetail.from_dict(data)

    def update(
        self,
        skill_id: str,
        *,
        metadata: UpdateSkillMetadata | dict[str, Any] | None = None,
        zip_bytes: bytes | None = None,
        skip_validation: bool = False,
    ) -> SkillDetail:
        """Update metadata or publish a new version.

        Exactly one of ``metadata`` or ``zip_bytes`` must be provided.
        """
        if (metadata is None) == (zip_bytes is None):
            raise ValueError(
                "update(): exactly one of metadata or zip_bytes must be provided",
            )
        qs = "?skip_validation=true" if skip_validation else ""
        if zip_bytes is not None:
            data = self.request(
                "PUT",
                f"/skills/{_quote(skill_id)}{qs}",
                content=zip_bytes,
                headers={"Content-Type": "application/zip"},
            )
        else:
            payload = (
                metadata.to_json()
                if isinstance(metadata, UpdateSkillMetadata)
                else (metadata or {})
            )
            data = self.request(
                "PUT",
                f"/skills/{_quote(skill_id)}{qs}",
                json=payload,
            )
        return SkillDetail.from_dict(data)

    def delete(self, skill_id: str) -> None:
        """Delete a skill by ID."""
        self.request("DELETE", f"/skills/{_quote(skill_id)}")

    # ---- Escape hatch -------------------------------------------------------

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Issue any HTTP request against ``/api/v1{path}`` with auth + envelope handling.

        Returns the unwrapped ``data`` field on success. Raises
        :class:`OrnnError` on any failure.

        Success responses keep the legacy ``{data, error: null}`` envelope.
        Error responses are RFC 7807 ``application/problem+json`` (#456) —
        fields at the body root.
        """
        res = self._raw_request(method, path, **kwargs)
        body: Any = None
        try:
            body = res.json()
        except ValueError:
            body = None
        if res.status_code >= 400:
            raise _build_error(res, body)
        if not isinstance(body, dict) or body.get("error") is not None:
            raise OrnnError(
                status=res.status_code,
                code="unknown_error",
                message=f"Ornn API returned {res.status_code} with an unexpected body shape",
            )
        return body.get("data")

    # ---- Plumbing -----------------------------------------------------------

    def _raw_request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers: dict[str, str] = dict(kwargs.pop("headers", {}) or {})
        token = self._token_resolver() if self._token_resolver else self._static_token
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return self._http.request(method, path, headers=headers, **kwargs)


def _quote(segment: str) -> str:
    """URL-encode a single path segment (fwd slashes encoded)."""
    from urllib.parse import quote

    return quote(segment, safe="")


def _build_error(res: httpx.Response, body: Any | None = None) -> OrnnError:
    """Build an OrnnError from an RFC 7807 problem+json response (#456).

    Fields live at the body root now (``code``, ``status``, ``detail``,
    ``title``, ``type``, ``instance``, ``requestId``, optional
    ``errors[]``). The pre-#456 ``{data, error: {…}}`` envelope is no
    longer emitted.
    """
    if body is None:
        try:
            body = res.json()
        except ValueError:
            body = None
    if isinstance(body, dict) and (body.get("code") or body.get("detail") or body.get("title")):
        message = body.get("detail") or body.get("title") or f"Ornn API returned {res.status_code}"
        return OrnnError(
            status=int(body.get("status") or res.status_code),
            code=str(body.get("code") or "unknown_error"),
            message=str(message),
            request_id=body.get("requestId"),
            errors=list(body.get("errors") or []) or None,
        )
    return OrnnError(
        status=res.status_code,
        code="unknown_error",
        message=f"Ornn API returned {res.status_code} without a recognized error body",
    )
