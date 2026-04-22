# ornn API & Architecture Conventions

The contract every `/api/v1/*` endpoint and every `ornn-api` module must follow. All future endpoints and modules MUST conform. Changes that violate a convention are blocked at review.

This document is normative. It is the authoritative source for decisions that would otherwise be re-litigated per PR. When in doubt, this file wins.

---

## Table of Contents

1. [Response & error format](#1-response--error-format)
2. [URL structure](#2-url-structure)
3. [HTTP semantics](#3-http-semantics)
4. [Query parameters](#4-query-parameters)
5. [Authentication & authorization](#5-authentication--authorization)
6. [SSE streaming](#6-sse-streaming)
7. [Deprecation](#7-deprecation)
8. [Caching](#8-caching)
9. [Observability headers](#9-observability-headers)
10. [OpenAPI](#10-openapi)
11. [Architecture conventions](#11-architecture-conventions)
12. [Every new `/v1/` endpoint checklist](#12-every-new-v1-endpoint-checklist)

---

## 1. Response & error format

### 1.1 Success — single resource

Return the resource directly. No envelope.

```http
GET /v1/skills/abc
200 OK
Content-Type: application/json

{
  "id": "abc",
  "name": "pdf-extract",
  "createdOn": "2026-04-22T10:00:00Z",
  ...
}
```

### 1.2 Success — collection

Wrap in `{ items, meta }`:

```http
GET /v1/skills?q=pdf&limit=20
200 OK
Content-Type: application/json

{
  "items": [ { "id": "abc", ... }, { "id": "def", ... } ],
  "meta": { "nextCursor": "eyJpZCI6...", "hasMore": true, "limit": 20 }
}
```

`meta` MUST contain `limit` and `hasMore`. When `hasMore === true`, `nextCursor` MUST be a non-empty opaque string. When `hasMore === false`, `nextCursor` MAY be omitted. Endpoint-specific metadata (e.g. `searchMode`) lives alongside pagination fields in `meta`.

### 1.3 Errors — RFC 7807 `application/problem+json`

```http
POST /v1/skills/abc/permissions
400 Bad Request
Content-Type: application/problem+json
X-Request-ID: req_01HXYZ...

{
  "type": "https://github.com/aevatarAI/chrono-ornn/blob/main/docs/errors.md#validation_error",
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

Required fields: `type`, `title`, `status`, `instance`, `requestId`.
Optional: `detail`, `errors[]`.

### 1.4 Error code catalog (lowercase snake_case)

| Code | HTTP | Meaning |
|---|---|---|
| `validation_error` | 400 | Body / query / path param validation failed — details in `errors[]` |
| `unsupported_media_type` | 415 | Request `Content-Type` not accepted |
| `payload_too_large` | 413 | Upload exceeds max size |
| `authentication_required` | 401 | No valid identity |
| `permission_denied` | 403 | Authenticated but lacks required permission |
| `resource_not_found` | 404 | Target resource does not exist or not visible to caller |
| `resource_conflict` | 409 | State conflict (duplicate, concurrent modification, etc.) |
| `rate_limited` | 429 | Caller exceeded rate limit |
| `upstream_unavailable` | 502 / 503 | Dependency (NyxID, LLM, sandbox, ...) failed |
| `internal_error` | 500 | Unhandled server error |

New codes require convention-doc update. Handlers MUST NOT invent ad-hoc codes.

### 1.5 `X-Request-ID`

- Generated server-side on every request (or echoed if the client provided one).
- Returned as `X-Request-ID` header on **every** response (2xx, 4xx, 5xx).
- Also embedded as `requestId` in every error body.
- Logged with every request/response pair on the server.

### 1.6 Error `type` URLs

Point to GitHub markdown anchors in this repository:

```
https://github.com/aevatarAI/chrono-ornn/blob/main/docs/errors.md#<code>
```

A matching `docs/errors.md` must exist with `##` headings per error code (GitHub auto-generates anchors). Zero infra cost; resolves day one. Future migration to a docs domain (`docs.ornn.xyz`) is a one-time redirect configuration; no client changes required.

---

## 2. URL structure

### 2.1 Versioning

All endpoints live under `/api/v1/`. Breaking changes ship under `/api/v2/`. Additive changes ship under `v1`.

### 2.2 Resource paths

- Plural resource nouns: `/skills`, `/categories`, `/tags`, `/users`, `/activities`.
- Canonical URL uses the stable ID (GUID). **No polymorphic `:idOrName` on write operations.**
- Name→ID resolution via `GET /v1/{resource}/lookup?name=<name>` (returns `{ id }`).
- Caller-scoped resources under `/v1/me/*`.

### 2.3 Non-CRUD actions — sub-resource

Custom actions as sub-resource paths:

```
POST /v1/skills/generate
POST /v1/skills/generate/from-openapi
POST /v1/skills/validate
POST /v1/skills/search
POST /v1/playground/chat
```

Router config MUST declare static action segments with priority over `:id` params (Hono / Express / Rails default behavior). Skill / category names that collide with reserved action verbs are rejected at create time.

Reserved action verbs per resource documented in `ornn-api/src/shared/reservedVerbs.ts`.

### 2.4 Search — dual-track

- `GET /v1/{resource}?q=...&<filters>` — simple keyword filter over URL params (cacheable, bookmarkable).
- `POST /v1/{resource}/search` — complex queries with structured body (semantic mode, long queries, compound filters).

Both return the same collection shape (`{ items, meta }`).

---

## 3. HTTP semantics

### 3.1 Methods

| Method | Semantics |
|---|---|
| `GET` | Safe, idempotent read |
| `POST` | Create, or custom action |
| `PUT` | Full replace of a resource (idempotent) |
| `PATCH` | Partial update |
| `DELETE` | Remove (idempotent) |

Partial updates MUST use `PATCH`. `PUT` MUST accept a complete representation.

### 3.2 Status codes

| Code | Use |
|---|---|
| `200 OK` | Successful read / update returning a body |
| `201 Created` | Successful create. MUST include `Location: /v1/{resource}/{id}` header |
| `202 Accepted` | Async job accepted (not currently used) |
| `204 No Content` | Successful delete, or update with no body to return |
| `400` | `validation_error` |
| `401` | `authentication_required` |
| `403` | `permission_denied` |
| `404` | `resource_not_found` |
| `409` | `resource_conflict` |
| `413` | `payload_too_large` |
| `415` | `unsupported_media_type` |
| `429` | `rate_limited` |
| `500` | `internal_error` |
| `502` / `503` | `upstream_unavailable` |

### 3.3 Content negotiation

When a resource has multiple representations, select via `Accept`:

```
GET /v1/skills/abc
Accept: application/json           → JSON metadata + file contents
Accept: application/zip            → raw ZIP package
```

Do not encode representation in the URL path (no `/skills/:id/json`).

### 3.4 Idempotency

`POST` creates accept optional `Idempotency-Key: <uuid>` header. Server persists the key + response for 24h and returns the cached response on retry. Implementation: middleware layer in `ornn-api/src/middleware/idempotency.ts`.

### 3.5 Bulk operations

Bulk-capable endpoints are symmetric:

```
POST   /v1/{parent}/{id}/{child}  { <child>Ids: [...] }   # add
DELETE /v1/{parent}/{id}/{child}  { <child>Ids: [...] }   # remove (body)
```

Single-item convenience endpoints MAY exist alongside.

---

## 4. Query parameters

### 4.1 Naming

- `camelCase` everywhere (matches JSON body convention).
- Search query param is `q` (never `query`).
- Booleans are `true` / `false` — omit for "any".

### 4.2 Arrays — repeated keys

```
?sharedWithOrgs=a&sharedWithOrgs=b&sharedWithOrgs=c
```

Never CSV. Never bracket notation. Handler: `c.req.queries('sharedWithOrgs')` returns `string[]`.

### 4.3 Pagination — cursor-only

```
?cursor=<opaque>&limit=<1-100>
```

- `cursor` is opaque (base64-encoded server-chosen payload). Clients MUST NOT parse.
- `limit` defaults per-endpoint (typically 20), max 100.
- Absence of `cursor` = first page.
- Response `meta.nextCursor` feeds the next request.
- **Total counts** are NOT part of pagination. Endpoints needing a count expose a sibling (e.g. `GET /v1/skills/counts`) or fold the count into list `meta`.

### 4.4 Filters

Endpoint-specific. Rules:

- Orthogonal filters are separate params. Do NOT overload (avoid `scope=shared-with-me|mine|...`).
- Booleans instead of tri-state enums when possible.
- For `/v1/skills`:
  - `visibility` — `public | private` (omit for "any" within caller's reach)
  - `owner` — `me | others` (omit for "any")
  - `sharedWith` — `me` (filters to skills shared with caller)
  - `isSystem` — boolean (omit for "any")

---

## 5. Authentication & authorization

### 5.1 Transport

- `Authorization: Bearer <jwt>` between client and the NyxID proxy.
- `X-NyxID-Identity-Token` and `X-NyxID-*` headers between proxy and `ornn-api` (internal).
- OpenAPI declares one `bearerAuth` scheme; `X-NyxID-*` is not part of the public contract.

### 5.2 Permission strings

Format: `ornn:<resource>:<action>`.

Actions: `read`, `write`, `admin`, plus resource-specific high-cost actions when needed.

| Permission | Grants |
|---|---|
| `ornn:skill:read` | Read skills (respects visibility) |
| `ornn:skill:write` | Create, update, delete own skills |
| `ornn:skill:admin` | Manage any skill (override ownership); delete any skill |
| `ornn:skill:generate` | Invoke skill generation endpoints (high LLM cost) |
| `ornn:skill:execute` | Invoke playground chat (runs user code) |
| `ornn:category:read` | List categories |
| `ornn:category:admin` | Manage categories |
| `ornn:tag:read` | List tags |
| `ornn:tag:admin` | Manage tags |
| `ornn:user:admin` | User dashboard (list users, aggregate stats per user) |
| `ornn:activity:read` | Platform activity log read access |
| `ornn:stats:read` | Platform-wide dashboard aggregates |

NyxID composes a **"Platform Admin"** role that grants all `*:admin` + `*:read` permissions above; current platform admins inherit this role with zero UX change. Sub-admin roles (content moderator, tag curator, support) can be composed from subsets when needed.

Adding a new permission requires convention-doc update. NyxID role → permission mapping is owned by NyxID config; this doc is the permission catalog.

### 5.3 Scope declaration

Every route in OpenAPI tagged with its required scopes. Public endpoints explicitly declare `security: []`.

---

## 6. SSE streaming

### 6.1 Event naming

Format: `<resource>_<event>`, snake_case.

Shared event vocabulary across endpoints:

| Suffix | Meaning |
|---|---|
| `_start` | Stream opened |
| `_text_delta` | Incremental text content |
| `_tool_call` | Model requests tool invocation |
| `_tool_result` | Tool output |
| `_file_output` | File produced during run |
| `_validation_error` | Recoverable validation failure |
| `_error` | Terminal error |
| `_complete` / `_finish` | Stream ended normally |

Endpoints pick a subset and MAY add endpoint-specific events with the same prefix.

### 6.2 Current endpoint mapping

| Endpoint | Events |
|---|---|
| `POST /v1/skills/generate` | `generation_start`, `generation_delta`, `generation_validation_error`, `generation_error`, `generation_complete` |
| `POST /v1/playground/chat` | `chat_start`, `chat_text_delta`, `chat_tool_call`, `chat_tool_result`, `chat_file_output`, `chat_error`, `chat_finish` |

### 6.3 Transport rules

- `Content-Type: text/event-stream`
- Each event has a `type` field in the JSON payload plus SSE-native `event:` line set to the same value
- Keep-alive events every `config.sseKeepAliveIntervalMs` milliseconds (JSON `{ type: "keepalive" }`)
- Clients abort via `AbortSignal` / closing the connection
- `Last-Event-ID` reconnection: **not supported** in v1; clients start over on reconnect

---

## 7. Deprecation

Per RFC 8594 on deprecated endpoints and representations:

```
Deprecation: true
Sunset: Wed, 01 Jan 2027 00:00:00 GMT
Link: <https://github.com/aevatarAI/chrono-ornn/blob/main/docs/deprecations.md#skill-version-v1>; rel="deprecation"
```

Free-form notes go in response body, not custom headers. No `X-Skill-Deprecated` style custom headers.

---

## 8. Caching

- `GET` endpoints returning immutable or slowly-changing data set `ETag` + `Cache-Control`.
- Docs endpoints, `GET /v1/openapi.json`, `GET /v1/skills/format` are public and cacheable.
- Authenticated reads use `Cache-Control: private, max-age=<short>` where appropriate.

---

## 9. Observability headers

Every response carries:

- `X-Request-ID` (§ 1.5)
- Future: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## 10. OpenAPI

- `GET /v1/openapi.json` is the source of truth.
- Every route declares security, request content types, all documented error responses, and at least one example.
- CI contract test asserts every handler in code appears in the spec with complete metadata.
- Error `type` URLs point to live documentation per § 1.6.

---

## 11. Architecture conventions

### 11.1 Error model

Single `AppError` class in `ornn-api/src/shared/errors/`. No inlined or per-module copies. Global error handler is a single mapping from `AppError` → `application/problem+json`.

### 11.2 Config loading

Zod schema, not imperative `requiredEnv()` / `Number()` casts. A malformed env var (`MAX_PACKAGE_SIZE_BYTES=abc`) must fail-fast with a typed error, not silently produce `NaN`.

Library code MUST NOT call `process.exit()`. Throw a typed error; let the entry point decide.

### 11.3 Middleware order

All global middleware declared in this order:

1. CORS (with env-driven `ALLOWED_ORIGINS`, not `(origin) => origin`)
2. `requestId` — generate/echo `X-Request-ID`, attach to pino child logger
3. logging — structured with requestId
4. `proxyAuthSetup()` — parse NyxID proxy headers
5. `nyxidOrgLookupMiddleware()` — lazy, per-request org membership lookup
6. route handler (with per-route `validateBody` / `validateQuery` / `validateParams` middleware)
7. `onError` — single handler, `AppError` → problem+json

### 11.4 Domain module shape

```
ornn-api/src/domains/<resource>/
├── routes.ts        HTTP layer — routing + validation middleware only
├── service.ts       business logic — the only caller of repository
├── repository.ts    data access — only domains/<resource>/ imports this
├── schemas.ts       Zod schemas — request, response, domain types
└── [optional] <sub>/  sub-module for large domain (e.g. skills/search/)
```

### 11.5 Route ↔ repository boundary

Routes MUST NOT import repositories directly. Only services may call repositories. A lint rule (in `eslint.config.js`) enforces this.

### 11.6 Clients layer

All NyxID-related clients grouped under `ornn-api/src/clients/nyxid/`:

```
ornn-api/src/clients/
├── nyxid/
│   ├── base.ts           shared HTTP client, SA-token provider
│   ├── llm.ts            LLM gateway client
│   ├── orgs.ts           org lookup
│   └── userServices.ts   user-services client
├── storage.ts            chrono-storage
└── sandbox.ts            chrono-sandbox
```

`NyxidSaTokenProvider` is a first-class class, not an inlined closure.

### 11.7 Testing strategy

- **Unit tests** colocated with source (`foo.ts` + `foo.test.ts`). Pure functions, no DB.
- **Integration tests** in `ornn-api/tests/integration/` — real Mongo (via testcontainers or a spun-up instance), real HTTP. Not mocks.
- **Contract tests** in `ornn-api/tests/contract/` — assert OpenAPI spec matches handler behavior. Runs in CI.
- **Frontend unit tests** — Vitest + Testing Library, colocated with source.

Per-test teardown is the test's responsibility; shared fixtures live in `tests/fixtures/`.

---

## 12. Every new `/v1/` endpoint checklist

- [ ] Path follows `/v1/{resource}` or `/v1/{resource}/{action}` (sub-resource for actions)
- [ ] Method matches semantics (`PATCH` for partial update, `DELETE` returns `204`, `POST` create returns `201` + `Location`)
- [ ] Collection response shape is `{ items, meta }` with cursor pagination
- [ ] Error response uses `application/problem+json` with a code from the catalog
- [ ] `X-Request-ID` on every response; `requestId` in every error body
- [ ] Query params camelCase; arrays as repeated keys; `q` for search
- [ ] Required permissions from the catalog declared in OpenAPI `security`
- [ ] Content negotiation for multi-representation resources
- [ ] SSE events named `<resource>_<event>` snake_case
- [ ] Deprecation uses RFC 8594 headers
