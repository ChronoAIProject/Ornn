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
   - 8a. Assistant (SSE)
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
| `ornn:skill:create` | `ornn-user` | `POST /skills`, `POST /skills/pull`, `POST /skillsets` |
| `ornn:skill:update` | `ornn-user` | `PUT /skills/:id`, `PUT /skills/:id/permissions`, `POST /skills/:id/refresh`, `PATCH /skills/:idOrName/versions/:version`, `PUT /skillsets/:id`, `PUT /skillsets/:id/plugin-export`, `POST /skillsets/:id/transfer-ownership` |
| `ornn:skill:delete` | `ornn-user` | `DELETE /skills/:id`, `DELETE /skills/:idOrName/versions/:version`, `DELETE /skillsets/:id` |
| `ornn:skill:build` | `ornn-user` | `POST /skills/generate`, `POST /skills/generate/from-source`, `POST /skills/generate/from-openapi` |
| `ornn:playground:use` | `ornn-user` | `POST /playground/chat` |
| `ornn:admin:skill` | `ornn-admin` | All `/admin/*` skill-scoped routes; admin force-audit; sectioned platform settings; mirror config; announcements / broadcasts; `GET /admin/dashboard/stats`; all `/admin/quota/*`; all `/admin/redemption-codes/*`; `/admin/launch-promo/*`. The quota / redemption / dashboard routes are gated by the code constant `QUOTA_ADMIN_PERMISSION`, which is an **alias whose value is `ornn:admin:skill`** — there is no separate `ornn:quota:admin` scope. |

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
| 201 | Resource created (admin announcement / broadcast / redemption-code create) |
| 400 | Validation error, malformed body, bad query param |
| 401 | `AUTH_MISSING` — no usable identity from the proxy |
| 403 | `FORBIDDEN` — authed but missing permission, ownership check failed, or trying to mutate someone else's skill |
| 404 | `*_NOT_FOUND` — resource missing or hidden under visibility rules |
| 409 | Conflict (e.g. `REDEMPTION_CODE_ALREADY_REDEEMED`) |
| 410 | Gone (e.g. `REDEMPTION_CODE_EXPIRED`, `REDEMPTION_CODE_INVALIDATED`) |
| 413 | `PAYLOAD_TOO_LARGE` — ZIP exceeds `MAX_PACKAGE_SIZE_BYTES` (default 50 MiB) |
| 429 | `QUOTA_EXCEEDED` — caller has burned this month's allotment on the metered surface. Check `/me/quota`. |
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
| `skill_dependency_not_found` | 404 | A `depends-on` ref in a dependency closure doesn't resolve or isn't visible (#968). |
| `dependency_cycle` | 409 | The dependency closure graph loops back on itself (#968). |
| `dependency_conflict` | 409 | One skill is pinned to two versions within the same closure (#968). |
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
| `INVALID_SURFACE` | 400 | `/me/models` `surface` query param is not `playground` or `skillGen`. |
| `QUOTA_EXCEEDED` | 429 | Monthly allotment burned on the metered surface (`playground` or `skillGen`). Read `/me/quota` for the snapshot. |
| `MODEL_UNAVAILABLE` / `MODEL_NOT_ENABLED` / `MODEL_NOT_FOUND` | 400 | SSE pre-stream: requested `modelId` is unknown or not enabled for this surface. Call `/me/models` to discover valid ids. |
| `NOTIFICATION_NOT_FOUND` | 404 | `POST /notifications/:id/read` — the id is neither a per-user notification nor a broadcast the caller can see. |
| `REDEMPTION_CODE_NOT_FOUND` | 404 | Redemption code does not exist. |
| `REDEMPTION_CODE_EXPIRED` | 410 | Past `expiresAt`. |
| `REDEMPTION_CODE_INVALIDATED` | 410 | Admin revoked the code. |
| `REDEMPTION_CODE_ALREADY_REDEEMED` | 409 | Already consumed (codes are single-use). |
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

### 2.4 `GET /api/v1/github/repo`

**Public mirror coordinates** for the GitHub skill mirror (§3.15 / §13.8). **Auth: none.** Returns `{ data: { owner, repo, branch, enabled }, error: null }` — coordinates only, never credentials. The `enabled` flag lets a client hide the `npx skills add …` / `/plugin marketplace add …` install snippet when the mirror is off. The admin config write is §13.8.

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
  // Preferred — a single folder URL the user copied from the browser
  // address bar; the server parses out repo / ref / path.
  "githubUrl": "https://github.com/owner/repo/tree/main/path/to/skill",

  // Legacy / explicit form. Either provide `githubUrl` OR (`repo` plus
  // optional `ref`/`path`). `githubUrl` wins when both are sent.
  "repo": "owner/name",
  "ref": "main",                 // optional — branch, tag, or commit SHA. Default: repo default branch.
  "path": "skills/my-skill",     // optional — sub-directory inside repo. Default: repo root.

  "skip_validation": false       // optional. Skips the format validator on the pulled ZIP — useful when upstream doesn't strictly conform to Ornn's package layout.
}
```

The accepted `githubUrl` shapes are: `https://github.com/<owner>/<repo>/tree/<ref>/<path...>`, `https://github.com/<owner>/<repo>/tree/<ref>`, and `https://github.com/<owner>/<repo>` (defaults to the repo root). `blob/` URLs (which point at a single file) and non-`github.com` hosts are rejected with `INVALID_GITHUB_URL`.

Response 200: same shape as `POST /skills` — the freshly created `SkillDetail`. The skill's `source.lastSyncedCommit` records the commit SHA pulled at creation time.

| Code | Status | Cause |
|---|---|---|
| `MISSING_SOURCE` | 400 | Neither `githubUrl` nor `repo` was provided. |
| `INVALID_GITHUB_URL` | 400 | `githubUrl` couldn't be parsed (blob URL, non-github host, missing repo, etc.). `message` carries the specific reason. |
| `PULL_FAILED` | 400 | The repo couldn't be cloned, the path was empty, or the package failed to materialise. `message` carries the underlying cause. |
| `VALIDATION_FAILED` | 400 | Pulled package failed format validation (and `skip_validation` was not set). |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 | Same as §3.1. |

### 3.3 Refresh from source — `POST /api/v1/skills/:id/refresh`

Re-pull the skill's recorded GitHub source. Two modes selected by the request body:

- **Apply mode (default).** Pulls, validates (unless `skipValidation` is `true`), and publishes a new version when the bytes differ from the current latest.
- **Dry-run mode (`dryRun: true`).** Pulls, computes a structured diff against the current latest version, and returns the diff without publishing. Drives the "preview-then-confirm" UI flow on the detail-page Advanced Options panel — surface the diff to the user, then call again with `dryRun: false` to commit.

**Auth: required.** **Permission: `ornn:skill:update`.** **Owner OR platform admin** (`ornn:admin:skill`).

Path param: `:id` — skill GUID (not name).

Request body (`application/json`):

```jsonc
{
  "dryRun": false,         // optional. true → diff preview, no version bump. false / omitted → apply.
  "skipValidation": false  // optional (apply mode only). Skips the format validator on the pulled package.
}
```

Response 200 — apply mode: the refreshed `SkillDetail`. `source.lastSyncedCommit` and `source.lastSyncedAt` advance.

Response 200 — dry-run mode:

```jsonc
{
  "data": {
    "skill":           { "guid": "…", "name": "…" },
    "source":          { /* SkillSource, with lastSyncedCommit set to the commit that WOULD be pulled */ },
    "pendingVersion":  "1.3",            // version the SKILL.md frontmatter inside the pulled bytes declares
    "hasChanges":      true,             // false → upstream is byte-identical to current latest; nothing to bump
    "diff":            { /* same shape as §3.7 — { files: { added, removed, modified, unchangedCount } } */ }
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No skill with that GUID. |
| `NOT_SKILL_OWNER` | 403 | Caller is not the author and lacks `ornn:admin:skill`. |
| `NO_SOURCE` | 400 | Skill has no linked GitHub source. Attach one via §3.15 first. |
| `REFRESH_FAILED` | 400 | Source repo could not be re-fetched, or the resulting package failed validation (apply mode). |
| `REFRESH_PREVIEW_FAILED` | 400 | Dry-run pull failed (e.g. upstream folder removed). |
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

### 3.6a Resolve dependency closure — `GET /api/v1/skills/:idOrName/closure`

Resolve the full **transitive** dependency closure of a skill version (#968). A skill declares direct dependencies in SKILL.md frontmatter under `metadata.depends-on` (an array of `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>` refs — no semver ranges, no self-references). This endpoint walks that graph and returns every transitive dependency.

**Auth: optional.** Anonymous callers resolve against public skills only; a public skill that transitively depends on a private skill you can't read surfaces that node as `skill_dependency_not_found` (existence is not leaked).

Path param: `:idOrName`. Query param: `version` (optional) — literal `<major>.<minor>` or a dist-tag; defaults to the skill's latest.

Items come back in **deps-first topological order** — every dependency precedes the dependents that pin it, so installing in array order is always safe. Shared nodes (diamonds) appear exactly once.

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "guid": "skl_...", "name": "pdf-tools",  "version": "1.0", "skillHash": "sha256:...", "depth": 1 },
      { "guid": "skl_...", "name": "report-base", "version": "2.3", "skillHash": "sha256:...", "depth": 0 }
    ]
  },
  "error": null
}
```

| Code | Status | Cause |
|---|---|---|
| `dependency_cycle` | 409 | The dependency graph loops back on itself. |
| `dependency_conflict` | 409 | One skill is pinned to two versions within the closure. |
| `skill_dependency_not_found` | 404 | A dependency ref doesn't resolve or isn't visible. |
| `skill_not_found` | 404 | The root skill / version is unknown (or not visible). |

The same closure is validated at **publish time** (`POST /skills`, `PUT /skills/:id`): a `depends-on` ref that won't resolve, forms a cycle, or conflicts fails the publish before the version is committed.

SDK: `client.resolveClosure(idOrName, { version })` and `client.pullClosure(idOrName, { version })` (TypeScript); `client.resolve_closure(...)` and `client.pull_closure(...)` (Python). `pullClosure` / `pull_closure` resolves the closure and downloads each package in topological order.

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

### 3.15 Set / clear GitHub source — `PUT /api/v1/skills/:id/source`

Attach (or clear) a GitHub source pointer on an existing skill **without pulling**. Lets a user link an originally hand-uploaded skill to its GitHub source first and trigger the actual sync separately via §3.3 (typically dry-run → confirm → apply). Pass `null` to unlink.

**Auth: required.** **Permission: `ornn:skill:update`.** **Owner OR platform admin** (`ornn:admin:skill`).

Path param: `:id` — skill GUID (not name).

Request body (`application/json`):

```jsonc
{
  // Folder URL on github.com. Same shapes accepted by §3.2's `githubUrl`:
  // /tree/<ref>/<path>, /tree/<ref>, or bare repo URL.
  // Pass `null` to remove the existing source pointer.
  "githubUrl": "https://github.com/owner/repo/tree/main/path/to/skill"
}
```

Response 200: the updated `SkillDetail`. The stored `source` block omits `lastSyncedAt` / `lastSyncedCommit` until the first sync (apply-mode refresh) — that's the documented "linked but never synced" state.

| Code | Status | Cause |
|---|---|---|
| `SKILL_NOT_FOUND` | 404 | No skill with that GUID. |
| `NOT_SKILL_OWNER` | 403 | Caller is not the author and lacks `ornn:admin:skill`. |
| `INVALID_BODY` | 400 | `githubUrl` is missing or not `string \| null`. |
| `INVALID_GITHUB_URL` | 400 | URL couldn't be parsed (blob URL, non-github host, missing repo, etc.). |
| `AUTH_MISSING` / `FORBIDDEN` | 401 / 403 | Standard. |

### 3.16 Transfer ownership — `POST /api/v1/skills/:id/transfer-ownership`

Hand a skill to another Ornn user (#1123). **ADMIN-tier**: the caller must be the skill **author or a platform admin** — a write grantee is not enough. Immediate + synchronous; the prior owner is retained as a **READ** grant (keeps visibility, loses edit/admin).

**Auth: required.** **Permission: `ornn:skill:update`** (+ author/admin). Path param `:id` — skill GUID.

```jsonc
{ "newOwnerUserId": "user_…" }   // REQUIRED, 1..128 chars
```

The target must be a known Ornn user (signed in to Ornn at least once) — resolved before any mutation. Response 200: `{ data: { skill: SkillDetail }, error: null }` with `createdBy` now the new owner. Side effects: the mirror refreshes cached author labels and referencing skillsets recompute their derived visibility (#1136).

| Code | Status | Cause |
|---|---|---|
| `invalid_transfer` | 400 | Body fails validation (missing `newOwnerUserId`). |
| `invalid_transfer_target` | 400 | Target isn't a known Ornn user (never signed in). |
| `skill_not_found` | 404 | No skill with that GUID. |
| `forbidden` | 403 | Caller is not the author and lacks `ornn:admin:skill`. |
| `ownership_conflict` | 409 | Target already owns the skill. |

### 3.17 Dist-tags — `GET | PUT | DELETE /api/v1/skills/:id/dist-tags[/:tag]`

npm-style named pointers to versions (#463). `latest` is auto-managed by the publish path and always present (synthesized from `latestVersion` for pre-#463 skills). Tag grammar: `/^[a-z][a-z0-9-]{0,49}$/` (lowercase, must start with a letter — so a tag can't look like a version). A `@<tag>` ref resolves anywhere the ref grammar is accepted (skill deps, skillset members).

- **Read — `GET /api/v1/skills/:idOrName/dist-tags`.** Auth: optional (name **or** GUID; private skills 404-masked for non-readers). No scope. Returns `{ data: { tags: { "<tag>": "<version>", … } }, error: null }` — always includes `latest`.
- **Set — `PUT /api/v1/skills/:id/dist-tags/:tag`.** Auth: required, **`ornn:skill:update`** + author/admin. GUID only. Body `{ "version": "1.3" }` (`<major>.<minor>`). The target version must already exist. Returns the full refreshed tags map.
- **Delete — `DELETE /api/v1/skills/:id/dist-tags/:tag`.** Auth: required, **`ornn:skill:update`** + author/admin. GUID only. Returns the refreshed tags map.

| Code | Status | Cause |
|---|---|---|
| `invalid_dist_tag_body` | 400 | PUT body missing/malformed `version`. |
| `invalid_dist_tag` | 400 | `:tag` fails the grammar. |
| `dist_tag_immutable` | 400 | Tried to set/delete `latest` (auto-managed). |
| `skill_version_not_found` | 404 | PUT target version doesn't exist. |
| `skill_not_found` | 404 | No such skill. |
| `forbidden` | 403 | Not author/admin (write paths). |

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

## 5a. Skillsets (#969)

A **skillset** is a named, versioned, owned meta-package that references N member skills and carries a `kind`. One call (`/closure`) resolves + delivers the whole set — including each member's dependency closure (§3.6a). Immutable versioning mirrors skills, and permission scopes **reuse** `ornn:skill:{create,read,update,delete}` (a dedicated `ornn:skillset:*` split is a tracked follow-up). Two things do **not** mirror skills and trip up most callers: **visibility is DERIVED from the member skills, never owner-set** (#1136), and **revisions are system-managed, never caller-supplied** (#1162). Read the two model notes below before calling any endpoint.

- `kind` enum: `generic` (default) | `consensus-supported`. The latter is an author **claim** that the members are an independent, comparable set — not a guarantee. Ornn delivers the set; the agent runs any consensus in its own runtime.
- `members`: 2..100 skill refs (min 2 — a bundle of one is just a skill), each ≤115 chars and shaped `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>` (same grammar as `depends-on`; no semver ranges). **No nested skillsets** — a ref may not start with `skillset:`. Validated on publish under SYSTEM (each must resolve to a real skill version; union closure conflict-free) — so a curator may legitimately bundle a private skill they own.
- `instructions` (master prompt, #978): **REQUIRED**, versioned markdown telling an agent **HOW** to use the set (orchestration, ordering, which member to pick when). 1..8000 chars (trimmed; whitespace-only rejected). Distinct from `description` (short ≤1024 summary). **Required on BOTH create and publish, with NO carry-forward** — unlike `description`/`kind`/`tags` (a publish may omit them to inherit the prior version), every version must restate its own master prompt. Stored opaque (no rendering / sanitization / templating / linting / search-indexing). Surfaced verbatim on the detail read and as a root field on `/closure`.

**Model note — derived visibility (#1136).** A skillset has **no owner-set visibility**. Its `isPrivate` / `sharedWithUsers` / `sharedWithOrgs` / `grants` fields are **inert legacy** (kept for back-compat only — do not rely on them). Reachability is computed live from the members: a caller may read a skillset **iff they can read every member skill** at the requested version. The owner and platform admins always see it, plus an `unreadableMembers` list (the members *they* can no longer read, for repair); every other caller gets a flat `skillset_not_found` (404) the moment any one member is unreadable — the response never reveals *which* member (so non-owners always get `unreadableMembers: []`). The derived state is surfaced as **`memberVisibilityState`**: `all-public` (every member public → discoverable by anyone), `restricted` (≥1 private/shared member → only callers who can read all members), `unresolvable` (≥1 member ref no longer resolves → only the owner sees it, with a warning). **There is no permissions endpoint. To widen a skillset's reach you expose the underlying member skills to the intended audience** — you never set visibility on the skillset itself.

**Model note — auto-revision (#1162/#1165).** Revisions are system-managed `<major>.<minor>` starting at `1.0`; the owner **never sends a `version`** on create or publish. Every owner publish auto-bumps the **minor** (major never auto-bumps). A skillset is also **reactively re-cut** with a minor bump when its *public-resolved-member snapshot* moves — i.e. a member's version pointer changes, or a member flips private⇄public — so a consumer's `/closure` stays coherent and a mirrored plugin re-publishes. Sending a `version` field is silently ignored by the schema; do not build request bodies around one.

### 5a.1 Create skillset — `POST /api/v1/skillsets`

Requires `ornn:skill:create`. **Do not send a `version`** — the system assigns the initial revision `1.0` (auto-revision model note above). Reachability is derived from the members, never set here. JSON body:

```jsonc
{
  "name": "review-set",            // REQUIRED, kebab-case, unique
  "description": "A curated comparison set.",   // REQUIRED, 1..1024 chars
  "instructions": "Run pdf-tools first, then feed its output to csv-tools…",  // REQUIRED master prompt, 1..8000 chars
  "kind": "consensus-supported",   // optional, default "generic"
  "tags": ["review"],              // optional, ≤20 kebab-case tags
  "members": ["pdf-tools@1.0", "csv-tools@2.1"]   // REQUIRED, 2..100 refs (no nested skillsets)
}
```

Response 201 + `Location: /api/v1/skillsets/:guid`, body `{ data: <SkillsetDetail — §5a.2>, error: null }`. Member validation runs before any write — a missing/unreadable member → `skill_dependency_not_found` (404), a conflicting union closure → `dependency_conflict` (409). Duplicate name → `skillset_name_exists` (409); a reserved name → `reserved_name` (400); a missing/empty/whitespace-only `instructions`, fewer than 2 members, or a `skillset:`-prefixed ref → `400 invalid_skillset` validation error.

### 5a.2 Get skillset — `GET /api/v1/skillsets/:idOrName`

**Auth: optional.** Query `version` (optional; defaults to latest). The member-derived read gate applies (derived-visibility model note): unreadable for the caller → flat `skillset_not_found` (404), no leak of which member. Returns `{ data: SkillsetDetail, error: null }` where **SkillsetDetail** is:

```jsonc
{
  "guid": "…", "name": "review-set",
  "description": "…", "instructions": "…",       // master prompt of THIS version, verbatim
  "kind": "consensus-supported", "tags": ["review"],
  "members": ["pdf-tools@1.0", "csv-tools@2.1"],  // authored refs of this version
  "version": "1.3", "latestVersion": "1.3",
  "createdBy": "user_…", "createdByEmail": "…", "createdByDisplayName": "…",  // email/displayName optional

  // --- DERIVED visibility (#1136) — the authoritative reach signal ---
  "memberVisibilityState": "all-public",   // all-public | restricted | unresolvable
  "unreadableMembers": [],                 // populated only for owner/admin; always [] for others
  "publicMemberCount": 2,                  // SYSTEM count of public+resolvable members of THIS version

  // --- Claude Code plugin export (#1157) ---
  "exportAsPlugin": false,
  "pluginConfig": { "displayName": "…", "description": "…", "keywords": ["…"] },  // present only when overrides are set

  // --- INERT legacy ACL fields (#1136) — do NOT use for visibility decisions ---
  "isPrivate": true, "sharedWithUsers": [], "sharedWithOrgs": [], "grants": [],

  "createdOn": "2026-…", "updatedOn": "2026-…"
}
```

Judge reach from **`memberVisibilityState`**, never from `isPrivate`/`sharedWith*` (those are inert). `members.length − publicMemberCount` is how many members are currently excluded from the public / plugin view.

### 5a.3 List versions — `GET /api/v1/skillsets/:idOrName/versions`

**Auth: optional** (member-derived read gate, same as §5a.2). Returns `{ data: { items: [{ version, kind, memberCount, createdBy, createdByEmail?, createdByDisplayName?, createdOn }] }, error: null }`, newest first. Use it to compare your locally-recorded skillset revision against the latest before re-resolving `/closure`.

### 5a.4 Resolve closure — `GET /api/v1/skillsets/:idOrName/closure`

**Auth: optional.** One-call resolve: the union of all member skills **plus** each member's transitive dependency closure (§3.6a), deduplicated and topo-sorted (deps-first). Query `version` (optional). The success body carries the version's master prompt as a **root sibling** of `items`: `{ "data": { "instructions": "…", "items": [ … ] }, "error": null }` (the skill `/skills/:id/closure` body stays `{ items }`, unchanged). Each `items[]` entry is a **ClosureNode** `{ ref, name, version, depth, guid?, skillHash? }` — `ref` is the canonical `<name>@<version>`, `depth` is 0 for the set's direct members and grows with dependency distance, and `guid`/`skillHash` appear only when known (`isPrivate` is never emitted here). This is the main agent payload: run `instructions` as the master prompt and install/execute the nodes deps-first. Same error codes as §3.6a: `dependency_cycle` / `dependency_conflict` (409), `skill_dependency_not_found` (404), plus `skillset_not_found` (404) for an unknown/invisible root. A public skillset whose member transitively pins a private skill surfaces `skill_dependency_not_found` for that node to anonymous callers (no leak).

### 5a.5 Publish new version — `PUT /api/v1/skillsets/:id`

Requires `ornn:skill:update` + author/admin. JSON body `{ members, instructions, description?, kind?, tags? }` — **no `version`** (the minor revision auto-bumps; auto-revision model note). `members` + `instructions` are **REQUIRED** every publish (no carry-forward for the master prompt — each version restates its own); `description`/`kind`/`tags` may be omitted to inherit the prior version. Appends an immutable `guid@<new-minor>` and advances `latestVersion`; prior versions never mutate. The response is the new `SkillsetDetail` (§5a.2). Member/closure validation reuses the §5a.1 errors; an unknown id → `skillset_version_not_found` (404).

### 5a.6 Export as a Claude Code plugin — `PUT /api/v1/skillsets/:id/plugin-export`

Requires `ornn:skill:update` + author/admin. Turns the skillset into (or removes it from) a **Claude Code marketplace plugin** in the public mirror repo (§3.15 / §13.8). JSON body:

```jsonc
{
  "enabled": true,               // REQUIRED
  "displayName": "Review Set",   // optional listing override, ≤64 chars
  "description": "…",            // optional listing override, ≤1024 chars
  "keywords": ["review", "pdf"]  // optional, ≤20 kebab-case keywords
}
```

Enabling requires `memberVisibilityState: all-public` with **≥2 public, resolvable members** — otherwise `skillset_too_few_public_members` (409). The mirror then publishes a multi-skill plugin under `skillsets/<name>/` (`.claude-plugin/plugin.json` + `skills/<member>/…` + a README carrying the master prompt); private / unresolvable members are excluded and listed in the README. The install **name and version are not overridable** — only the three listing fields above. Response is the updated `SkillsetDetail` (`exportAsPlugin` flips, `pluginConfig` reflects the overrides). Body validation failures → `400 invalid_plugin_export`.

### 5a.7 Transfer ownership — `POST /api/v1/skillsets/:id/transfer-ownership`

Requires `ornn:skill:update` and is **ADMIN-tier** (caller must own the skillset or hold `ornn:admin:skill`). JSON body `{ "newOwnerUserId": "user_…" }` (1..128 chars). Immediate; the prior owner is retained as a READ grant. Returns `{ data: { skillset: SkillsetDetail }, error: null }`. Invalid / non-existent target → `invalid_transfer_target` (400); caller not owner/admin → `forbidden` (403); transferring to the current owner → `ownership_conflict` (409). Mirrors the skill transfer-ownership flow (#1123).

### 5a.8 Delete skillset — `DELETE /api/v1/skillsets/:id`

Requires `ornn:skill:delete` + author/admin. Cascades all versions. Returns `{ data: { success: true }, error: null }`.

### 5a.9 Search skillsets — `GET /api/v1/skillset-search`

**Auth: optional** (anon forced to `scope=public`). Query: `q` (case-insensitive substring over name + description, ≤200 chars), `kind`, `scope` (`public` | `private` | `mixed` | `shared-with-me` | `mine`, default `public`), `tags` (CSV, AND-match), `page`/`pageSize` or `cursor`/`limit`. Rate-limited 60/min. Plain keyword/filter discovery — no semantic ranking, no facets, no popularity. Discovery live-filters `restricted` skillsets to callers who can read every member. Returns `{ data: { items: [SkillsetSearchItem], total, page, pageSize, totalPages, meta: { limit, hasMore, nextCursor } }, error: null }`; each item is `{ guid, name, description, kind, tags, memberCount, latestVersion, memberVisibilityState, createdBy, createdOn, updatedOn }`. Cursor pagination per §1.10.

SDK: `client.createSkillset` / `getSkillset` / `publishSkillset` / `transferSkillsetOwnership` / `deleteSkillset` / `getSkillsetClosure` / `searchSkillsets` (TypeScript); `create_skillset` / `get_skillset` / `publish_skillset` / `transfer_skillset_ownership` / `delete_skillset` / `resolve_skillset_closure` / `search_skillsets` (Python). No SDK method targets plugin-export yet — call `PUT /skillsets/:id/plugin-export` directly.

### 5a.10 Skillset error codes

| Code | HTTP | When |
|---|---|---|
| `invalid_skillset` | 400 | Body fails create/publish validation (missing `instructions`, <2 or >100 members, bad ref grammar, `skillset:`-prefixed ref). |
| `reserved_name` | 400 | `name` is on the reserved list. |
| `invalid_plugin_export` | 400 | Plugin-export body fails validation. |
| `invalid_transfer` / `invalid_transfer_target` | 400 | Missing / unresolvable `newOwnerUserId`. |
| `forbidden` | 403 | Authenticated caller is not the owner and lacks `ornn:admin:skill`. |
| `skillset_not_found` | 404 | Unknown skillset, or the member-derived read gate hid it (a member is unreadable). |
| `skillset_version_not_found` | 404 | Named `version` (or publish target) does not exist. |
| `skill_dependency_not_found` | 404 | A member (or transitive dep) can't be resolved/read at the requested version. |
| `skillset_name_exists` | 409 | Another skillset already owns that `name`. |
| `skillset_version_exists` | 409 | Internal revision collision on publish (auto-revision guard). |
| `dependency_conflict` / `dependency_cycle` | 409 | The union closure is conflicting or cyclic. |
| `skillset_too_few_public_members` | 409 | Plugin-export enabled with fewer than 2 public, resolvable members. |
| `ownership_conflict` | 409 | Transfer target is already the owner. |

---

## 6. Skill format

Three endpoints — the canonical format spec, a pre-flight validator, and a public JSON Schema for editors.

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

### 6.3 Manifest JSON Schema — `GET /api/v1/skill-manifest-schema.json`

Public JSON Schema (draft 2020-12) for the `SKILL.md` frontmatter, derived from the canonical Zod schema (#464). **Auth: none.** Unlike every other JSON endpoint it returns the **raw schema object, NOT the `{ data, error }` envelope** — editors / IDEs consume it directly as a `$schema` target. No error path (static, computed once at module load).

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

## 8a. Assistant (SSE, #970)

A repo-aware Q&A assistant — a **single non-agentic completion** (no tools, no sandbox loop) grounded server-side on the Ornn docs KB. Distinct from the Playground (§8): it never executes anything.

### 8a.1 Chat — `POST /api/v1/assistant/chat`

**Auth: required** (any authenticated NyxID user; **no scalar scope**). Rate-limited **30/min per user**; **charges the `assistant` monthly quota** (reserved before the LLM call — see §11 `/me/quota`). Request body:

```jsonc
{
  "messages": [                                   // REQUIRED, 1..100 items
    { "role": "user", "content": "How do dist-tags work?" }  // role: user|assistant; content ≤32000 chars
  ],
  "modelId": "…"                                  // optional; defaults to the assistant-surface default
}
```

Response: SSE stream (§1.9). Four event types: `chat_start` `{ model }`, `chat_text_delta` `{ delta }` (incremental answer text), `chat_finish` `{ usage? }`, and `chat_error` `{ code, message }` (terminal). Retrieval grounding is applied server-side and is **not** surfaced as a separate event. Pre-stream failures are clean RFC 7807 JSON, never a broken stream: `429 rate_limited` (Retry-After), `400 VALIDATION_ERROR`, `429 quota_exceeded`, `400 MODEL_NOT_ENABLED` / `MODEL_UNAVAILABLE`. Quota is charged on completion. Pick a model with `GET /api/v1/me/models?surface=assistant` (§11).

---

## 9. Notifications

Four endpoints. All require auth. All scoped to the caller — no cross-user reads.

After [#500](https://github.com/ChronoAIProject/Ornn/pull/500) the feed is a **discriminated union** of per-user notifications and admin-authored broadcasts. Each item carries a `source` field — `"user"` for the audit-pipeline notifications below, `"broadcast"` for platform-wide markdown notices. The two variants share `_id`, `readAt`, `createdAt`; everything else is variant-specific. `unread-count` and `mark-all-read` cover both sources in one shot. `POST /:id/read` accepts either kind of id and routes by lookup.

Per-user (`source: "user"`) categories emitted today; both come from the audit pipeline:

| Category | Sent to | Trigger |
|---|---|---|
| `audit.completed` | The skill **owner** | Every audit completion. Body distinguishes `green` from `yellow`/`red` and links to the audit history page. |
| `audit.risky_for_consumer` | Every consumer of a `yellow`/`red`-verdict skill — every user in `sharedWithUsers`, plus the membership of every org in `sharedWithOrgs` (resolved via NyxID at fan-out time) | Same audit completion. Skipped for `green`. |

There are no other per-user categories; share / waiver / review notifications were removed when the audit-gated share workflow was retired.

Broadcasts (`source: "broadcast"`) are bilingual platform-wide notices authored via `POST /admin/broadcasts` (admin-only). They have no `category` — every row in this lane is treated as informational.

### 9.1 List notifications — `GET /api/v1/notifications`

**Auth: required.**

| Query param | Type | Notes |
|---|---|---|
| `unread` | `"true"` | Optional. Restrict to unread items (across both sources). |
| `limit` | int 1–200 | Default 50. Caps the merged feed length. |

Response 200 — the `items` array is a discriminated union on `source`:

```jsonc
{
  "data": {
    "items": [
      {
        "_id": "ntf_...",
        "source": "user",
        "userId": "user_...",
        "category": "audit.risky_for_consumer",
        "title": "Audit found risk in 'csv-tools' (yellow)",
        "body": "...",
        "link": "/skills/csv-tools/audits?version=1.3",
        "data": { "skillGuid": "skl_...", "version": "1.3", "verdict": "yellow" },
        "readAt": null,
        "createdAt": "2026-04-28T..."
      },
      {
        "_id": "bc_...",
        "source": "broadcast",
        "titleI18n":        { "en": "Scheduled maintenance",  "zh": "计划维护" },
        "bodyMarkdownI18n": { "en": "We will be down at...",  "zh": "我们将在..." },
        "readAt": null,
        "createdAt": "2026-04-29T..."
      }
    ]
  },
  "error": null
}
```

Switch on `source` before reading variant-specific fields. `body` / `link` / `data` exist only on `source: "user"`; `titleI18n` / `bodyMarkdownI18n` exist only on `source: "broadcast"`.

### 9.2 Unread count — `GET /api/v1/notifications/unread-count`

**Auth: required.** Cheap to poll for badge counts.

Response 200:

```jsonc
{ "data": { "count": 7 }, "error": null }
```

### 9.3 Mark one read — `POST /api/v1/notifications/:id/read`

**Auth: required.** Sets `readAt` to `now()`. The handler routes by id-lookup: a `:id` that matches a per-user notification updates that row; one that matches a broadcast inserts (or updates) a read-receipt for the caller. Unknown ids surface `NOTIFICATION_NOT_FOUND`.

Path param: `:id`. Body: ignored (send `{}`).

Response 200:

```jsonc
{ "data": <updated record — per-user notification doc OR broadcast read-receipt doc>, "error": null }
```

| Code | Status | Cause |
|---|---|---|
| `AUTH_MISSING` | 401 | Standard. |
| `NOTIFICATION_NOT_FOUND` | 404 | The id is neither a per-user notification belonging to the caller nor a broadcast the caller can see. |

### 9.4 Mark all read — `POST /api/v1/notifications/mark-all-read`

**Auth: required.** Marks every unread per-user notification belonging to the caller as read AND inserts read receipts for every currently-unread broadcast in one shot.

Body: ignored.

Response 200:

```jsonc
{ "data": { "updated": 12 }, "error": null }
```

`updated` is the total count across both sources.

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

Twelve endpoints. All require auth and are scoped to the caller — there is no "read another user's …" surface here.

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

### 11.9 Monthly quota — `GET /api/v1/me/quota`

**Auth: required.** Caller-scoped snapshot of the metered surfaces (`playground`, `skillGen`). Read before any SSE call so you can short-circuit on `remaining: 0` instead of burning the request to a 429.

Response 200:

```jsonc
{
  "data": {
    "isAdmin": false,
    "monthMarker":           "2026-05",
    "monthStart":            "2026-05-01T00:00:00Z",
    "monthEnd":              "2026-06-01T00:00:00Z",
    "nextMonthlyResetAt":    "2026-06-01T00:00:00Z",
    "playground": {
      "defaultAllotment": 50,
      "adminGrant":       10,
      "used":             37,
      "remaining":        23,
      "warningThreshold": 0.8,
      "warning":          false
    },
    "skillGen": {
      "defaultAllotment": 20,
      "adminGrant":       0,
      "used":             20,
      "remaining":        0,
      "warningThreshold": 0.8,
      "warning":          true
    }
  },
  "error": null
}
```

Field semantics:

- `isAdmin: true` — caller has admin bypass; every charge is free. The per-surface counters are still populated (for visibility) but never block.
- `defaultAllotment` — platform-wide monthly base for the surface (set in `/admin/settings/quota`).
- `adminGrant` — additive top-up granted to this user (via `/admin/quota/grant` or by redeeming a code).
- `remaining = defaultAllotment + adminGrant − used`, clamped to ≥ 0. A successful chargeable call decrements `remaining` on completion.
- `warning: true` when `used / (defaultAllotment + adminGrant) ≥ warningThreshold`. UI surfaces a soft chip; agents can treat it as "consider stopping".
- Buckets reset at `nextMonthlyResetAt` (first day of next UTC month). Unused balance does not roll over.

No error codes beyond the standard `AUTH_MISSING`.

### 11.10 Model picker — `GET /api/v1/me/models`

**Auth: required.** List the LLM models the deployment has enabled for one of the SSE surfaces, sorted with that surface's default first.

| Query param | Values | Notes |
|---|---|---|
| `surface` | `playground` \| `skillGen` | **Required.** Mismatched values → `INVALID_SURFACE`. |

Response 200:

```jsonc
{
  "data": {
    "items": [
      { "modelId": "claude-3-5-sonnet-latest", "displayName": "Claude 3.5 Sonnet", "isDefault": true  },
      { "modelId": "gpt-4o",                   "displayName": "GPT-4o",            "isDefault": false }
    ],
    "defaultModelId": "claude-3-5-sonnet-latest"
  },
  "error": null
}
```

`items[].modelId` is what you pass as `modelId` to `POST /skills/generate*` or `POST /playground/chat`. Empty list means the admin has not enabled any model for this surface — SSE calls will pre-stream `MODEL_UNAVAILABLE`. `defaultModelId` mirrors the `isDefault: true` row; absent when the list is empty.

| Code | Status | Cause |
|---|---|---|
| `INVALID_SURFACE` | 400 | Query param missing or not in the enum. |
| `AUTH_MISSING` | 401 | Standard. |

### 11.11 Redeem a code — `POST /api/v1/me/redemption-codes/redeem`

**Auth: required.** Consume a one-time redemption code; lands additive grants on the caller's quota buckets for the current month.

Request body (`application/json`):

```jsonc
{ "code": "ORNN-XXXX-YYYY-ZZZZ" }
```

Schema: `z.object({ code: z.string().min(1).max(128) })`.

Response 200:

```jsonc
{
  "data": {
    "codeId":     "rdm_...",
    "redeemedAt": "2026-05-14T12:00:00Z",
    "grants": [
      { "surface": "playground", "amount": 50, "monthMarker": "2026-05", "newAdminGrant": 60 },
      { "surface": "skillGen",   "amount": 10, "monthMarker": "2026-05", "newAdminGrant": 10 }
    ]
  },
  "error": null
}
```

`newAdminGrant` is the post-redeem total for that surface, useful for echoing to the user. Codes are single-use across all users; consuming one invalidates it everywhere.

| Code | Status | Cause |
|---|---|---|
| `INVALID_REDEEM_BODY` | 400 | Body failed Zod validation. |
| `REDEMPTION_CODE_NOT_FOUND` | 404 | Code string doesn't exist. |
| `REDEMPTION_CODE_EXPIRED` | 410 | Past `expiresAt`. |
| `REDEMPTION_CODE_INVALIDATED` | 410 | Admin revoked the code. |
| `REDEMPTION_CODE_ALREADY_REDEEMED` | 409 | Already consumed (codes are single-use). |
| `AUTH_MISSING` | 401 | Standard. |

### 11.12 Redemption history — `GET /api/v1/me/redemption-codes/history`

**Auth: required.** Caller's own redemption log, newest first.

| Query param | Values | Default |
|---|---|---|
| `page` | int ≥ 1 | 1 |
| `pageSize` | int 1–100 | 20 |

Response 200:

```jsonc
{
  "data": {
    "items": [
      {
        "id": "rdm_...",
        "code": "ORNN-XXXX-YYYY-ZZZZ",
        "grants": [{ "surface": "playground", "amount": 50 }],
        "note": null,
        "redeemedAt": "2026-05-14T12:00:00Z",
        "expiresAt":  "2026-06-30T23:59:59Z",
        "createdAt":  "2026-05-01T00:00:00Z"
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "error": null
}
```

### 11.13 Launch-promo status — `GET /api/v1/me/launch-promo`

Your launch-promo claim status (#724). **Auth: required** (caller-scoped; no scope). Response `{ data: { promoEnabled, claimed, rank, totalSlots, slotsRemaining, awardedAt }, error: null }` — `rank` is your 1-based Ornn registration rank (or `null`), `awardedAt` is set once claimed. Admin award + observability is §13.11.

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

All endpoints under `/api/v1/admin/*`. All require auth. Most agents never call these — they back the platform-admin UI. This section gives the path + permission + intent so an agent invoked as a "platform-admin assistant" knows where to look; full request/response shapes live in `GET /api/v1/openapi.json`.

The legacy `GET /admin/stats` and `GET /admin/activities` endpoints were removed in [#271](https://github.com/ChronoAIProject/Ornn/pull/271) — admin totals moved to §13.1 below, and activity feeds live in PostHog now (the admin UI deep-links into the PostHog dashboard). The legacy `/admin/categories/*` and `/admin/tags/*` CRUD also no longer exist — tags now flow through `metadata.tag` on the skill frontmatter and are exposed read-only via `/skill-facets/tags` (§5.2); the `category` concept collapsed into a free-form `metadata.category` string.

### 13.1 Dashboard tiles — `GET /api/v1/admin/dashboard/stats`

**Auth: required. Permission: `ornn:admin:skill`.**

User + skill totals for the admin dashboard.

```jsonc
{
  "data": {
    "users":  { "total": 124, "admin": 3,  "normal": 121 },
    "skills": { "total": 412, "system": 8, "public": 263, "private": 141 }
  },
  "error": null
}
```

Skill partition is disjoint (`total = system + public + private`): `system` = `isSystemSkill: true`; `public` = `isPrivate: false ∧ isSystemSkill !== true`; `private` = `isPrivate: true`.

### 13.2 User directory — `GET /api/v1/admin/users`

**Auth: required. Permission: `ornn:admin:skill`.**

| Query param | Notes |
|---|---|
| `page` | int ≥ 1, default 1 |
| `pageSize` | int 1–100, default 20 |

Response: `{ data: { items: [{ userId, email, displayName, lastActiveAt, activityCount, skillCount }], total, page, pageSize, totalPages }, error: null }`.

### 13.3 Skill admin browse + delete

Cross-user browse with no visibility filtering, plus force-delete bypassing the author check.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/admin/skills` | `ornn:admin:skill` | Query: `page`, `pageSize`, `q` (name+description substring), `userId`. Returns the same `SkillSummary` shape `/skill-search` does. |
| `DELETE` | `/admin/skills/:id` | `ornn:admin:skill` | Same effect as `DELETE /skills/:id` (§3.11). Returns `{ data: { success: true }, error: null }`. |

### 13.4 Force-audit — `POST /api/v1/admin/skills/:idOrName/audit`

Cross-ref §4.5.

### 13.5 AgentSeal rescan — `POST /api/v1/admin/skills/:idOrName/versions/:version/agentseal-rescan`

**Auth: required. Permission: `ornn:admin:skill`.**

Re-runs the AgentSeal scanner against a specific version's package and refreshes the cached verdict on that version. Body: ignored. Returns the refreshed scan record.

### 13.6 Quota administration

All under `/admin/quota/*`. **Auth: required. Permission: `ornn:admin:skill`.**

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/admin/quota/users?surface=playground\|skillGen&page=...&pageSize=...` | — | Per-user quota tiles for the requested surface. |
| `GET` | `/admin/quota/users/:userId/lifetime?surface=...` | — | Lifetime grant audit + usage for one user, one surface. |
| `GET` | `/admin/quota/grants?page=...&pageSize=...` | — | Paginated grant audit log across all users. |
| `POST` | `/admin/quota/grant` | `{ userId, surface, amount, note? }` | Additive grant onto current-month bucket. |
| `POST` | `/admin/quota/grant/bulk` | `{ userIds: [], surface, amount, note? }` | Same, multi-user. |

### 13.7 Redemption codes

All under `/admin/redemption-codes/*`. **Auth: required. Permission: `ornn:admin:skill`.** Caller-side `redeem` and `history` live at `/me/redemption-codes/*` (§11.11, §11.12).

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/admin/redemption-codes?page=...&pageSize=...` | — | Paginated admin list. |
| `POST` | `/admin/redemption-codes` | `{ code?, grants: [{ surface, amount }], expiresAt, note? }` | Create. `code` auto-generated when omitted. Returns 201. |
| `DELETE` | `/admin/redemption-codes/:id` | — | Hard delete (unredeemed only). |
| `POST` | `/admin/redemption-codes/:id/invalidate` | — | Soft-revoke. Future `/me/redemption-codes/redeem` calls return `REDEMPTION_CODE_INVALIDATED`. |

### 13.8 Mirror admin

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/admin/mirror/reconcile` | `ornn:admin:skill` | Fire-and-forget reconcile run. **202** with `{ data: { status: "running", startedAt }, error: null }` on accept. Refusals: `503 MIRROR_DISABLED` (kill-switch off or required GitHub App creds missing), `409 RECONCILE_ALREADY_RUNNING` (another reconcile is in progress on this pod). |
| `GET` | `/admin/mirror/status` | `ornn:admin:skill` | Counts + last-run summary. Response combines DB-side mirror counts, the persisted scheduled-run status (cluster-wide), and the current `mirror` settings section (App private key mid-masked) so the admin UI can render without a second round-trip. |

The mirror **config** (repo, branch, GitHub App id, encrypted private key, enabled flag, cadence) lives under the sectioned platform settings (§14.2, `mirror`). The two endpoints above only operate the scheduler. Manual `reconcile` runs are tracked in pod-local state and do not update `scheduledRun` in the status response.

There is also a **direct mirror-config pair** outside `/admin/settings`: `GET /api/v1/github/repo` (public coordinates — §2.4) and `POST /api/v1/github/repo` (**`ornn:admin:skill`**), which patches the full mirror config — the `enabled` kill-switch, `owner` / `repo` / `branch`, and the GitHub App `appId` / `installationId` / `appPrivateKey`. Accepts any subset (omitted fields are preserved); the response mid-masks secrets, never plaintext. Changing `owner` / `repo` while skills are still stamped to the old repo is rejected unless `confirmAbandonOldRepo: true` — a guard against orphaning the existing mirror. Errors: `400 invalid_body` / `invalid_setting`.

### 13.9 Announcements

Public anonymous reads + admin CRUD. Bilingual EN + ZH content; ZH falls back to EN at render time when empty.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/announcements` | anon | Listed published announcements (News page). |
| `GET` | `/announcements/active` | anon | Currently active row(s) for the landing-page popup. |
| `GET` | `/admin/announcements` | `ornn:admin:skill` | Admin browse — every row including disabled / future. |
| `POST` | `/admin/announcements` | `ornn:admin:skill` | Create. Body: `{ titleEn, titleZh?, bodyMarkdownEn, bodyMarkdownZh?, ctaLabelEn?, ctaLabelZh?, ctaUrl?, enabled, startsAt?, endsAt? }`. Returns 201. |
| `PATCH` | `/admin/announcements/:id` | `ornn:admin:skill` | Partial update. |
| `DELETE` | `/admin/announcements/:id` | `ornn:admin:skill` | Hard delete. |

CTA pairing rule: `ctaUrl` and `ctaLabelEn` must both be set or both null (validated server-side as `INVALID_ANNOUNCEMENT_INPUT`). `ctaLabelZh` is independently optional.

### 13.10 Broadcasts

Admin-authored notifications that fan out into every user's `/notifications` feed (§9) as `source: "broadcast"` rows.

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/admin/broadcasts` | `ornn:admin:skill` | List all broadcasts. |
| `POST` | `/admin/broadcasts` | `ornn:admin:skill` | Create. Body carries bilingual `titleI18n` / `bodyMarkdownI18n`. Returns 201. |
| `PATCH` | `/admin/broadcasts/:id` | `ornn:admin:skill` | Partial update. |
| `DELETE` | `/admin/broadcasts/:id` | `ornn:admin:skill` | Hard delete (read receipts cascade). |

### 13.11 Launch promo (#724)

Admin operation of the launch-promo reward program (the caller-facing status read is §11.13).

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/admin/launch-promo/award/:userId` | `ornn:admin:skill` | Manually award the promo — mints a redemption code (playground / skillGen grants per config). No body; `awardedBy` = caller. Idempotent per user. Errors: `PROMO_DISABLED` (400, also when zero grants configured), `ALREADY_CLAIMED` (409), `RANK_EXCEEDED` (403), `SLOTS_EXHAUSTED` (409). |
| `GET` | `/admin/launch-promo/recent` | `ornn:admin:skill` | Recent claims for observability. Query `limit` (default 50, clamped 1..500). Returns `{ items: [{ userId, eligibilityRank, redemptionCodeId, awardedAt, awardedBy, githubLogin }] }`. |

---

## 14. Platform settings

The platform-admin configuration lives in four parallel route groups under `/api/v1/admin/settings/*`. **Every endpoint here requires `ornn:admin:skill`** (the LLM-provider routes too). Agents rarely call these; they back the Settings tab of the admin UI.

### 14.1 Legacy single-document settings — `GET / PATCH /api/v1/admin/settings`

Mostly historical. The only remaining live field is `auditWaiverThreshold` (0–10 number; informational only — kept on the document because earlier designs surfaced a "low risk → auto-share" UI hint that the current sharing path does not consume).

`PATCH` body accepts a partial update; out-of-range values surface `INVALID_SETTING` (400). All real configuration lands in the sectioned routes below — not here.

### 14.2 Sectioned settings — `GET / PUT /api/v1/admin/settings/{section}`

Each section is its own row in the `platform_settings` collection. Reads mid-mask secret fields; writes accept plaintext, redaction sentinels, or mid-mask sentinels for those same fields (the service resolves "preserve DB" sentinels).

| `{section}` (URL path) | Covers |
|---|---|
| `playground` | Playground SSE knobs (per-call budgets, sandbox image, etc.) |
| `skill-generation` | Skill-generation SSE knobs (max output tokens, validation retries, etc.) |
| `mirror` | GitHub mirror — repo, branch, App ID, installation id, encrypted private key, enabled flag, reconcile cadence |
| `integrations/nyxid` | NyxID proxy + service ids the backend talks to |
| `skill-audit` | Audit pipeline — risk threshold, LLM choice, cache TTL |
| `posthog` | PostHog telemetry — host, project key, ingestion toggles |
| `extras` | Catch-all for one-off feature flags |

Response shape on read: `{ data: <sectionPayload>, error: null }`. On write: `{ data: <sectionPayload>, error: null, meta: { changedFields: [...] } }` — no-op writes still 200 with an empty `changedFields`.

| Code | Status | Cause |
|---|---|---|
| `INVALID_BODY` | 400 | Body not a JSON object. |
| `VALIDATION_ERROR` | 400 | Body failed the section's Zod schema. |
| `SECTION_NOT_FOUND` | 404 | Unknown `{section}` path. |

### 14.3 LLM providers — `/admin/settings/llm-providers[/:id]`

Multi-provider model catalog. Each provider row carries credentials + per-model toggles for the three SSE surfaces (`playground`, `skillGen`, `assistant`).

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/admin/settings/llm-providers` | — | List all providers. Secrets mid-masked. |
| `POST` | `/admin/settings/llm-providers` | `{ name, gatewayUrl, auth, maxOutputTokens, defaultTemperature, ... }` | Create. Returns 201. |
| `GET` | `/admin/settings/llm-providers/:id` | — | Read one. |
| `PUT` | `/admin/settings/llm-providers/:id` | partial | Update. Accepts plaintext or mid-mask sentinel for secret fields. |
| `DELETE` | `/admin/settings/llm-providers/:id` | — | Hard delete + cascade through model catalog. |
| `POST` | `/admin/settings/llm-providers/:id/sync` | — | Re-pull model list from the provider gateway. Response `{ data: { synced: int }, error: null }`. |
| `PATCH` | `/admin/settings/llm-providers/:id/models/:modelId` | `{ enabledForPlayground?, enabledForSkillGen?, enabledForAssistant?, defaultForPlayground?, defaultForSkillGen?, defaultForAssistant? }` | Per-model surface flags (#270; assistant surface #970). ≥1 flag required. `defaultForX: true` forces `enabledForX: true` and clears that default on every other model atomically. Errors: `MODEL_NOT_FOUND` (404), `MODEL_REMOVED` (400 — re-sync first). |

The picker `GET /me/models` (§11.10) reads through this catalog.

### 14.4 Export / import — `/admin/settings/export` and `/admin/settings/import`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/settings/export` | Returns full settings + LLM-provider snapshot as JSON. Secrets are redacted. |
| `POST` | `/admin/settings/import` | Body: a prior export JSON. Replays into `platform_settings` + `llm_providers`. Diff is reported in `meta.changedFields`. |

---

## Appendix — staying in sync with this file

When the API surface changes, the change lands in `ornn-api/src/domains/**/routes.ts` first. This file should be updated in the same PR. The `version:` field in the parent `SKILL.md` is bumped on every doc-affecting change; agents pulling the skill will see the bump on `GET /api/v1/skills/ornn-agent-manual-cli/json` and can refresh their context (see SKILL.md §0). There is no out-of-band changelog — `git log skills/ornn-agent-manual-cli/` is the changelog.
