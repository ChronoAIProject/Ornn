# Ornn API Reference

Companion to `SKILL.md`. This file enumerates every endpoint in the Ornn HTTP surface (`/api/v1/*`) plus the four out-of-band routes the deployment exposes for health and OpenAPI introspection. Each endpoint lists its full path, request shape (headers, params, body), success response, all known error codes, authentication requirement, and authorization rules. The contents below are derived from `ornn-api/src/domains/**/routes.ts` and `ornn-api/src/bootstrap.ts`. If the code disagrees with this document, the code is the source of truth — re-pull the skill (`SKILL.md` §0) and report the drift.

---

## Table of contents

1. [Conventions](#1-conventions)
   - 1.1 Base URL and versioning
   - 1.2 Response envelope
   - 1.3 Authentication
   - 1.4 Authorization model
   - 1.5 Permission catalogue
   - 1.6 Visibility rules for skills
   - 1.7 HTTP status mapping
   - 1.8 Error code legend
   - 1.9 SSE protocol
   - 1.10 Pagination
   - 1.11 Standard headers
2. [Out-of-band endpoints](#2-out-of-band-endpoints)
3. [Skills CRUD](#3-skills-crud)
4. [Skill audit](#4-skill-audit)
5. [Skill search](#5-skill-search)
6. [Skill format](#6-skill-format)
7. [Skill generation (SSE)](#7-skill-generation-sse)
8. [Playground (SSE)](#8-playground-sse)
9. [Notifications](#9-notifications)
10. [Analytics](#10-analytics)
11. [Me — caller scope](#11-me--caller-scope)
12. [Users directory](#12-users-directory)
13. [Admin](#13-admin)
14. [Platform settings](#14-platform-settings)

---

## 1. Conventions

### 1.1 Base URL and versioning

Every domain endpoint is mounted under `/api/v1/`. There is exactly one mounted version; v0 was retired pre-1.0. Out-of-band endpoints (§2) live at the root.

| Environment | Base URL |
|---|---|
| Production | `https://ornn.chrono-ai.fun/api/v1` |
| Other deployments | `https://<host>/api/v1` (configured via `ORNN_API_URL`) |

Agents reach the API through the NyxID proxy — they do not call the host directly. The proxy adds the auth headers described in §1.3 and forwards the request to `ornn-api`.

### 1.2 Response envelope

Every JSON response uses this exact envelope:

```jsonc
{
  "data":  <T> | null,
  "error": { "code": "STRING_CODE", "message": "Human-readable explanation" } | null
}
```

- `2xx` responses → `data` populated, `error: null`.
- `4xx` / `5xx` responses → `data: null`, `error` populated.
- SSE responses (§7, §8) do **not** use the envelope. Each `data:` line in the stream is a self-contained JSON event.

Always check HTTP status as well as `error`: a TLS/proxy error may return a non-Ornn body that does not follow the envelope.

### 1.3 Authentication

All `/api/v1/*` requests pass through the **NyxID proxy** (which is itself an OAuth-protected gateway). The proxy verifies the caller's bearer token and rewrites the request with a set of forwarded identity headers before handing it to `ornn-api`. The backend never validates JWT signatures directly — it trusts the proxy.

Two propagation modes are supported (driven by NyxID's `forward_identity_mode` setting on the `ornn-api` service):

| Mode | Header(s) read by `ornn-api` | Notes |
|---|---|---|
| **JWT (preferred)** | `X-NyxID-Identity-Token` | Single signed JWT carrying `sub`, `email`, `name`, `roles[]`, `permissions[]`. The backend decodes (no verification — proxy already verified) and populates the auth context. |
| **Headers (legacy)** | `X-NyxID-User-Id`, `X-NyxID-User-Email`, `X-NyxID-User-Name` | Scalar headers only. `roles` and `permissions` arrive empty, so any `requirePermission`-gated route returns 403. |

For agent / SDK callers via `nyxid proxy request ornn-api ...`, the proxy handles all of this — the agent only needs `Authorization: Bearer <user-token>`. The proxy may also forward that bearer token through to `ornn-api` so that ornn can call NyxID on the caller's behalf (used by `/me/orgs`). When forwarding is disabled, org lookups fail-soft to an empty list.

When auth fails (no usable identity headers), every authenticated route responds:

```jsonc
{ "data": null, "error": { "code": "AUTH_MISSING", "message": "Authentication required" } }
```

with HTTP 401.

### 1.4 Authorization model

Two layers stack:

1. **Permission gate** — `requirePermission("ornn:foo:bar")` checks that the proxy-asserted permission set includes the named string. Failures return 403 `FORBIDDEN` with `Missing permission: <name>`.
2. **Resource gate** — for skill-scoped writes and reads of private skills, an additional ownership / visibility check (`canManageSkill`, `canReadSkill`) runs after the permission gate. Failures return 403 `FORBIDDEN` (writes) or 404 `SKILL_NOT_FOUND` (reads — to avoid leaking existence).

Skill writes always require **author OR platform admin**. Org admins do **not** inherit write access on skills shared with their org.

### 1.5 Permission catalogue

Permissions are issued by NyxID as part of the proxy-forwarded identity. Roles map to permissions; the role-to-permission mapping is configured in NyxID, not Ornn.

| Permission | Typical role | Endpoints it unlocks |
|---|---|---|
| `ornn:skill:read` | `ornn-user` | `GET /skills/:idOrName/json`, `POST /skill-format/validate` |
| `ornn:skill:create` | `ornn-user` | `POST /skills`, `POST /skills/pull` |
| `ornn:skill:update` | `ornn-user` | `PUT /skills/:id`, `PUT /skills/:id/permissions`, `POST /skills/:id/refresh`, `PATCH /skills/:idOrName/versions/:version` |
| `ornn:skill:delete` | `ornn-user` | `DELETE /skills/:id`, `DELETE /skills/:idOrName/versions/:version` |
| `ornn:skill:build` | `ornn-user` | `POST /skills/generate`, `POST /skills/generate/from-source`, `POST /skills/generate/from-openapi` |
| `ornn:playground:use` | `ornn-user` | `POST /playground/chat` |
| `ornn:admin:skill` | `ornn-admin` | All `/admin/*` skill-scoped routes; admin force-audit; platform settings |
| `ornn:admin:category` | `ornn-admin` | `GET/POST/PUT/DELETE /admin/categories/*` |

A few endpoints (`POST /skills/:idOrName/audit`, the various caller-scoped reads) gate on **ownership** instead of (or in addition to) a permission — those are documented per-endpoint.

### 1.6 Visibility rules for skills

Reading a skill (and any of its derived data — versions, audit, analytics, diff) follows `canReadSkill`:

```text
PUBLIC skill                        → anyone (auth optional)
PRIVATE skill, anonymous caller     → 404 SKILL_NOT_FOUND
PRIVATE skill, authenticated caller →
  caller is the author              → allowed
  caller has ornn:admin:skill       → allowed
  caller's user_id is in            → allowed
    sharedWithUsers
  caller is admin/member of any org → allowed
    listed in sharedWithOrgs
  otherwise                         → 404 SKILL_NOT_FOUND
```

Note: 404 (not 403) for hidden private skills — existence is intentionally not leaked.

Writing / managing a skill (`canManageSkill`) collapses to: **author OR platform admin**, period. Org membership grants no write access.

### 1.7 HTTP status mapping

| Status | Used for |
|---|---|
| 200 | Successful read or write |
| 201 | Resource created (admin category / tag create) |
| 400 | Validation error, malformed body, bad query param |
| 401 | `AUTH_MISSING` — no usable identity from the proxy |
| 403 | `FORBIDDEN` — authed but missing permission, ownership check failed, or trying to mutate someone else's skill |
| 404 | `*_NOT_FOUND` — resource missing or hidden under visibility rules |
| 409 | Conflict (e.g. duplicate version on publish) |
| 413 | `PAYLOAD_TOO_LARGE` — ZIP exceeds `MAX_PACKAGE_SIZE_BYTES` (default 50 MiB) |
| 500 | `INTERNAL_ERROR` or domain-specific 500 — retry with backoff and include `X-Request-ID` if reporting |
| 503 | `/readyz` only — Mongo unreachable |

### 1.8 Error code legend

The codes below appear across many endpoints. Per-endpoint sections list any additional codes specific to that route.

| Code | Status | Meaning |
|---|---|---|
| `AUTH_MISSING` | 401 | No identity from the proxy. Re-run `nyxid login`. |
| `FORBIDDEN` | 403 | Permission missing, or ownership check failed. The `message` names the missing permission when relevant. |
| `NOT_SKILL_OWNER` | 403 | Variant of FORBIDDEN raised when a non-author / non-admin tries to mutate / refresh / audit a skill. |
| `SKILL_NOT_FOUND` | 404 | Skill does not exist, or exists but is hidden by visibility rules. |
| `AUDIT_NOT_FOUND` | 404 | No audit has been run for the requested skill / version. |
| `ORG_NOT_FOUND` | 404 | Org id does not resolve, or NyxID will not return it to the caller. |
| `SKILL_VERSION_NOT_FOUND` | 404 | Version string does not exist on the skill. |
| `SAME_VERSION` | 400 | `from` and `to` parameters in a diff are identical. |
| `INVALID_CONTENT_TYPE` | 400 | Endpoint expected `application/zip` (or `application/octet-stream`) and got something else. |
| `EMPTY_BODY` | 400 | Request body was zero-length when the endpoint required bytes. |
| `INVALID_QUERY` | 400 | Query string failed Zod validation. `message` lists offending fields. |
| `INVALID_BODY` / `VALIDATION_ERROR` | 400 | Body failed Zod validation. |
| `INVALID_DEPRECATION_PATCH` | 400 | Body for `PATCH /versions/:version` is malformed. |
| `INVALID_PERMISSIONS` | 400 | Body for `PUT /skills/:id/permissions` is malformed. |
| `MISSING_PROMPT` / `MISSING_REPO` / `MISSING_SOURCE` / `MISSING_SPEC` | 400 | Required JSON field absent on the relevant generation / pull endpoint. |
| `AMBIGUOUS_SOURCE` | 400 | `/skills/generate/from-source` got both `code` and `repoUrl`. |
| `EMPTY_SOURCE` | 400 | `/skills/generate/from-source` got an empty `code` after fetching. |
| `REPO_FETCH_FAILED` | 400 | `/skills/generate/from-source` could not fetch the requested GitHub repo. |
| `PULL_FAILED` | 400 | `POST /skills/pull` could not pull or zip the requested repo. |
| `REFRESH_FAILED` | 400 | `POST /skills/:id/refresh` could not re-pull the source. |
| `NO_UPDATE` | 400 | `PUT /skills/:id` body had no actionable fields (no zip, no `isPrivate`). |
| `INVALID_WINDOW` / `INVALID_BUCKET` / `INVALID_RANGE` | 400 | Analytics query params out of range or unparseable. |
| `INVALID_SETTING` | 400 | `PATCH /admin/settings` body has out-of-range values or no recognised fields. |
| `INVALID_NYXID_SERVICE_PATCH` | 400 | `PUT /skills/:id/nyxid-service` body failed Zod validation. |
| `NYXID_SERVICE_NOT_FOUND` | 404 | NyxID catalog service is missing or not visible to caller. Existence is intentionally not leaked. |
| `NYXID_SERVICE_NOT_ELIGIBLE` | 403 | Caller is not allowed to tie a skill to that service (would tie to another user's personal service). |
| `SYSTEM_SKILL_MUST_BE_PUBLIC` | 400 | Skill tied to an admin service cannot be made private. Untie first. |
| `QUERY_REQUIRED` / `AUTH_REQUIRED` | 400 | `/skill-search` invariant violated (semantic mode needs both query and auth). |
| `PAYLOAD_TOO_LARGE` | 413 | Upload exceeds `MAX_PACKAGE_SIZE_BYTES`. |
| `PACKAGE_DOWNLOAD_FAILED` | 500 | The backend could not retrieve the skill ZIP from object storage. |
| `NYXID_ORG_LOOKUP_FAILED` | 500 | NyxID returned a non-OK response when the backend tried to resolve an org on the caller's behalf. |
| `INTERNAL_ERROR` | 500 | Catch-all for unhandled errors; the `X-Request-ID` header lets you correlate with server logs. |

### 1.9 SSE protocol

Endpoints under `/skills/generate*` and `/playground/chat` stream Server-Sent Events instead of returning the JSON envelope.

- `Content-Type: text/event-stream`. The handlers also set `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no` so that nginx / proxies do not buffer.
- Each event is `data: <JSON>\n\n` (the `data:` payload is a JSON object with a `type` discriminator).
- A heartbeat of `event: keepalive` with empty `data:` is emitted every `SSE_KEEPALIVE_INTERVAL_MS` (default 15 000 ms). Ignore them.
- A normal end-of-stream is signalled by a terminal event (`generation_complete` for generation; `finish` for chat) followed by the proxy closing the connection.
- Aborts: cancelling the underlying HTTP request causes the backend to detect `c.req.raw.signal.aborted`, clear the keepalive timer, and stop the LLM call. Truncated streams have no special closing event.

Per-endpoint event shapes are listed in the relevant sections below.

### 1.10 Pagination

Endpoints that paginate use offset pagination via `page` (1-based) and `pageSize`. Responses carry:

```jsonc
{ "items": [...], "total": <int>, "page": <int>, "pageSize": <int>, "totalPages": <int> }
```

`pageSize` is clamped per-endpoint (search: 1–100 default 9; admin lists: 1–100 default 20; users directory: 1–50 default 10; notifications limit: 1–200 default 50).

### 1.11 Standard headers

| Header | Direction | Purpose |
|---|---|---|
| `Authorization: Bearer <token>` | Inbound | The caller's NyxID access token. Read by the proxy; sometimes forwarded to `ornn-api`. |
| `X-NyxID-Identity-Token` | Inbound (from proxy) | Verified identity JWT; primary input to `proxyAuthSetup`. |
| `X-NyxID-User-Id` / `X-NyxID-User-Email` / `X-NyxID-User-Name` | Inbound (from proxy, headers mode) | Scalar identity fallback when the JWT is absent. |
| `Content-Type: application/zip` (or `application/octet-stream`) | Inbound | Required for binary skill uploads. |
| `Content-Type: application/json` | Inbound | All other writes. |
| `X-Request-ID` | Outbound | Always set; echoes the inbound `X-Request-ID` if present, otherwise generated. Use it when reporting failures. |
| `X-Skill-Deprecated: true` | Outbound (on `GET /skills/:idOrName`) | Set when the resolved version is marked deprecated. |
| `X-Skill-Deprecation-Note: <urlencoded>` | Outbound (on `GET /skills/:idOrName`) | Optional human-readable note when the version is deprecated. |
| `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` | Outbound (SSE) | Keep proxies from buffering the stream. |

CORS: only the origins listed in `ALLOWED_ORIGINS` are allowed. Cross-origin agents must use the NyxID proxy from a permitted origin or an SDK that signs / forwards through one.

---

## 2. Out-of-band endpoints

These four routes are *not* under `/api/v1/`; they exist for liveness, readiness, and OpenAPI introspection.

### 2.1 `GET /health` / `GET /livez`

**Process liveness probe.** No dependencies are checked.

**Auth: none.**

Response 200:

```jsonc
{
  "status": "ok",
  "service": "ornn-api",
  "version": "1.4.2",
  "timestamp": "2026-04-28T12:34:56.789Z"
}
```

`/health` is an alias retained for backward-compatibility; new K8s manifests should use `/livez`. Errors: none — the route returns 200 unconditionally as long as the process is alive enough to answer.

### 2.2 `GET /readyz`

**Kubernetes readiness probe.** Pings MongoDB with a 2-second timeout.

**Auth: none.**

Response 200 (Mongo reachable):

```jsonc
{ "status": "ready", "service": "ornn-api", "mongoLatencyMs": 12 }
```

Response 503 (Mongo unreachable):

```jsonc
{ "status": "not_ready", "reason": "mongo_unreachable" }
```

When 503, the pod is drained from the K8s service.

### 2.3 `GET /api/v1/openapi.json`

**Returns the auto-generated OpenAPI 3.0 schema** built from the Zod definitions in the route files. Useful for SDK generation and as a typed client target.

**Auth: none.**

Response 200: a complete OpenAPI 3.0 document. Schemas, parameters, request bodies, and responses are all derived from the same Zod schemas the runtime uses for validation, so it never drifts.

---

## 3. Skills CRUD

All endpoints in this section live under `/api/v1/`. The mounting in `bootstrap.ts` runs `proxyAuthSetup` and `nyxidOrgLookupMiddleware` before any handler, so every route has access to the caller's identity and a memoised org-membership getter.

### 3.1 Create skill — `POST /api/v1/skills`

Upload a new skill from a ZIP package.

**Auth: required.** **Permission: `ornn:skill:create`.**

| Where | Field | Type | Notes |
|---|---|---|---|
| Header | `Content-Type` | `application/zip` or `application/octet-stream` | Anything else → 400 `INVALID_CONTENT_TYPE` |
| Query | `skip_validation` | `"true"` | Optional. Skips format validation. Use sparingly. |
| Body | (binary) | ZIP bytes | Must contain a single root folder whose name matches `SKILL.md`'s `name`. |

Response 200:

```jsonc
{
  "data": {
    "guid": "skl_01HXY...",
    "name": "my-skill",
    "description": "...",
    "metadata": { "category": "plain", "tag": ["..."] },
    "tags": ["..."],
    "skillHash": "sha256:...",
    "presignedPackageUrl": "https://storage.../my-skill.zip?X-Amz-Signature=...",
    "isPrivate": true,
    "ownerId": "user_...",
    "createdBy": "user_...",
    "createdByEmail": "...",
    "createdByDisplayName": "...",
    "createdOn": "2026-04-28T12:00:00Z",
    "updatedOn": "2026-04-28T12:00:00Z",
    "sharedWithUsers": [],
    "sharedWithOrgs": [],
    "version": "1.0",
    "isDeprecated": false,
    "deprecationNote": null
  },
  "error": null
}
```

New skills are always created **private** with empty allow-lists. Use `PUT /skills/:id/permissions` to share.

| Code | Status | Cause |
|---|---|---|
| `INVALID_CONTENT_TYPE` | 400 | Wrong Content-Type. |
| `EMPTY_BODY` | 400 | Zero-byte body. |
| `PAYLOAD_TOO_LARGE` | 413 | Exceeds `MAX_PACKAGE_SIZE_BYTES`. |
| `VALIDATION_FAILED` / `FRONTMATTER_VALIDATION_FAILED` | 400 | Skill format check failed. Run `POST /skill-format/validate` for details. |
| `AUTH_MISSING` | 401 | Not authenticated. |
| `FORBIDDEN` | 403 | Missing `ornn:skill:create`. |

### 3.2 Import from GitHub — `POST /api/v1/skills/pull`

Create a new skill by cloning a public GitHub repo. The skill is recorded with a `source` block so it can be refreshed later (§3.3).

**Auth: required.** **Permission: `ornn:skill:create`.**

Request body (`application/json`):

```jsonc
{
  "repo": "owner/name",          // required
  "ref": "main",                 // optional — branch, tag, or commit SHA. Default: repo default branch.
  "path": "skills/my-skill",     // optional — sub-directory inside repo. Default: repo root.
  "skip_validation": false       // optional
}
```

Response 200: same shape as `POST /skills` — the freshly created `SkillDetail`. The skill's `source.lastSyncedCommit` records the commit SHA pulled at creation time.

| Code | Status | Cause |
|---|---|---|
| `MISSING_REPO` | 400 | `repo` field missing or non-string. |
| `PULL_FAILED` | 400 | The repo couldn't be cloned, the path was empty, or the package failed to materialise. `message` carries the underlying cause. |
| `VALIDATION_FAILED` | 400 | Pulled package failed format validation. |
| `AUTH_MISSING` | 401 / `FORBIDDEN` | 403 — same as §3.1. |

### 3.3 Refresh from source — `POST /api/v1/skills/:id/refresh`

Re-pull the skill's recorded GitHub source and publish a new version if the bytes changed.

**Auth: required.** **Permission: `ornn:skill:update`.** **Owner OR platform admin** (`ornn:admin:skill`).

Path param: `:id` — skill GUID (not name).

Body: ignored.

Response 200: the refreshed `SkillDetail`. `source.lastSyncedCommit` and `source.lastSyncedAt` advance.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No skill with that GUID. |
| `NOT_SKILL_OWNER` | 403 | Caller is not the author and lacks `ornn:admin:skill`. |
| `REFRESH_FAILED` | 400 | Source repo could not be re-fetched, or the resulting package failed validation. |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 | Standard. |

### 3.4 Get skill — `GET /api/v1/skills/:idOrName`

Fetch a single skill by GUID or by `name`.

**Auth: optional.** Anonymous callers see only public skills (private skills return 404 `SKILL_NOT_FOUND`).

Path param: `:idOrName` — skill GUID or kebab-case name.

| Query param | Type | Notes |
|---|---|---|
| `version` | `<major>.<minor>` | Optional. Returns the metadata + `presignedPackageUrl` for a specific version. Without it, returns the latest. |

Response 200: `SkillDetail` (same shape as §3.1's response). When the resolved version is deprecated, additional response headers:

- `X-Skill-Deprecated: true`
- `X-Skill-Deprecation-Note: <URL-encoded note>` (when set)

The endpoint records a `web` pull event for authenticated callers (no event for anonymous reads).

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No skill, hidden by visibility, or version not present. |

### 3.5 Get skill JSON — `GET /api/v1/skills/:idOrName/json`

Return the full skill package as inline JSON: every file path in the package mapped to its UTF-8 content. This is the canonical agent-side pull — it avoids the second hop to object storage.

**Auth: required.** **Permission: `ornn:skill:read`.**

Path param: `:idOrName`.

Response 200:

```jsonc
{
  "data": {
    "name": "my-skill",
    "description": "...",
    "metadata": { "category": "plain", "tag": ["..."] },
    "files": {
      "SKILL.md": "---\nname: my-skill\n...",
      "scripts/run.py": "import sys\n...",
      "references/usage.md": "..."
    }
  },
  "error": null
}
```

The endpoint records an `api` pull event when called by an authenticated caller.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `PACKAGE_DOWNLOAD_FAILED` | 500 | Backend could not fetch the package from object storage. Retry with backoff. |
| `AUTH_MISSING` | 401 | Not authenticated. |
| `FORBIDDEN` | 403 | Missing `ornn:skill:read`. |

### 3.6 List versions — `GET /api/v1/skills/:idOrName/versions`

List every published version of the skill, newest first.

**Auth: optional.** Visibility rules mirror §3.4 — anonymous callers get 404 on private skills.

Path param: `:idOrName`.

Response 200:

```jsonc
{
  "data": {
    "items": [
      {
        "version": "1.3",
        "skillHash": "sha256:...",
        "createdBy": "user_...",
        "createdByEmail": "...",
        "createdByDisplayName": "...",
        "createdOn": "2026-04-28T12:00:00Z",
        "isDeprecated": false,
        "deprecationNote": null,
        "releaseNotes": "Switched parser to csv-parse"
      },
      { /* v1.2 ... */ }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Same as §3.4. |

### 3.7 Diff versions — `GET /api/v1/skills/:idOrName/versions/:fromVersion/diff/:toVersion`

Structured file-level diff between two versions of the same skill.

**Auth: optional.** Visibility same as §3.4.

Path params:

- `:idOrName` — skill GUID or name.
- `:fromVersion` / `:toVersion` — version strings (`<major>.<minor>`).

Response 200:

```jsonc
{
  "data": {
    "skill": { "guid": "skl_...", "name": "my-skill" },
    "from": {
      "version": "1.2",
      "hash": "sha256:...",
      "createdOn": "2026-04-20T...",
      "isDeprecated": true,
      "releaseNotes": null
    },
    "to": {
      "version": "1.3",
      "hash": "sha256:...",
      "createdOn": "2026-04-27T...",
      "isDeprecated": false,
      "releaseNotes": "Switched parser to csv-parse"
    },
    "diff": {
      "added":   [{ "path": "references/why-csv-parse.md", "content": "..." }],
      "removed": [{ "path": "scripts/papaparse-helper.js", "content": "..." }],
      "modified": [
        { "path": "scripts/run.py", "before": "...", "after": "..." }
      ]
    }
  },
  "error": null
}
```

Content of modified files is included on both sides so a unified diff can be rendered client-side.

| Code | Status | Cause |
|---|---|---|
| `SAME_VERSION` | 400 | `from` and `to` are equal. |
| `SKILL_NOT_FOUND` | 404 | Skill missing or hidden. |
| `SKILL_VERSION_NOT_FOUND` | 404 | Either version is not present on the skill. |

### 3.8 Toggle version deprecation — `PATCH /api/v1/skills/:idOrName/versions/:version`

Mark a single version as deprecated or undo it. Deprecation is a warning, not a removal — the version remains resolvable.

**Auth: required.** **Permission: `ornn:skill:update`.** **Author OR platform admin.**

Path params: `:idOrName`, `:version` (`<major>.<minor>`).

Request body (`application/json`):

```jsonc
{ "isDeprecated": true, "deprecationNote": "Breaks with axios >= 1.7" }
```

`deprecationNote` is optional (max 1024 chars). Schema: Zod `z.object({ isDeprecated: z.boolean(), deprecationNote: z.string().max(1024).optional() })`.

Response 200:

```jsonc
{
  "data": {
    "skillGuid": "skl_...",
    "skillName": "my-skill",
    "version": "1.2",
    "isDeprecated": true,
    "deprecationNote": "Breaks with axios >= 1.7"
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_DEPRECATION_PATCH` | 400 | Body failed Zod validation. |
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `SKILL_VERSION_NOT_FOUND` | 404 | Version not present. |
| `FORBIDDEN` | 403 | Caller is not the author / not platform admin. |
| `AUTH_MISSING` | 401 / `FORBIDDEN` 403 | Standard. |

### 3.9 Update skill — `PUT /api/v1/skills/:id`

Publish a new version (ZIP body) and / or flip the `isPrivate` flag (JSON body or multipart form).

**Auth: required.** **Permission: `ornn:skill:update`.** **Author OR platform admin.**

Path param: `:id` — GUID only (not name).

| Where | Field | Notes |
|---|---|---|
| Query | `skip_validation` | Optional `"true"`. |
| Header | `Content-Type` | One of `application/zip`, `application/octet-stream`, `multipart/form-data`, `application/json`. |
| Body (zip) | (binary) | New version ZIP. |
| Body (multipart) | `package` (file) | New version ZIP. Optional. |
| Body (multipart) | `isPrivate` | `"true"` or `"false"`. Optional. |
| Body (JSON) | `{ "isPrivate": <bool> }` | Visibility-only update. |

Response 200: refreshed `SkillDetail`. When the body contained a ZIP, a new `latestVersion` is published and the `version_*` records are advanced.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `FORBIDDEN` | 403 | Caller is not the author / not platform admin. |
| `NO_UPDATE` | 400 | Neither a ZIP nor `isPrivate` was provided. |
| `PAYLOAD_TOO_LARGE` | 413 | Exceeds `MAX_PACKAGE_SIZE_BYTES`. |
| `VALIDATION_FAILED` / `FRONTMATTER_VALIDATION_FAILED` | 400 | New package failed validation. |
| `AUTH_MISSING` | 401 | Standard. |

### 3.10 Replace permissions — `PUT /api/v1/skills/:id/permissions`

Apply a new ACL state in one shot. **This is the only "share" endpoint.** There is no audit gate, no waiver, no review queue — the backend stores the desired state as-is. (Earlier designs proxied through `share_requests` with a waiver flow; that was removed in PR #198.)

**Auth: required.** **Permission: `ornn:skill:update`.** **Author OR platform admin.**

Path param: `:id` — skill GUID.

Request body (`application/json`):

```jsonc
{
  "isPrivate": true,
  "sharedWithUsers": ["user_abc", "user_def"],
  "sharedWithOrgs": ["org_xyz"]
}
```

Schema: Zod
```ts
z.object({
  isPrivate: z.boolean(),
  sharedWithUsers: z.array(z.string().min(1).max(128)).max(500).default([]),
  sharedWithOrgs:  z.array(z.string().min(1).max(128)).max(100).default([]),
})
```

`isPrivate: false` makes the skill fully public; the allow-lists are still persisted (so toggling back to private doesn't lose your collaborator list) but visibility ignores them while the skill is public.

Response 200:

```jsonc
{ "data": { "skill": <SkillDetail> }, "error": null }
```

The response shape is `{ skill }` — not `{ skill, waivers }`. There is no `waivers` array; the field has been removed from the contract.

| Code | Status | Cause |
|---|---|---|
| `INVALID_PERMISSIONS` | 400 | Body failed Zod validation (e.g. `sharedWithUsers.length > 500`). |
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `FORBIDDEN` | 403 | Caller is not the author / not platform admin. |
| `AUTH_MISSING` | 401 | Standard. |

### 3.11 Delete skill — `DELETE /api/v1/skills/:id`

Hard-delete the skill, all its versions, and all its storage objects.

**Auth: required.** **Permission: `ornn:skill:delete`.** **Author OR platform admin.**

Path param: `:id` — GUID only.

Response 200:

```jsonc
{ "data": { "success": true }, "error": null }
```

There is no soft-delete; subsequent reads return `SKILL_NOT_FOUND`. Audit records, analytics events, and notifications already emitted are *not* purged — they remain queryable as historical orphans.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `FORBIDDEN` | 403 | Caller is not the author / not platform admin. |
| `AUTH_MISSING` | 401 | Standard. |

### 3.12 Tie / untie NyxID service — `PUT /api/v1/skills/:id/nyxid-service`

Set or clear the skill's tie to a NyxID catalog service.

**Auth: required.** **Permission: `ornn:skill:update`.** **Author OR platform admin.**

Path param: `:id` — skill GUID.

Request body (`application/json`):

```jsonc
{ "nyxidServiceId": "svc_abc..." }   // tie
{ "nyxidServiceId": null }           // untie
```

Eligibility:

| Caller | Service tier | Allowed? |
|---|---|---|
| Anyone (author/admin of the skill) | **admin** (`visibility: "public"`) | yes |
| Anyone (author/admin of the skill) | **personal** AND `created_by === caller` | yes |
| Anyone | **personal** AND `created_by !== caller` | **no** — `NYXID_SERVICE_NOT_ELIGIBLE` |

Side effect: tying to an admin service forces `isPrivate: false` atomically (system skills are always public). Tying to a personal service does **not** change privacy. Untying does not change privacy.

Response 200:

```jsonc
{
  "data": {
    "skill": {
      "guid": "skl_...",
      "name": "...",
      "isPrivate": false,
      "nyxidServiceId": "svc_abc...",
      "nyxidServiceSlug": "ornn-api",
      "nyxidServiceLabel": "Ornn API",
      "isSystemSkill": true,
      // ...rest of SkillDetail
    }
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_NYXID_SERVICE_PATCH` | 400 | Body failed Zod validation. |
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `NYXID_SERVICE_NOT_FOUND` | 404 | Service id is missing or not visible to caller. |
| `NYXID_SERVICE_NOT_ELIGIBLE` | 403 | Tying to another user's personal service. |
| `FORBIDDEN` | 403 | Caller is not author / not platform admin. |

### 3.13 List skills tied to a service — `GET /api/v1/nyxid-services/:serviceId/skills`

Reverse lookup: every skill tied to a given catalog service.

**Auth: required.**

Authorization:

| Service tier | Who can browse |
|---|---|
| **admin** (`visibility: "public"`) | any authenticated caller |
| **personal** (`visibility: "private"`) | the service `created_by`, or platform admin (`ornn:admin:skill`) |

Service ids the caller cannot see (private + not owner / admin) collapse to 404 to avoid leaking existence.

| Query param | Notes |
|---|---|
| `page` | int ≥ 1, default 1 |
| `pageSize` | int 1–100, default 20 |

Response 200:

```jsonc
{
  "data": {
    "service": {
      "id": "svc_abc...",
      "slug": "ornn-api",
      "label": "Ornn API",
      "tier": "admin"
    },
    "items": [
      {
        "guid": "skl_...",
        "name": "...",
        "description": "...",
        "ownerId": "user_...",
        "createdBy": "user_...",
        "createdByEmail": "...",
        "createdByDisplayName": "...",
        "createdOn": "...",
        "updatedOn": "...",
        "isPrivate": false,
        "tags": ["..."],
        "nyxidServiceId": "svc_abc...",
        "nyxidServiceSlug": "ornn-api",
        "nyxidServiceLabel": "Ornn API",
        "isSystemSkill": true
      }
    ],
    "total": 12,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `NYXID_SERVICE_NOT_FOUND` | 404 | Service missing, hidden, or caller is a non-owner / non-admin of a personal service. |

### 3.14 Delete a single version — `DELETE /api/v1/skills/:idOrName/versions/:version`

Remove one non-latest, non-only version of a skill. The skill itself + every other version remain.

**Auth: required.** **Permission: `ornn:skill:delete`.** **Author OR platform admin.**

Path params: `:idOrName`, `:version`.

Response 200: `{ "data": { "success": true }, "error": null }`.

Refused for two cases:
- The version is the **only** version of the skill — use `DELETE /skills/:id` to remove the skill entirely.
- The version is the **current latest** — publish a newer version first (or de-publish via a different mechanism), then delete the older one.

Both refusals surface as a 400 with a descriptive code (`CANNOT_DELETE_LATEST`, `CANNOT_DELETE_ONLY_VERSION`, or similar — defined inside `skillService.deleteVersion` / `skillVersionRepo`).

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No such skill. |
| `SKILL_VERSION_NOT_FOUND` | 404 | Version not present. |
| `CANNOT_DELETE_LATEST` | 400 | Caller targeted the current `latestVersion`. |
| `CANNOT_DELETE_ONLY_VERSION` | 400 | Skill has only one version. |
| `FORBIDDEN` | 403 | Caller is not the author / not platform admin. |
| `AUTH_MISSING` | 401 | Standard. |

---

## 4. Skill audit

Five endpoints. Audit is a **passive risk label** — running an audit produces a verdict that decorates the skill (and fans out a notification on yellow / red), but never blocks any operation. Sharing is decoupled from audit (§3.10).

Audit verdicts: `green`, `yellow`, `red`. Lifecycle: `running` → `completed` (or `failed`). Cache: a `completed` row younger than 30 days for the same `(skillGuid, version, skillHash)` is reused unless `force: true` is passed.

### 4.1 Get latest audit — `GET /api/v1/skills/:idOrName/audit`

Return the most recent audit record for the latest (or specified) version. Does **not** trigger a new audit.

**Auth: optional.** Visibility mirrors §3.4.

Path param: `:idOrName`. Query: `version` (optional `<major>.<minor>`).

Response 200:

```jsonc
{
  "data": {
    "_id": "aud_...",
    "skillGuid": "skl_...",
    "version": "1.3",
    "skillHash": "sha256:...",
    "status": "completed",
    "verdict": "yellow",
    "overallScore": 6.4,
    "scores": [
      { "dimension": "security", "score": 5, "rationale": "Reads env vars without scoping" },
      { "dimension": "code_quality", "score": 7, "rationale": "..." },
      { "dimension": "documentation", "score": 7, "rationale": "..." },
      { "dimension": "reliability", "score": 6, "rationale": "..." },
      { "dimension": "permission_scope", "score": 7, "rationale": "..." }
    ],
    "findings": [
      { "dimension": "security", "severity": "warning", "file": "scripts/run.py", "line": 12, "message": "..." }
    ],
    "model": "claude-3.5-sonnet",
    "createdAt": "2026-04-28T12:00:00Z",
    "completedAt": "2026-04-28T12:01:30Z",
    "triggeredBy": "user_..."
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden / version not present. |
| `AUDIT_NOT_FOUND` | 404 | Skill exists but has never been audited at the resolved version. |

### 4.2 Per-version audit summary — `GET /api/v1/skills/:idOrName/audit/summary-by-version`

For each version of the skill, return the most recent **completed** audit. Versions with no completed audit are omitted (callers treat the missing key as "not audited yet"). Drives the per-version verdict badges in the UI.

**Auth: optional.** Visibility mirrors §3.4.

Response 200:

```jsonc
{
  "data": {
    "byVersion": {
      "1.3": { "verdict": "yellow", "overallScore": 6.4, "completedAt": "2026-04-28T..." },
      "1.2": { "verdict": "green",  "overallScore": 8.1, "completedAt": "2026-04-21T..." }
    }
  },
  "error": null
}
```

(`running` rows do not surface here; they only appear in `/audit/history`.)

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden. |

### 4.3 Audit history — `GET /api/v1/skills/:idOrName/audit/history`

List every audit row stored for the skill (newest first), including `running` and `failed` rows. Use this for polling after a trigger.

**Auth: optional.** Visibility mirrors §3.4.

Path param: `:idOrName`. Query: `version` (optional — narrows to one version).

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "_id": "aud_...", "version": "1.3", "status": "running",   "createdAt": "..." },
      { "_id": "aud_...", "version": "1.3", "status": "completed", "verdict": "yellow", "overallScore": 6.4, "completedAt": "..." },
      { "_id": "aud_...", "version": "1.2", "status": "failed",    "errorMessage": "LLM timeout", "createdAt": "..." }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden. |

### 4.4 Trigger audit — `POST /api/v1/skills/:idOrName/audit`

Owner-side "Start Auditing". Inserts a `running` row immediately and kicks off the LLM pipeline in the background. Returns the `running` row.

**Auth: required.** Caller must be **the skill's author OR a platform admin** (`ornn:admin:skill`). No scalar permission gate — this is an ownership check.

Path param: `:idOrName`.

Request body (optional, `application/json`):

```jsonc
{ "force": false }
```

`force: true` bypasses the 30-day cache (always inserts a new row + runs the pipeline). `force: false` (default) reuses a recent `completed` row when one exists for the same `skillHash`.

Response 200:

```jsonc
{ "data": <AuditRecord at status: "running" or reused completed row>, "error": null }
```

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden. |
| `NOT_SKILL_OWNER` | 403 | Caller is neither the author nor a platform admin. |
| `AUTH_MISSING` | 401 | Standard. |

### 4.5 Admin force-trigger — `POST /api/v1/admin/skills/:idOrName/audit`

Same as §4.4 but bypasses the ownership check entirely. For platform admins running an audit on a skill they did not author.

**Auth: required.** **Permission: `ornn:admin:skill`.**

Body / response: identical to §4.4.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing. |
| `FORBIDDEN` | 403 | Missing `ornn:admin:skill`. |
| `AUTH_MISSING` | 401 | Standard. |

---

## 5. Skill search

Two endpoints — registry-wide search and the registry-tab counts.

### 5.1 Search — `GET /api/v1/skill-search`

Keyword or semantic search across the skills the caller can see.

**Auth: optional.** Anonymous callers are forced to `scope = public` and cannot use semantic mode (returns 400).

| Query param | Type | Default | Notes |
|---|---|---|---|
| `query` | string ≤ 2000 | `""` | Empty = match all (within scope). |
| `mode` | `keyword` \| `semantic` | `keyword` | Semantic uses LLM ranking; requires auth and a non-empty query. |
| `scope` | `public` \| `private` \| `mixed` \| `shared-with-me` \| `mine` | `private` | Auth scopes. Anonymous callers are coerced to `public`. |
| `page` | int ≥ 1 | 1 | 1-based. |
| `pageSize` | int 1–100 | 9 | |
| `model` | string | platform default | LLM id override (semantic only). |
| `systemFilter` | `any` \| `only` \| `exclude` | `any` | "System skills" are skills tied to an admin/platform NyxID service (`isSystemSkill: true`, set by `PUT /skills/:id/nyxid-service`). `only` keeps just system skills; `exclude` removes them. |
| `sharedWithOrgs` | comma-separated org user_ids | — | Narrow by grant target. |
| `sharedWithUsers` | comma-separated user_ids | — | Narrow by grant target. |
| `createdByAny` | comma-separated user_ids | — | Narrow by author. |

Response 200:

```jsonc
{
  "data": {
    "searchMode": "keyword",
    "searchScope": "public",
    "total": 42,
    "totalPages": 5,
    "page": 1,
    "pageSize": 9,
    "items": [
      {
        "guid": "skl_...",
        "name": "my-skill",
        "description": "...",
        "ownerId": "user_...",
        "createdBy": "user_...",
        "createdByEmail": "...",
        "createdByDisplayName": "...",
        "createdOn": "...",
        "updatedOn": "...",
        "isPrivate": false,
        "tags": ["..."],
        "myAccessReason": "public",
        "isSystemForMe": true,
        "systemForService": { "id": "...", "slug": "...", "label": "..." },
        "permissionSummary": { "isPrivate": false, "sharedUserCount": 0, "sharedOrgCount": 0 }
      }
    ]
  },
  "error": null
}
```

`myAccessReason` is one of `owner`, `public`, `shared-direct`, `shared-via-org` and only present for authenticated callers. `sharedViaOrgId` accompanies `shared-via-org`.

| Code | Status | Cause |
|---|---|---|
| `INVALID_QUERY` | 400 | Query string failed Zod validation. |
| `QUERY_REQUIRED` | 400 | `mode=semantic` with empty `query`. |
| `AUTH_REQUIRED` | 400 | `mode=semantic` from an anonymous caller. |

### 5.2 Tag facets — `GET /api/v1/skill-facets/tags`

Distinct skill tags within a given scope, with per-tag counts. Drives sidebar tag filters.

**Auth: optional** for `public` / `system` / `mixed`; **required** for `mine` / `shared-with-me`.

| Query param | Values |
|---|---|
| `scope` | `public` \| `mine` \| `shared-with-me` \| `system` \| `mixed` (default `public`) |

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "name": "translation", "count": 12 },
      { "name": "csv",         "count": 8 }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_SCOPE` | 400 | Scope value not in the enum. |
| `AUTH_REQUIRED` | 401 | `mine` / `shared-with-me` requested anonymously. |

### 5.3 Author facets — `GET /api/v1/skill-facets/authors`

Distinct skill authors within scope, with per-author counts. Drives the Public-tab author filter.

**Auth: optional** for `public` / `system` / `mixed`; **required** for `shared-with-me`.

| Query param | Values |
|---|---|
| `scope` | `public` \| `shared-with-me` \| `system` \| `mixed` (default `public`) |

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "userId": "user_...", "email": "alice@…", "displayName": "Alice", "count": 5 }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_SCOPE` | 400 | Scope unsupported (e.g. `mine` — every skill there has the same author). |
| `AUTH_REQUIRED` | 401 | `shared-with-me` requested anonymously. |

### 5.4 System-service facets — `GET /api/v1/skill-facets/system-services`

NyxID services that have at least one tied system skill, with per-service skill counts. Powers the System-tab service filter.

**Auth: optional.**

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "id": "svc_...", "slug": "ornn-api", "label": "Ornn API", "count": 1 }
    ]
  },
  "error": null
}
```

### 5.5 Registry counts — `GET /api/v1/skill-counts`

Single round-trip for the three registry-tab badges.

**Auth: optional.** Anonymous callers always see `mine: 0`, `sharedWithMe: 0`.

Response 200:

```jsonc
{
  "data": {
    "public": 124,
    "mine": 7,
    "sharedWithMe": 12
  },
  "error": null
}
```

The path is intentionally outside `/skills/` so it does not collide with `GET /skills/:id`. No errors specific to this endpoint.

---

## 6. Skill format

Two endpoints — the canonical format spec, and a pre-flight validator.

### 6.1 Format rules — `GET /api/v1/skill-format/rules`

Return the canonical skill package format spec as Markdown.

**Auth: none.**

Response 200:

```jsonc
{ "data": { "rules": "# Ornn Skill Package Format Rules\n\n..." }, "error": null }
```

Use this as the source-of-truth — it is exactly what the validator (§6.2) and the upload path enforce.

### 6.2 Validate ZIP — `POST /api/v1/skill-format/validate`

Validate a ZIP against the format rules without uploading.

**Auth: required.** **Permission: `ornn:skill:read`.**

Headers: `Content-Type: application/zip` (or `application/octet-stream`).

Body: ZIP bytes.

Response 200 — valid:

```jsonc
{ "data": { "valid": true }, "error": null }
```

Response 200 — invalid (note: HTTP is still 200; the envelope's `data.valid: false` is the signal):

```jsonc
{
  "data": {
    "valid": false,
    "violations": [
      { "rule": "VALIDATION_FAILED", "message": "SKILL.md missing 'metadata.category' field" }
    ]
  },
  "error": null
}
```

Validation is idempotent and side-effect-free; safe to call repeatedly in CI.

| Code | Status | Cause |
|---|---|---|
| `INVALID_CONTENT_TYPE` | 400 | Wrong Content-Type. |
| `EMPTY_BODY` | 400 | Zero-byte body. |
| `AUTH_MISSING` | 401 / `FORBIDDEN` 403 | Standard. |

---

## 7. Skill generation (SSE)

Three endpoints, all SSE. All require `ornn:skill:build`. All emit the same event family (§7.0).

### 7.0 Generation event shapes

```jsonc
// generation_start
{ "type": "generation_start" }

// token (incremental content)
{ "type": "token", "content": "partial output text" }

// generation_complete (terminal — full result)
{ "type": "generation_complete", "raw": "<final generated SKILL.md + scripts as JSON>" }

// validation_error (auto-retry; pipeline keeps streaming)
{ "type": "validation_error", "message": "...", "retrying": true }

// error (terminal — fatal)
{ "type": "error", "message": "..." }

// keepalive (heartbeat — ignore)
{ "type": "keepalive" }
```

A normal stream ends with `generation_complete` followed by the proxy closing the connection. A fatal stream ends with `error`. The `raw` field is a serialised representation of the generated skill; clients should parse it back into the package structure (frontmatter + files).

### 7.1 Generate from prompt — `POST /api/v1/skills/generate`

Generate a fresh skill from a natural-language prompt. Two body modes: single-shot and multi-turn.

**Auth: required.** **Permission: `ornn:skill:build`.**

#### 7.1.a Single-shot (JSON or multipart)

```jsonc
// JSON
{ "prompt": "Build a skill that converts CSV to JSON using csv-parse" }
```

```text
# multipart/form-data
prompt=Build a skill that converts CSV to JSON ...
package=@existing-skill.zip      # optional — iterate on an existing package
```

When `package` is included, its file contents are extracted (SKILL.md + scripts/ + references/ + assets/) and included in the prompt as "existing skill content".

#### 7.1.b Multi-turn (JSON only)

```jsonc
{
  "messages": [
    { "role": "user",      "content": "Build a CSV-to-JSON skill" },
    { "role": "assistant", "content": "<previous generation output>" },
    { "role": "user",      "content": "Switch to csv-parse from papaparse" }
  ]
}
```

Same SSE event types, but the model has the prior turns as conversational context.

Response: SSE stream as in §7.0. No JSON envelope.

| Code (in stream) | Cause |
|---|---|
| `MISSING_PROMPT` | Neither `prompt` nor `messages` present. |
| `INVALID_CONTENT_TYPE` | Wrong Content-Type — must be `application/json` or `multipart/form-data`. |
| `AUTH_MISSING` | 401 returned **before** the stream starts. |
| `FORBIDDEN` | 403 returned before the stream starts (missing `ornn:skill:build`). |

### 7.2 Generate from source — `POST /api/v1/skills/generate/from-source`

Generate a skill by analysing existing source code — either an inline snippet or a public GitHub repo.

**Auth: required.** **Permission: `ornn:skill:build`.**

Body (`application/json`):

```jsonc
{
  "code":       "<inline source>",                 // EITHER this …
  "repoUrl":    "https://github.com/owner/repo",   // … OR this. Exactly one is required.
  "path":       "src/utils/summarizer.ts",         // optional — narrow inside repo
  "framework":  "express",                         // optional hint; auto-detected otherwise
  "description":"Wrap the summarize() function as a skill"
}
```

Response: SSE stream (§7.0).

| Code | Status / event | Cause |
|---|---|---|
| `MISSING_SOURCE` | 400 (pre-stream) | Neither `code` nor `repoUrl` provided. |
| `AMBIGUOUS_SOURCE` | 400 (pre-stream) | Both `code` and `repoUrl` provided. |
| `EMPTY_SOURCE` | 400 (pre-stream) | After fetching, source is empty. |
| `REPO_FETCH_FAILED` | 400 (pre-stream) | GitHub fetch failed. |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 (pre-stream) | Standard. |

### 7.3 Generate from OpenAPI — `POST /api/v1/skills/generate/from-openapi`

Generate a skill that wraps one or more endpoints from an OpenAPI 3 spec.

**Auth: required.** **Permission: `ornn:skill:build`.**

Body (`application/json`):

```jsonc
{
  "spec":      "<OpenAPI YAML or JSON as a string>",  // required
  "endpoints": ["POST /v1/summary", "GET /v1/items"], // optional allow-list
  "description": "Wrap the summary endpoint as a skill"
}
```

Without `endpoints`, the generator covers every operation in the spec.

Response: SSE stream (§7.0).

| Code | Status / event | Cause |
|---|---|---|
| `MISSING_SPEC` | 400 (pre-stream) | `spec` missing or empty. |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 | Standard. |

---

## 8. Playground (SSE)

One endpoint. Server-side tool-use loop with sandbox execution.

### 8.0 Playground event shapes

```jsonc
{ "type": "text-delta",  "delta": "Sure, here is the result …" }

{ "type": "tool-call",   "toolCall": { "id": "tc_1", "name": "execute_script", "args": { "language": "python", "code": "..." } } }

{ "type": "tool-result", "toolCallId": "tc_1", "result": "stdout output" }

{ "type": "file-output", "file":   { "path": "out.csv", "content": "...", "size": 1024, "mimeType": "text/csv" } }

{ "type": "error",       "message": "..." }                          // fatal
{ "type": "finish",      "finishReason": "stop" }                    // terminal — normal end
{ "type": "keepalive" }                                              // ignore
```

Standard chat ends with `finish`. `tool-call` / `tool-result` pairs appear only for runtime-based skills (or when the LLM explicitly invokes `skill_search`).

### 8.1 Chat — `POST /api/v1/playground/chat`

**Auth: required.** **Permission: `ornn:playground:use`.**

Request body (`application/json`):

```jsonc
{
  "messages": [                            // 1–100 messages, validated by Zod
    {
      "role": "user",                      // "user" | "assistant" | "tool" | "system"
      "content": "Translate: Hello",
      "toolCalls":  [/* optional */],
      "toolCallId": "tc_..."               // optional — for "tool" role
    }
  ],
  "skillId": "<guid or kebab-case name>",  // optional — without it, "blank" agent
  "envVars": { "OPENAI_API_KEY": "..." }   // optional — injected into sandbox for runtime skills
}
```

Schema:

```ts
z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "tool", "system"]),
    content: z.string(),
    toolCalls: z.array(z.object({
      id: z.string(),
      name: z.string(),
      args: z.record(z.unknown()),
    })).optional(),
    toolCallId: z.string().optional(),
  })).min(1).max(100),
  skillId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
})
```

Response: SSE stream (§8.0). When `skillId` resolves to a real skill, a `playground` pull event is recorded for analytics (fire-and-forget; failures never surface).

The backend runs up to 5 rounds of tool-use; when the LLM emits a `function_call` to `execute_script` or `skill_search`, the backend executes it (no client approval), feeds the result back as a `tool` message, and continues streaming.

| Code | Status / event | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 (pre-stream) | Body failed Zod validation. |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 (pre-stream) | Standard. |
| `error` | terminal stream event | Chat error during the LLM / sandbox loop. |

---

## 9. Notifications

Four endpoints. All require auth. All scoped to the caller — no cross-user reads.

Two notification categories are emitted today; both come from the audit pipeline:

| Category | Sent to | Trigger |
|---|---|---|
| `audit.completed` | The skill **owner** | Every audit completion. Body distinguishes `green` from `yellow`/`red` and links to the audit history page. |
| `audit.risky_for_consumer` | Every consumer of a `yellow`/`red`-verdict skill — every user in `sharedWithUsers`, plus the membership of every org in `sharedWithOrgs` (resolved via NyxID at fan-out time) | Same audit completion. Skipped for `green`. |

There are no other categories; share / waiver / review notifications were removed when the audit-gated share workflow was retired.

### 9.1 List notifications — `GET /api/v1/notifications`

**Auth: required.**

| Query param | Type | Notes |
|---|---|---|
| `unread` | `"true"` | Optional. Restrict to unread. |
| `limit` | int 1–200 | Default 50. |

Response 200:

```jsonc
{
  "data": {
    "items": [
      {
        "_id": "ntf_...",
        "userId": "user_...",
        "category": "audit.risky_for_consumer",
        "title": "Audit found risk in 'csv-tools' (yellow)",
        "body": "...",
        "link": "/skills/csv-tools/audits?version=1.3",
        "data": { "skillGuid": "skl_...", "version": "1.3", "verdict": "yellow" },
        "readAt": null,
        "createdAt": "2026-04-28T..."
      }
    ]
  },
  "error": null
}
```

### 9.2 Unread count — `GET /api/v1/notifications/unread-count`

**Auth: required.** Cheap to poll for badge counts.

Response 200:

```jsonc
{ "data": { "count": 7 }, "error": null }
```

### 9.3 Mark one read — `POST /api/v1/notifications/:id/read`

**Auth: required.** Sets `readAt` to `now()` and returns the updated row.

Path param: `:id`. Body: ignored (send `{}`).

Response 200:

```jsonc
{ "data": <NotificationDocument with readAt set>, "error": null }
```

| Code | Status | Cause |
|---|---|---|
| `AUTH_MISSING` | 401 | Standard. |
| `NOT_FOUND` | 404 | Notification does not belong to the caller (or does not exist). |

### 9.4 Mark all read — `POST /api/v1/notifications/mark-all-read`

**Auth: required.** Marks every unread notification belonging to the caller as read.

Body: ignored.

Response 200:

```jsonc
{ "data": { "updated": 12 }, "error": null }
```

---

## 10. Analytics

Two endpoints, both visibility-gated like `GET /skills/:idOrName`.

### 10.1 Execution summary — `GET /api/v1/skills/:idOrName/analytics`

**Auth: optional.** Anonymous callers only see public skills.

Path param: `:idOrName`. Query:

| Param | Values | Default |
|---|---|---|
| `window` | `7d` \| `30d` \| `all` | `30d` |
| `version` | `<major>.<minor>` | (all versions) |

Response 200:

```jsonc
{
  "data": {
    "skillGuid": "skl_...",
    "window": "30d",
    "version": "1.3",
    "executionCount": 412,
    "successCount": 402,
    "failureCount": 8,
    "timeoutCount": 2,
    "successRate": 0.9757,
    "latencyMs": { "p50": 220, "p95": 1180, "p99": 2400 },
    "uniqueUsers": 37,
    "topErrorCodes": [ { "code": "rate_limit", "count": 5 }, { "code": "timeout", "count": 2 } ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_WINDOW` | 400 | `window` not in the enum. |
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden. |

### 10.2 Pulls time-series — `GET /api/v1/skills/:idOrName/analytics/pulls`

**Auth: optional.** Same visibility as 10.1.

Path param: `:idOrName`. Query:

| Param | Values | Default |
|---|---|---|
| `bucket` | `hour` \| `day` \| `month` | `day` |
| `from` | ISO timestamp | (server default — last 7 days) |
| `to` | ISO timestamp | now |
| `version` | `<major>.<minor>` | (all versions) |

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "bucket": "2026-04-21T00:00:00Z", "total": 42, "bySource": { "api": 30, "web": 8,  "playground": 4  } },
      { "bucket": "2026-04-22T00:00:00Z", "total": 51, "bySource": { "api": 35, "web": 12, "playground": 4  } }
    ]
  },
  "error": null
}
```

`bySource` keys:

| Source | Recorded by |
|---|---|
| `api` | `GET /skills/:idOrName/json` — programmatic pull (SDK / CLI / external agent). The closest signal to the north-star "skills consumed by external agents". |
| `web` | `GET /skills/:idOrName` — minted-presigned-URL pull from the detail page in a browser. |
| `playground` | `POST /playground/chat` when bound to a real skill. |

| Code | Status | Cause |
|---|---|---|
| `INVALID_BUCKET` | 400 | `bucket` not in the enum. |
| `INVALID_RANGE` | 400 | `from` / `to` is malformed or `from >= to`. |
| `SKILL_NOT_FOUND` | 404 | Skill missing / hidden. |

---

## 11. Me — caller scope

Eight endpoints. All require auth and are scoped to the caller — there is no "read another user's …" surface here.

### 11.1 Identity snapshot — `GET /api/v1/me`

**Auth: required.**

Response 200:

```jsonc
{
  "data": {
    "userId": "user_...",
    "email": "alice@example.com",
    "displayName": "Alice",
    "roles": ["ornn-user"],
    "permissions": ["ornn:skill:read", "ornn:skill:create", "..."]
  },
  "error": null
}
```

Useful when debugging a 403: confirms what the proxy actually believes about the caller.

### 11.2 Login telemetry — `POST /api/v1/activity/login`

**Auth: required.** Records a session-opened event in the activity log. Fire-and-forget; the frontend calls this after OAuth callback success.

Body: ignored.

Response 200: `{ "data": { "success": true }, "error": null }`.

### 11.3 Logout telemetry — `POST /api/v1/activity/logout`

**Auth: required.** Mirror of 11.2 — records a session-closed event before sign-out.

Body: ignored. Response: same as 11.2.

### 11.4 Org memberships — `GET /api/v1/me/orgs`

**Auth: required.** List the caller's NyxID org memberships (roles `admin` and `member` only — `viewer` is filtered out).

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "userId": "org_xyz", "role": "admin",  "displayName": "Acme Robotics" },
      { "userId": "org_abc", "role": "member", "displayName": "Acme Public" }
    ]
  },
  "error": null
}
```

Fail-soft: if NyxID is unreachable or the proxy stripped the user's access token, returns `[]` instead of erroring.

### 11.5 Resolve a single org — `GET /api/v1/me/orgs/:orgId`

**Auth: required.** Proxy a single-org lookup to NyxID. Used to back-fill display names for orgs the caller may no longer be a member of (e.g. a skill was shared with `org_xyz` but the author has since left).

Path param: `:orgId`.

Response 200:

```jsonc
{
  "data": {
    "userId": "org_xyz",
    "displayName": "Acme Robotics",
    "avatarUrl": "https://..."
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `ORG_NOT_FOUND` | 404 | NyxID returned 404/403, or no caller token was forwarded. |
| `NYXID_ORG_LOOKUP_FAILED` | 500 | NyxID returned a non-OK status (other than 404/403). |

### 11.6 NyxID services — `GET /api/v1/me/nyxid-services`

**Auth: required.** List the NyxID catalog services the caller can tie a skill to. Two tiers:

- **admin** services (NyxID `visibility: "public"`) — platform-wide. Tying a skill here marks it a system skill (forces `isPrivate: false`).
- **personal** services (NyxID `visibility: "private"` AND `created_by === caller`) — services the caller created. Tying does not change privacy.

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "id": "svc_...", "slug": "ornn-api",       "label": "Ornn API",       "description": null, "tier": "admin" },
      { "id": "svc_...", "slug": "chrono-storage", "label": "Chrono Storage", "description": null, "tier": "admin" },
      { "id": "svc_...", "slug": "my-private-svc", "label": "My Private Svc", "description": "...","tier": "personal" }
    ]
  },
  "error": null
}
```

Fail-soft: returns `[]` when NyxID is unreachable or no token was forwarded.

### 11.7 Grants summary — `GET /api/v1/me/skills/grants-summary`

**Auth: required.** Aggregate the caller's own skills into per-grantee buckets — "I've shared N skills with this org / this user". Powers the My-Skills filter chip row.

Response 200:

```jsonc
{
  "data": {
    "orgs": [
      { "id": "org_xyz", "displayName": "Acme Robotics", "skillCount": 3 }
    ],
    "users": [
      { "userId": "user_...", "email": "...", "displayName": "Bob", "skillCount": 5 }
    ]
  },
  "error": null
}
```

Display names are resolved best-effort (NyxID for orgs, Ornn's activity directory for users); failures fall back to the raw id.

### 11.8 Sources summary — `GET /api/v1/me/shared-skills/sources-summary`

**Auth: required.** Mirror of 11.7 for the Shared-with-me tab — for each user / org that shared with the caller, how many of their skills the caller can see.

Response 200: same shape as 11.7.

---

## 12. Users directory

Two endpoints. Backed by Ornn's `activities` collection — anyone who has ever signed into Ornn has a directory row keyed by `userId` + `email` + `displayName`.

### 12.1 Search — `GET /api/v1/users/search`

**Auth: required.** Any authed caller may search; the result set is scoped to users with at least one Ornn activity row.

| Query param | Type | Notes |
|---|---|---|
| `q` | string ≤ 256 | Email prefix. Empty returns the most recent N. |
| `limit` | int 1–50 | Default 10. |

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "userId": "user_...", "email": "alice@…", "displayName": "Alice" }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `INVALID_QUERY` | 400 | Query failed Zod validation. |

### 12.2 Resolve — `GET /api/v1/users/resolve`

**Auth: required.** Batch-resolve a list of `userId`s to `{ email, displayName }` rows. Used to render labels for `sharedWithUsers` entries that were saved as bare ids.

Query: `ids=id1,id2,id3` (max 100 per call). Unknown ids are silently dropped — no 404.

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "userId": "user_a", "email": "a@…", "displayName": "Alice" },
      { "userId": "user_b", "email": "b@…", "displayName": "Bob" }
    ]
  },
  "error": null
}
```

---

## 13. Admin

Thirteen endpoints. All under `/api/v1/admin/*`. All require auth. Most agents never call these; they exist for the platform-admin UI.

### 13.1 Stats — `GET /api/v1/admin/stats`

**Auth: required.** **Permission: `ornn:admin:skill`.**

Response 200:

```jsonc
{
  "data": {
    "totalUsers": 124,
    "totalSkills": 412,
    "publicSkills": 271,
    "privateSkills": 141,
    "recentActivities": 87
  },
  "error": null
}
```

`recentActivities` is the count of activity-log rows in the last 24 hours.

### 13.2 Activities — `GET /api/v1/admin/activities`

**Auth: required.** **Permission: `ornn:admin:skill`.**

| Query param | Type | Notes |
|---|---|---|
| `page` | int ≥ 1 | Default 1. |
| `pageSize` | int 1–100 | Default 20. |
| `action` | activity action | Filter by action type (`login`, `skill:create`, `skill:update`, `skill:delete`, …). |
| `userId` | string | Filter by user. |

Response 200:

```jsonc
{
  "data": {
    "items": [
      {
        "id": "act_...",
        "userId": "user_...",
        "userEmail": "...",
        "userDisplayName": "...",
        "action": "skill:create",
        "details": { "skillId": "skl_...", "skillName": "my-skill" },
        "createdAt": "2026-04-28T..."
      }
    ],
    "total": 412,
    "page": 1,
    "pageSize": 20,
    "totalPages": 21
  },
  "error": null
}
```

### 13.3 Users — `GET /api/v1/admin/users`

**Auth: required.** **Permission: `ornn:admin:skill`.**

| Query param | Type | Notes |
|---|---|---|
| `page` | int ≥ 1 | Default 1. |
| `pageSize` | int 1–100 | Default 20. |

Aggregates the activity collection into a per-user roster. Each item is enriched with skill counts:

```jsonc
{
  "data": {
    "items": [
      {
        "userId": "user_...",
        "email": "...",
        "displayName": "...",
        "lastActiveAt": "2026-04-28T...",
        "activityCount": 87,
        "skillCount": 5
      }
    ],
    "total": 124,
    "page": 1,
    "pageSize": 20,
    "totalPages": 7
  },
  "error": null
}
```

### 13.4 Skills (admin-wide) — `GET /api/v1/admin/skills`

**Auth: required.** **Permission: `ornn:admin:skill`.**

| Query param | Type | Notes |
|---|---|---|
| `page`, `pageSize` | as above | |
| `q` | string | Substring match against name and description. |
| `userId` | string | Filter by author. |

Response 200:

```jsonc
{
  "data": {
    "items": [
      {
        "guid": "skl_...",
        "name": "my-skill",
        "description": "...",
        "createdBy": "user_...",
        "createdByEmail": "...",
        "createdByDisplayName": "...",
        "createdOn": "2026-04-28T...",
        "updatedOn": "2026-04-28T...",
        "isPrivate": true,
        "tags": ["..."]
      }
    ],
    "total": 412,
    "page": 1,
    "pageSize": 20,
    "totalPages": 21
  },
  "error": null
}
```

Admin browse — no visibility filtering. Every skill in the registry is reachable here regardless of `isPrivate` / share-list.

### 13.5 Admin delete — `DELETE /api/v1/admin/skills/:id`

**Auth: required.** **Permission: `ornn:admin:skill`.** Same effect as `DELETE /skills/:id` (§3.11) but bypasses the author check.

Response 200: `{ "data": { "success": true }, "error": null }`.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | Skill missing. |
| `FORBIDDEN` | 403 | Missing `ornn:admin:skill`. |

### 13.6 List categories — `GET /api/v1/admin/categories`

**Auth: required.** **Permission: `ornn:admin:category`.**

Response 200:

```jsonc
{
  "data": [
    {
      "_id": "cat_...",
      "name": "tool-based",
      "slug": "tool-based",
      "description": "...",
      "order": 2,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "error": null
}
```

### 13.7 Create category — `POST /api/v1/admin/categories`

**Auth: required.** **Permission: `ornn:admin:category`.**

Body:

```jsonc
{
  "name": "tool-based",                 // one of: plain | tool-based | runtime-based | mixed
  "slug": "tool-based",                 // 1–50 chars, lowercase alphanumeric + hyphens
  "description": "...",                 // 1–500 chars
  "order": 2                            // optional, ≥ 0
}
```

Response 201: the new `CategoryDocument`.

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed Zod validation. |

### 13.8 Update category — `PUT /api/v1/admin/categories/:id`

**Auth: required.** **Permission: `ornn:admin:category`.**

Path param: `:id` — category id.

Body (any subset):

```jsonc
{
  "description": "...",   // 1–500 chars
  "order": 3              // ≥ 0
}
```

Response 200: the updated `CategoryDocument`.

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed validation. |
| `NOT_FOUND` | 404 | No such category. |

### 13.9 Delete category — `DELETE /api/v1/admin/categories/:id`

**Auth: required.** **Permission: `ornn:admin:category`.**

Response 200: `{ "data": { "success": true }, "error": null }`.

### 13.10 List tags — `GET /api/v1/admin/tags`

**Auth: required.** **Permission: `ornn:admin:skill`.**

Query: `type` (`predefined` | `custom`) — optional filter.

Response 200:

```jsonc
{ "data": [{ "_id": "tag_...", "name": "translation", "createdAt": "..." }], "error": null }
```

### 13.11 Create tag — `POST /api/v1/admin/tags`

**Auth: required.** **Permission: `ornn:admin:skill`.**

Body:

```jsonc
{ "name": "translation" }
```

`name` must be 1–30 chars and match `/^[a-z0-9-_]+$/`.

Response 201: the new `TagDocument`.

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed validation. |

### 13.12 Delete tag — `DELETE /api/v1/admin/tags/:id`

**Auth: required.** **Permission: `ornn:admin:skill`.** Response: `{ "data": { "success": true }, "error": null }`.

### 13.13 Admin force-audit — `POST /api/v1/admin/skills/:idOrName/audit`

Documented as §4.5 above (audit section).

---

## 14. Platform settings

Two endpoints. Editable per-deployment thresholds the platform admin controls. `auditWaiverThreshold` is the only field at the moment; new settings will be added here as features land.

### 14.1 Read settings — `GET /api/v1/admin/settings`

**Auth: required.** **Permission: `ornn:admin:skill`.**

Response 200:

```jsonc
{
  "data": {
    "auditWaiverThreshold": 7.5
  },
  "error": null
}
```

`auditWaiverThreshold` is a 0–10 number; it is currently informational only — kept on the document because earlier designs surfaced a "low risk → auto-share" UI hint. The current sharing path does not consume it.

### 14.2 Patch settings — `PATCH /api/v1/admin/settings`

**Auth: required.** **Permission: `ornn:admin:skill`.**

Request body (`application/json`, partial):

```jsonc
{ "auditWaiverThreshold": 7.5 }
```

`auditWaiverThreshold` must be a number in `[0, 10]`. Values are rounded to one decimal.

Response 200: the updated settings document.

| Code | Status | Cause |
|---|---|---|
| `INVALID_SETTING` | 400 | Field out of range or no recognised fields in body. |
| `FORBIDDEN` | 403 | Missing `ornn:admin:skill`. |

---

## Appendix — staying in sync with this file

When the API surface changes, the change lands in `ornn-api/src/domains/**/routes.ts` first. This file should be updated in the same PR. The `version:` field in the parent `SKILL.md` is bumped on every doc-affecting change; agents pulling the skill will see the bump on `GET /api/v1/skills/ornn-agent-manual/json` and can refresh their context. There is no out-of-band changelog — `git log skills/ornn-agent-manual/` is the changelog.
