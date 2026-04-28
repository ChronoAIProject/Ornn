# API Reference — Overview & Conventions

Ornn exposes one HTTP surface — `https://<host>/api/v1/*` — that AI agents and the web UI both consume. Every endpoint lives under `/api/v1` unless explicitly marked **out-of-band**. This page captures the conventions every domain shares; per-domain pages cover the actual endpoints.

## Base URL and versioning

| Environment | Base URL |
|---|---|
| Local k8s | `https://ornn.ornn-cluster.local/api/v1` |
| Production | `https://ornn.<domain>/api/v1` (from `ORNN_API_URL` env) |

`/api/v1` is the only mounted version.

## Authentication model

Ornn does not verify NyxID tokens itself. Every request goes through the NyxID proxy, which:

1. Validates the user's NyxID OAuth session.
2. Decodes the user's identity into a JWT.
3. Forwards the request with `X-NyxID-Identity-Token: <jwt>` (and a few legacy `X-NyxID-*` headers for backwards compat).

`ornn-api`'s middleware decodes that JWT *without re-verifying signatures* (the proxy already verified) and populates `c.var.auth` for the rest of the handler chain.

| Field | Source | Notes |
|---|---|---|
| `userId` | JWT `sub` | Required. Used for ownership / authorship checks. |
| `email` | JWT `email` | Optional; defaults to empty string. |
| `displayName` | JWT `name` | Optional; falls back to `email`, then `userId`. |
| `roles` | JWT `roles` | Array of role strings. |
| `permissions` | JWT `permissions` | Array of permission strings (see catalogue below). |

Endpoints fall into three auth tiers:

| Tier | Behaviour |
|---|---|
| **Anonymous** | No identity token required. Used for public health / spec / public skill reads. |
| **Optional** | Token decoded if present; handler observes `c.var.auth` may be `null`. Used for visibility-gated reads where unauthenticated callers see only public data. |
| **Required** | Token must be present and well-formed; otherwise the request fails with `401 AUTH_MISSING`. |

## Permission catalogue

Required permissions are encoded as colon-separated namespaced strings on the JWT's `permissions` array. Missing the permission yields `403 FORBIDDEN`.

| Permission | Typical role | What it grants |
|---|---|---|
| `ornn:skill:read` | `ornn-user` | Fetch skill packages as JSON, validate skill packages |
| `ornn:skill:create` | `ornn-user` | Upload new skills, pull from GitHub |
| `ornn:skill:update` | `ornn-user` | Change skills you own |
| `ornn:skill:delete` | `ornn-user` | Delete skills / versions you own |
| `ornn:skill:build` | `ornn-user` | Use the AI generation endpoints |
| `ornn:playground:use` | `ornn-user` | Run the playground chat |
| `ornn:admin:skill` | `ornn-admin` | Read and act on every skill regardless of ownership; admin stats / activities / users; force-audit / force-delete; tag CRUD |
| `ornn:admin:category` | `ornn-admin` | Skill-category CRUD |

Several endpoints add an **ownership** check on top of the permission gate (e.g. only the skill author can `PUT /skills/:id`, unless the caller also holds `ornn:admin:skill`). Each endpoint section calls those out explicitly.

## Visibility rules for skills

Most read paths use the same visibility rule, applied server-side:

| Caller | Sees |
|---|---|
| Anonymous | Public skills only |
| Authenticated, non-owner | Public + skills directly shared with their `userId` + skills shared with any org they belong to (admin or member role; viewer doesn't count) |
| Authenticated, owner | All of the above + their own skills, including private |
| Platform admin (`ornn:admin:skill`) | All skills |

If a caller asks for a skill they cannot see, the response is `404 SKILL_NOT_FOUND` — never `403`. This avoids leaking the existence of private skills.

> **Sharing is unconditional.** Editing the allow-list (`PUT /skills/:id/permissions`) applies the new state immediately. There is no audit gate, no waiver, no reviewer queue. Audit results travel separately as a passive label and notification.

## Response envelope

Every JSON response (success and error) uses the same envelope:

```jsonc
{
  "data": <T> | null,
  "error": { "code": "<MACHINE_CODE>", "message": "<human-readable>" } | null
}
```

Streaming endpoints (SSE) do **not** wrap each event in this envelope.

## HTTP status codes

| Code | Meaning |
|---|---|
| `200 OK` | Successful GET / PUT / PATCH / DELETE |
| `201 Created` | `POST /skills`, `POST /skills/pull`, `POST /admin/categories`, `POST /admin/tags` |
| `400 Bad Request` | Validation failure, malformed body, missing required field, invalid query enum |
| `401 Unauthorized` | Auth required but no usable identity token |
| `403 Forbidden` | Authenticated but missing the permission, or failed an ownership check |
| `404 Not Found` | Resource does not exist or is not visible to the caller |
| `409 Conflict` | State conflict (rare) |
| `413 Payload Too Large` | ZIP exceeds `MAX_PACKAGE_SIZE_BYTES` (default ~50 MiB) |
| `500 Internal Server Error` | Unhandled exception; correlate via `X-Request-ID` |
| `503 Service Unavailable` | Hard dependency (Mongo, NyxID) unreachable. `/readyz` only. |
| `504 Gateway Timeout` | Upstream timed out |

## Common error codes

Codes are stable identifiers — branch on `error.code`, not on the HTTP status alone.

| Code | Meaning |
|---|---|
| `AUTH_MISSING` | No usable NyxID identity token |
| `FORBIDDEN` | Authenticated, but lacks permission or ownership |
| `VALIDATION_ERROR` | Generic Zod validation failure |
| `INVALID_BODY` | Body could not be parsed as JSON or was empty when required |
| `EMPTY_BODY` | ZIP-upload route received empty bytes |
| `INVALID_CONTENT_TYPE` | Content-Type was not `application/zip` / `application/octet-stream` / `multipart/form-data` |
| `PAYLOAD_TOO_LARGE` | ZIP exceeds size cap |
| `SKILL_NOT_FOUND` | Skill GUID / name unknown or not visible |
| `AUDIT_NOT_FOUND` | No completed audit record matches the request |
| `INTERNAL_ERROR` | Unhandled server exception |

Domain-specific error codes are documented in each domain page.

## Standard headers

### Request headers honoured globally

| Header | Required | Purpose |
|---|---|---|
| `X-NyxID-Identity-Token` | On required-auth routes | Forwarded by the NyxID proxy. Decoded for identity. |
| `X-Request-ID` | Optional | If set, copied into the response. Otherwise the server generates one. |
| `Content-Type` | On bodies | Discriminator for ZIP uploads vs. JSON vs. multipart |
| `Accept` | Optional | Reserved for future content negotiation |

### Response headers always set

| Header | Notes |
|---|---|
| `X-Request-ID` | Echoed for log correlation |
| `Content-Type` | `application/json; charset=utf-8` for envelope responses; `text/event-stream` for SSE |

CORS allowlist comes from `ALLOWED_ORIGINS`; preflight allows `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

## Pagination shape

Endpoints that paginate use offset pagination with this shape inside `data`:

```jsonc
{
  "items": [ ... ],
  "total": <int>,
  "page": <int>,
  "pageSize": <int>,
  "totalPages": <int>
}
```

Defaults vary; explicit values are documented per endpoint.

## Activity logging

Most write operations append to the `activities` collection (visible to platform admins via `GET /admin/activities`). Each activity record carries `userId`, `email`, `displayName`, `action`, `details`, `createdAt`.
