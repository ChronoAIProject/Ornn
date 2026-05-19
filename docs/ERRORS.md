# Ornn API Error Catalog

Every error response from `/api/v1/*` carries a stable `code` (string) and the matching `type` URL points back to a section in this document via GitHub anchor link:

```
type: https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#<code>
```

The catalog is normative — handlers MUST NOT invent new codes. Adding or renaming a code requires updating this doc and `docs/CONVENTIONS.md` §1.4 in the same PR.

> **Note — code-case migration.** [`docs/CONVENTIONS.md`](CONVENTIONS.md) §1.4 mandates `lowercase_snake_case` codes; the current implementation still emits `SCREAMING_SNAKE_CASE`. Tracked in [#585](https://github.com/ChronoAIProject/Ornn/issues/585). Until that lands, headings below show **both** forms so an anchor link works no matter which the server emitted today.

---

## Table of Contents

**By HTTP status**

- 400 — [`validation_error`](#validation_error)
- 401 — [`authentication_required`](#authentication_required)
- 403 — [`permission_denied`](#permission_denied)
- 404 — [`resource_not_found`](#resource_not_found)
- 409 — [`resource_conflict`](#resource_conflict)
- 413 — [`payload_too_large`](#payload_too_large)
- 415 — [`unsupported_media_type`](#unsupported_media_type)
- 429 — [`rate_limited`](#rate_limited)
- 500 — [`internal_error`](#internal_error)
- 502 / 503 — [`upstream_unavailable`](#upstream_unavailable)

**Implementation-code appendix** — every `SCREAMING_SNAKE_CASE` code currently emitted by the server, with the target lowercase code it maps to: [Appendix](#appendix-current-implementation-codes).

---

## validation_error

**HTTP:** `400 Bad Request`
**Current code (pre-#585):** `INVALID_BODY`, `INVALID_QUERY`, `INVALID_PARAMS`, `INVALID_CONTENT_TYPE`, `INVALID_*`, `EMPTY_BODY`, `MISSING_*`, `FRONTMATTER_VALIDATION_FAILED`, `INVALID_PERMISSIONS`, …

Request body, query string, or path parameter failed validation. Per-field details are in `errors[]`.

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json

{
  "type": "https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#validation_error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request body failed validation",
  "instance": "/v1/skills/abc/permissions",
  "requestId": "req_01HXYZ...",
  "errors": [
    { "path": "sharedWithUsers[3]", "code": "invalid_user_id", "message": "..." }
  ]
}
```

**Client action:** fix the offending field(s) listed in `errors[]` and retry. Do not retry the same payload without changes.

---

## authentication_required

**HTTP:** `401 Unauthorized`
**Current code (pre-#585):** `AUTH_MISSING`, `AUTH_INVALID`

No identity could be resolved from the request — either no `Authorization` header, an unparseable header, or the token is expired / revoked.

**Client action:** refresh the access token (via NyxID) and retry once. If refresh fails, the user needs to re-authenticate.

---

## permission_denied

**HTTP:** `403 Forbidden`
**Current code (pre-#585):** `FORBIDDEN`, `INSUFFICIENT_PERMISSIONS`

The caller is authenticated but lacks the permission required for this resource or action. The response `detail` names the missing permission when safe to disclose.

**Client action:** check the user's roles / org membership against [`docs/CONVENTIONS.md`](CONVENTIONS.md) §5. Surface the gap to the user; do not silently retry.

---

## resource_not_found

**HTTP:** `404 Not Found`
**Current code (pre-#585):** `SKILL_NOT_FOUND`, `SKILL_VERSION_NOT_FOUND`, `ORG_NOT_FOUND`, `PROVIDER_NOT_FOUND`, `ANNOUNCEMENT_NOT_FOUND`, `BROADCAST_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `AUDIT_NOT_FOUND`, `REDEMPTION_CODE_NOT_FOUND`, …

The target resource does not exist, **or** it exists but is not visible to the caller (private skill outside their access scope). The two cases are intentionally not distinguished — disclosing existence is itself information.

**Client action:** for known-good identifiers, this likely means a visibility issue. For typed identifiers, verify the GUID / name.

---

## resource_conflict

**HTTP:** `409 Conflict`
**Current code (pre-#585):** `SKILL_NAME_EXISTS`, `NAME_CONFLICT`, `VERSION_CONFLICT`, `RECONCILE_ALREADY_RUNNING`, …

The request collides with current state — a duplicate skill name on create, a concurrent modification, a job that's already running, etc.

**Client action:** read `detail` to decide. For duplicates, prompt the user for a different value. For concurrent modifications, refetch and retry.

---

## payload_too_large

**HTTP:** `413 Payload Too Large`
**Current code (pre-#585):** `PAYLOAD_TOO_LARGE`

The upload exceeds the per-endpoint size cap (currently 5 MB on `/skills` upload; see `ornn-api/src/middleware/uploadLimit.ts`).

**Client action:** trim the payload (smaller ZIP, fewer attachments) or split into multiple requests where the endpoint supports it.

---

## unsupported_media_type

**HTTP:** `415 Unsupported Media Type`
**Current code (pre-#585):** `INVALID_CONTENT_TYPE`

The `Content-Type` header is missing or names a representation this endpoint does not accept. Skill upload requires `application/zip`; most write endpoints require `application/json`.

**Client action:** set the correct `Content-Type` header and retry.

---

## rate_limited

**HTTP:** `429 Too Many Requests`
**Current code (pre-#585):** *not yet emitted — see [#439](https://github.com/ChronoAIProject/Ornn/issues/439) (rate limit middleware).*

Caller exceeded a rate limit (per-IP for unauthenticated routes, per-user for authenticated). Once [#460](https://github.com/ChronoAIProject/Ornn/issues/460) lands, response will also include the standard RFC 9239 headers (`RateLimit-Limit`, `RateLimit-Remaining`, `Retry-After`).

**Client action:** honour `Retry-After` (seconds). SDK retry wrappers should back off exponentially with jitter, capped at the `Retry-After` value.

---

## internal_error

**HTTP:** `500 Internal Server Error`
**Current code (pre-#585):** `INTERNAL_ERROR`, `INTERNAL`

Unhandled server error — should never appear under normal operation. The `requestId` is the load-bearing field for log correlation.

**Client action:** capture `requestId` and report. Safe to retry once; do not retry tighter than every few seconds.

---

## upstream_unavailable

**HTTP:** `502 Bad Gateway` / `503 Service Unavailable`
**Current code (pre-#585):** `UPSTREAM_DOWN`, `MIRROR_DISABLED`, `AGENTSEAL_DISABLED`, `PULL_FAILED`, `REPO_FETCH_FAILED`, …

A dependency Ornn relies on (NyxID, OpenSandbox, LLM provider, mirror target, …) is unavailable or refused the request. Distinct from `internal_error` — Ornn itself is fine but couldn't complete the work.

**Client action:** retry with exponential backoff. If the failure persists, check [status.chrono-ai.fun](https://status.chrono-ai.fun) (when published) or [Discussions → Q&A](https://github.com/ChronoAIProject/Ornn/discussions/categories/q-a).

---

## Appendix: current implementation codes

The table below maps every `SCREAMING_SNAKE_CASE` code currently emitted by the server to its target lowercase code from `docs/CONVENTIONS.md` §1.4. Tracking renames lives in [#585](https://github.com/ChronoAIProject/Ornn/issues/585).

| Current code | HTTP | Target |
|---|---|---|
| `AGENTSEAL_DISABLED` | 503 | `upstream_unavailable` |
| `ANNOUNCEMENT_NOT_FOUND` | 404 | `resource_not_found` |
| `AUDIT_NOT_FOUND` | 404 | `resource_not_found` |
| `AUTH_INVALID` | 401 | `authentication_required` |
| `AUTH_MISSING` | 401 | `authentication_required` |
| `BROADCAST_NOT_FOUND` | 404 | `resource_not_found` |
| `EMPTY_BODY` | 400 | `validation_error` |
| `EMPTY_SOURCE` | 400 | `validation_error` |
| `FORBIDDEN` | 403 | `permission_denied` |
| `FRONTMATTER_VALIDATION_FAILED` | 400 | `validation_error` |
| `INSUFFICIENT_PERMISSIONS` | 403 | `permission_denied` |
| `INTERNAL` | 500 | `internal_error` |
| `INTERNAL_ERROR` | 500 | `internal_error` |
| `INVALID_*` (`_ANNOUNCEMENT_INPUT`, `_BODY`, `_CONTENT_TYPE`, `_GRANT_AMOUNT`, `_PERMISSIONS`, `_PROVIDER_INPUT`, `_RANGE`, `_REDEMPTION_CODE_BODY`, `_REDEMPTION_CODE_ID`, `_ROLE`, `_SCOPE`, `_SETTING`, `_SURFACE`, `_USER_ID`, `_VERSION`, `_PARAMS`, `_QUERY`) | 400 / 415 | `validation_error` / `unsupported_media_type` |
| `MIRROR_DISABLED` | 503 | `upstream_unavailable` |
| `MISSING_FRONTMATTER` | 400 | `validation_error` |
| `MISSING_PROMPT` | 400 | `validation_error` |
| `MISSING_SKILL_MD` | 400 | `validation_error` |
| `MISSING_SPEC` | 400 | `validation_error` |
| `NOTIFICATION_NOT_FOUND` | 404 | `resource_not_found` |
| `NO_UPDATE` | 400 | `validation_error` |
| `ORG_NOT_FOUND` | 404 | `resource_not_found` |
| `PAYLOAD_TOO_LARGE` | 413 | `payload_too_large` |
| `PROVIDER_NOT_FOUND` | 404 | `resource_not_found` |
| `PULL_FAILED` | 502 | `upstream_unavailable` |
| `QUOTA_EXCEEDED` | 429 | `rate_limited` |
| `RECONCILE_ALREADY_RUNNING` | 409 | `resource_conflict` |
| `REDEMPTION_CODE_EXPIRED` | 409 | `resource_conflict` |
| `REDEMPTION_CODE_NOT_FOUND` | 404 | `resource_not_found` |
| `REFRESH_FAILED` | 502 | `upstream_unavailable` |
| `REFRESH_PREVIEW_FAILED` | 502 | `upstream_unavailable` |
| `REPO_FETCH_FAILED` | 502 | `upstream_unavailable` |
| `SKILL_NAME_EXISTS` | 409 | `resource_conflict` |
| `SKILL_NOT_FOUND` | 404 | `resource_not_found` |
| `SKILL_VERSION_NOT_FOUND` | 404 | `resource_not_found` |
| `UPSTREAM_DOWN` | 502 | `upstream_unavailable` |

This list is exhaustive at the time of writing — if you spot a code that's emitted in production but missing here, open a `[Docs]` issue.
