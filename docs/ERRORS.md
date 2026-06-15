# Ornn API Error Catalog

Every error response from `/api/v1/*` carries a stable `code` (string) and the matching `type` URL points back to a section in this document via GitHub anchor link:

```
type: https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#<code>
```

The catalog is normative — handlers MUST NOT invent new codes. Adding or renaming a code requires updating this doc and `docs/CONVENTIONS.md` §1.4 in the same PR.

All codes are `lowercase_snake_case` per CONVENTIONS.md §1.4. The §1.4 catalog defines the **parent** taxonomy (`validation_error`, `permission_denied`, `resource_not_found`, …); specific subcodes (e.g. `skill_not_found` under `resource_not_found`) live under the parent's section here and follow the same lowercase format.

The pre-#585 `SCREAMING_SNAKE_CASE` shape (`SKILL_NOT_FOUND`, `INVALID_BODY`, …) is no longer emitted. Clients that pinned to those strings need to switch to the lowercase form on the next SDK bump.

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

**Pre-#585 migration map** — every `SCREAMING_SNAKE_CASE` code clients used to receive, with the new `lowercase_snake_case` it became: [Appendix](#appendix-pre-585-migration-map).

---

## validation_error

**HTTP:** `400 Bad Request`
**Common subcodes (lowercase post-#585):** `invalid_body`, `invalid_query`, `invalid_params`, `invalid_*` (per-field), `empty_body`, `missing_*`, `frontmatter_validation_failed`, `invalid_permissions`, `invalid_permission_level`, `invalid_transfer_target`, `invalid_zip`, …

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

### invalid_zip

The uploaded payload is not a parseable ZIP — a malformed or unreadable archive.

**Client action:** re-create the ZIP and re-upload; do not retry the same bytes.

### invalid_permission_level

A typed `grants` entry on a permissions request (#1123) carried a `level` outside the allowed set. The only accepted values are `read` and `read_write` (see [`docs/CONVENTIONS.md`](CONVENTIONS.md) §5.4). Surfaced from `PUT /api/v1/skills/{id}/permissions` and `PUT /api/v1/skillsets/{id}/permissions`.

**Client action:** set every grant's `level` to `read` or `read_write` and retry.

### invalid_transfer_target

The `newOwnerUserId` supplied to `POST /api/v1/skills/{id}/transfer-ownership` or `POST /api/v1/skillsets/{id}/transfer-ownership` (#1123) does not resolve to a known Ornn user — the target has never signed in to Ornn, so the directory cannot resolve them. The transfer is rejected before any mutation.

**Client action:** confirm the target user has signed in to Ornn at least once, then retry with their resolved user id. Do not retry the same id without that change.

---

## authentication_required

**HTTP:** `401 Unauthorized`
**Common subcodes (lowercase post-#585):** `auth_missing`, `auth_invalid`

No identity could be resolved from the request — either no `Authorization` header, an unparseable header, or the token is expired / revoked.

**Client action:** refresh the access token (via NyxID) and retry once. If refresh fails, the user needs to re-authenticate.

---

## permission_denied

**HTTP:** `403 Forbidden`
**Common subcodes (lowercase post-#585):** `forbidden`, `insufficient_permissions`

The caller is authenticated but lacks the permission required for this resource or action. The response `detail` names the missing permission when safe to disclose.

**Client action:** check the user's roles / org membership against [`docs/CONVENTIONS.md`](CONVENTIONS.md) §5. Surface the gap to the user; do not silently retry.

---

## resource_not_found

**HTTP:** `404 Not Found`
**Common subcodes (lowercase post-#585):** `skill_not_found`, `skill_version_not_found`, `skill_dependency_not_found`, `skillset_not_found`, `skillset_version_not_found`, `org_not_found`, `provider_not_found`, `announcement_not_found`, `broadcast_not_found`, `notification_not_found`, `audit_not_found`, `redemption_code_not_found`, …

The target resource does not exist, **or** it exists but is not visible to the caller (private skill outside their access scope). The two cases are intentionally not distinguished — disclosing existence is itself information.

**Client action:** for known-good identifiers, this likely means a visibility issue. For typed identifiers, verify the GUID / name.

### skill_dependency_not_found

A skill in a dependency closure (#968) could not be resolved — either the referenced `<name-or-guid>@<version>` / `<name>@<dist-tag>` does not exist, or it is a private skill the caller cannot read. Surfaced at publish time (a new version declares a `depends-on` ref that won't resolve) and from `GET /api/v1/skills/{id}/closure`. The **skillset** closure + publish paths (#969) reuse this code verbatim — a skillset member ref, or a member's transitive dependency, that won't resolve surfaces here too. As with every `resource_not_found`, "missing" and "not visible" are intentionally indistinguishable.

**Client action:** verify each `depends-on` ref points at a published, readable skill version. Publish or share the dependency first, then retry.

---

## resource_conflict

**HTTP:** `409 Conflict`
**Common subcodes (lowercase post-#585):** `skill_name_exists`, `skillset_name_exists`, `skillset_version_exists`, `dependency_cycle`, `dependency_conflict`, `ownership_conflict`, `reconcile_already_running`, `redemption_code_expired`, `redemption_code_already_redeemed`, `redemption_code_already_invalidated`, `old_repo_not_confirmed`, …

The request collides with current state — a duplicate skill name on create, a concurrent modification, a job that's already running, etc.

**Client action:** read `detail` to decide. For duplicates, prompt the user for a different value. For concurrent modifications, refetch and retry.

### dependency_cycle

The skill dependency graph (#968) contains a cycle — following `depends-on` refs eventually loops back to a skill already on the path. A closure with a cycle cannot be installed in any order. Surfaced at publish time and from `GET /api/v1/skills/{id}/closure`, and identically from the skillset closure/publish paths (#969).

**Client action:** break the cycle by removing one of the offending `depends-on` refs. The `detail` names a skill involved in the loop.

### dependency_conflict

Two different versions of the **same** skill appear in one dependency closure (#968) — e.g. `a` depends on `b@1.0` while `a`'s other dependency `c` depends on `b@2.0`. Only one version of a given skill can be installed in a closure. The skillset closure (#969) reuses this verbatim: two members (or their transitive deps) that pin the same skill to different versions collide here.

**Client action:** align the conflicting pins so every path resolves the skill to the same `<major.minor>` version, then retry.

### ownership_conflict

A `POST /api/v1/skills/{id}/transfer-ownership` or `POST /api/v1/skillsets/{id}/transfer-ownership` (#1123) named the **current** owner as `newOwnerUserId` — a no-op transfer. The target already owns the resource, so the request is rejected rather than silently succeeding.

**Client action:** if a transfer is actually intended, supply a different `newOwnerUserId`. If the resource is already owned by the intended user, no action is needed.

---

## payload_too_large

**HTTP:** `413 Payload Too Large`
**Common subcodes (lowercase post-#585):** `payload_too_large`, `uncompressed_too_large`, `too_many_files`

The upload exceeds the per-endpoint size cap (currently 5 MB on `/skills` upload; see `ornn-api/src/middleware/uploadLimit.ts`).

**Client action:** trim the payload (smaller ZIP, fewer attachments) or split into multiple requests where the endpoint supports it.

### uncompressed_too_large

The uploaded skill ZIP's cumulative or per-entry **uncompressed** size exceeds the server cap (`MAX_PACKAGE_UNCOMPRESSED_BYTES`, default 50 MiB / `MAX_ENTRY_UNCOMPRESSED_BYTES`, default 25 MiB), or its compression ratio exceeds `MAX_COMPRESSION_RATIO` (default 100×) — a zip-bomb guard.

**Client action:** reduce the unpacked size of the archive contents; do not retry the same ZIP.

### too_many_files

The skill ZIP contains more entries than `MAX_PACKAGE_FILE_COUNT` (default 1000).

**Client action:** prune unneeded files from the archive and re-upload.

---

## unsupported_media_type

**HTTP:** `415 Unsupported Media Type`
**Common subcodes (lowercase post-#585):** `invalid_content_type`

The `Content-Type` header is missing or names a representation this endpoint does not accept. Skill upload requires `application/zip`; most write endpoints require `application/json`.

**Client action:** set the correct `Content-Type` header and retry.

---

## rate_limited

**HTTP:** `429 Too Many Requests`
**Common subcodes (lowercase post-#585):** *not yet emitted — see [#439](https://github.com/ChronoAIProject/Ornn/issues/439) (rate limit middleware).*

Caller exceeded a rate limit (per-IP for unauthenticated routes, per-user for authenticated). Once [#460](https://github.com/ChronoAIProject/Ornn/issues/460) lands, response will also include the standard RFC 9239 headers (`RateLimit-Limit`, `RateLimit-Remaining`, `Retry-After`).

**Client action:** honour `Retry-After` (seconds). SDK retry wrappers should back off exponentially with jitter, capped at the `Retry-After` value.

---

## internal_error

**HTTP:** `500 Internal Server Error`
**Common subcodes (lowercase post-#585):** `internal_error`

Unhandled server error — should never appear under normal operation. The `requestId` is the load-bearing field for log correlation.

**Client action:** capture `requestId` and report. Safe to retry once; do not retry tighter than every few seconds.

---

## upstream_unavailable

**HTTP:** `502 Bad Gateway` / `503 Service Unavailable`
**Common subcodes (lowercase post-#585):** `upstream_down`, `mirror_disabled`, `agentseal_disabled`, `pull_failed`, `repo_fetch_failed`, `refresh_failed`, `refresh_preview_failed`, `auth_service_error`, `audit_package_unavailable`, `package_download_failed`, …

A dependency Ornn relies on (NyxID, OpenSandbox, LLM provider, mirror target, …) is unavailable or refused the request. Distinct from `internal_error` — Ornn itself is fine but couldn't complete the work.

**Client action:** retry with exponential backoff. If the failure persists, check [status.chrono-ai.fun](https://status.chrono-ai.fun) (when published) or [Discussions → Q&A](https://github.com/ChronoAIProject/Ornn/discussions/categories/q-a).

### chat_error (SSE) — `/assistant/chat`

`POST /v1/assistant/chat` (SSE; see [`docs/CONVENTIONS.md`](CONVENTIONS.md) §6.2) introduces **no new error codes** — it reuses the existing catalog. Failures before the stream opens use the normal `application/problem+json` envelope: `validation_error` (400, bad body), `authentication_required` (401), `rate_limited` (429), and — only when the caller supplies an explicit `modelId` — `MODEL_NOT_ENABLED` / `MODEL_NOT_FOUND` (400, from the per-surface model resolver). Once the stream is open, an in-stream LLM failure is delivered as an SSE `chat_error` event with `code: "upstream_unavailable"` and no terminal `chat_finish`, mirroring this section's parent code.

---

## Appendix: pre-#585 migration map

Clients pinned to the old `SCREAMING_SNAKE_CASE` codes need to switch to the lowercase forms below. Every code is now a one-for-one lowercase translation — the §1.4 parent category is the same.

| Pre-#585 code | HTTP | New code | §1.4 parent |
|---|---|---|---|
| `AGENTSEAL_DISABLED` | 503 | `agentseal_disabled` | `upstream_unavailable` |
| `ANNOUNCEMENT_NOT_FOUND` | 404 | `announcement_not_found` | `resource_not_found` |
| `AUDIT_NOT_FOUND` | 404 | `audit_not_found` | `resource_not_found` |
| `AUTH_INVALID` | 401 | `auth_invalid` | `authentication_required` |
| `AUTH_MISSING` | 401 | `auth_missing` | `authentication_required` |
| `AUTH_SERVICE_ERROR` | 503 | `auth_service_error` | `upstream_unavailable` |
| `BROADCAST_NOT_FOUND` | 404 | `broadcast_not_found` | `resource_not_found` |
| `EMPTY_BODY` | 400 | `empty_body` | `validation_error` |
| `EMPTY_SOURCE` | 400 | `empty_source` | `validation_error` |
| `FORBIDDEN` | 403 | `forbidden` | `permission_denied` |
| `FRONTMATTER_VALIDATION_FAILED` | 400 | `frontmatter_validation_failed` | `validation_error` |
| `INTERNAL` / `INTERNAL_ERROR` | 500 | `internal_error` | `internal_error` |
| `INVALID_*` (per-field) | 400 | `invalid_*` (per-field) | `validation_error` |
| `INVALID_CONTENT_TYPE` | 415 | `invalid_content_type` | `unsupported_media_type` |
| `MIRROR_DISABLED` | 503 | `mirror_disabled` | `upstream_unavailable` |
| `MISSING_*` | 400 | `missing_*` | `validation_error` |
| `NOTIFICATION_NOT_FOUND` | 404 | `notification_not_found` | `resource_not_found` |
| `NO_UPDATE` | 400 | `no_update` | `validation_error` |
| `OLD_REPO_NOT_CONFIRMED` | 409 | `old_repo_not_confirmed` | `resource_conflict` |
| `ORG_NOT_FOUND` | 404 | `org_not_found` | `resource_not_found` |
| `PACKAGE_DOWNLOAD_FAILED` | 500 | `package_download_failed` | `upstream_unavailable` |
| `PAYLOAD_TOO_LARGE` | 413 | `payload_too_large` | `payload_too_large` |
| `PROVIDER_NOT_FOUND` | 404 | `provider_not_found` | `resource_not_found` |
| `PULL_FAILED` | 502 | `pull_failed` | `upstream_unavailable` |
| `QUOTA_EXCEEDED` | 429 | `quota_exceeded` | `rate_limited` |
| `RECONCILE_ALREADY_RUNNING` | 409 | `reconcile_already_running` | `resource_conflict` |
| `REDEMPTION_CODE_*` | 404 / 409 / 410 | `redemption_code_*` | `resource_not_found` / `resource_conflict` |
| `REFRESH_FAILED` / `REFRESH_PREVIEW_FAILED` | 502 | `refresh_failed` / `refresh_preview_failed` | `upstream_unavailable` |
| `REPO_FETCH_FAILED` | 502 | `repo_fetch_failed` | `upstream_unavailable` |
| `SKILL_NAME_EXISTS` | 409 | `skill_name_exists` | `resource_conflict` |
| `SKILL_NOT_FOUND` | 404 | `skill_not_found` | `resource_not_found` |
| `SKILL_VERSION_NOT_FOUND` | 404 | `skill_version_not_found` | `resource_not_found` |
| _(new in #968)_ | 404 | `skill_dependency_not_found` | `resource_not_found` |
| _(new in #968)_ | 409 | `dependency_cycle` | `resource_conflict` |
| _(new in #968)_ | 409 | `dependency_conflict` | `resource_conflict` |
| _(new in #1123)_ | 400 | `invalid_permission_level` | `validation_error` |
| _(new in #1123)_ | 400 | `invalid_transfer_target` | `validation_error` |
| _(new in #1123)_ | 409 | `ownership_conflict` | `resource_conflict` |
| `UPSTREAM_DOWN` | 502 | `upstream_down` | `upstream_unavailable` |

Format rule for future codes: lowercase ASCII, words joined by `_`, no leading/trailing `_`. Pick from the parent §1.4 vocabulary when generic; add a specific subcode only when the caller needs to branch on it.
