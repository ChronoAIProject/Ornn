# API Reference — Skill Generation (SSE)

These three endpoints stream Server-Sent Events. All set:

```
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

Each SSE event is a `data: <json>` line; consumers JSON-parse the body.

| Event payload | Meaning |
|---|---|
| `{ "type": "start" }` | Generation started |
| `{ "type": "chunk", "delta": "<text>" }` | Incremental text |
| `{ "type": "complete", "content": "<full>", "skillPackage": {...} }` | Generation finished. `skillPackage` present when the generator produced files |
| `{ "type": "error", "message": "<text>" }` | Generation aborted; stream closes after this |
| `{ "type": "keepalive" }` | Heartbeat |

---

## `POST /api/v1/skills/generate`

**Generate a brand-new skill from a prompt.**

> **Auth required.** Permission: `ornn:skill:build`.

### Request

Two body shapes are accepted; the discriminator is `Content-Type`.

**Multipart (single-shot)** `Content-Type: multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | yes | Natural-language description |
| `package` | File | no | Existing ZIP for context (iterative refinement) |

**JSON (multi-turn)** `Content-Type: application/json`

```jsonc
{
  "prompt": "Build a skill that ...",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`prompt` is required when `messages` is omitted; with `messages`, the array is the source of truth.

### Response

`200 OK` with `Content-Type: text/event-stream`. Events as above.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `MISSING_PROMPT` | Multipart body without `prompt` field |
| 400 | `INVALID_CONTENT_TYPE` | Body type isn't multipart or JSON |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:build` |

---

## `POST /api/v1/skills/generate/from-source`

**Generate a skill from an inline code snippet or a public GitHub URL.**

> **Auth required.** Permission: `ornn:skill:build`.

### Request body (`application/json`)

```jsonc
{
  "code": "<inline source>",          // exactly one of code / repoUrl
  "repoUrl": "https://github.com/owner/repo",
  "path": "src/routes",                // optional; subpath inside repo
  "framework": "hono",                 // optional; framework hint
  "description": "Wraps the v1 routes" // optional; free-form context
}
```

### Response

SSE stream as in `/skills/generate`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `MISSING_SOURCE` | Neither `code` nor `repoUrl` |
| 400 | `AMBIGUOUS_SOURCE` | Both `code` and `repoUrl` |
| 400 | `EMPTY_SOURCE` | `code` empty after strip |
| 400 | `INVALID_BODY` | JSON parse failed |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:build` |
| 502 | `REPO_FETCH_FAILED` | Repo fetch failed |

---

## `POST /api/v1/skills/generate/from-openapi`

**Generate a skill from an OpenAPI 3 specification.**

> **Auth required.** Permission: `ornn:skill:build`.

### Request body (`application/json`)

```jsonc
{
  "spec": "<openapi yaml or json as a single string>",
  "endpoints": ["GET /users", "POST /users"], // optional allow-list
  "description": "..."                        // optional
}
```

### Response

SSE stream as in `/skills/generate`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `MISSING_SPEC` | `spec` missing or not a string |
| 400 | `INVALID_BODY` | JSON parse failed |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:build` |
