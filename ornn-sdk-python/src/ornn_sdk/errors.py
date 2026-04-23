"""Error types for the Ornn SDK.

Mirrors the TypeScript SDK's `OrnnError` shape so users who have agents
written in both languages see the same surface:

    status      -- HTTP status from the response (0 if the request never reached the server)
    code        -- lowercase snake_case code (per docs/conventions.md §1.4)
    message     -- human-readable message safe to surface
    request_id  -- server-side correlation id, when available
    errors      -- structured validation errors (list of dicts), when available
"""

from __future__ import annotations

from typing import Any


class OrnnError(Exception):
    """Raised on any non-2xx response, or a 2xx response with a failure envelope."""

    def __init__(
        self,
        *,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.errors = errors

    def __repr__(self) -> str:
        return (
            f"OrnnError(status={self.status}, code={self.code!r}, "
            f"message={self.message!r}, request_id={self.request_id!r})"
        )
