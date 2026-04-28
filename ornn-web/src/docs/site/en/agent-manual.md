---
name: ornn-agent-manual
description: Operational manual for AI agents using the Ornn skill-lifecycle API. Loads as a skill so that, once installed, the host agent can search / pull / execute / build / upload / share skills via the NyxID CLI without further setup. Authoritative contract between Ornn and the agent.
metadata:
  category: plain
  tags:
    - ornn
    - agent
    - manual
    - skill-lifecycle
---

# Agent Manual

> **Paste this whole document into an AI agent's system context.** It is structured as an Ornn skill (`category: plain`) — the `SKILL.md` frontmatter above + the body below are the entire skill. Once loaded, the agent can operate every Ornn capability end-to-end via the `nyxid` CLI — discover skills, pull skills, execute skills, create new skills, manage its own skill library, and participate in the sharing workflow. No SDK. No MCP. Just the CLI.
>
> Ornn's product is **Skill-as-a-Service for AI agents.** Skills are packaged AI capabilities (a `SKILL.md` prompt + optional scripts + YAML metadata) that any agent can pull and execute. This manual is the contract between Ornn and you.

## §1. Prerequisites

Every API call in this manual is executed through the **NyxID CLI** (`nyxid`). NyxID sits in front of Ornn: it handles OAuth login, token refresh, and proxies authenticated HTTP requests to Ornn. You never talk to Ornn directly.

### 1.1 Install the NyxID CLI

Download the `nyxid` binary from the NyxID releases page and place it on your `$PATH`. Verify:

```bash
nyxid --version
```

### 1.2 Log in

```bash
nyxid login
```

Opens a browser for the OAuth authorization code flow. On success, tokens are stored under `~/.nyxid/` and persist across invocations. Tokens auto-refresh; you rarely need to log in again.

### 1.3 Verify identity and permissions

```bash
nyxid whoami
```

Expected output includes `user_id`, `email`, `roles`, and `permissions`. For any non-trivial Ornn operation, confirm the permission list contains at least:

- `ornn:skill:read`
- `ornn:skill:create`
- `ornn:skill:build`
- `ornn:playground:use`

If a permission is missing, your NyxID admin needs to grant the corresponding role (typically `ornn-user`). Without these, every call in §3/§6 returns `403 FORBIDDEN` with `error.code = "FORBIDDEN"`.

### 1.4 Discover the Ornn service

```bash
nyxid proxy discover --output json
```

The response lists every service the authenticated user can reach through NyxID. Confirm an entry with `"slug": "ornn"` is present. From this point on, every Ornn call in this manual uses that slug.

---

## §2. Core Workflows

Ornn exposes ~50 endpoints but almost all real agent usage reduces to the three workflows below. Internalize these first; §3 and §6 only fill in the per-endpoint mechanics.

### 2.1 Discover → Pull → Execute

**Intent:** you need a capability you do not already have. Ornn may already host a skill for it.

| Step | Action | API |
|------|--------|-----|
| 1 | Search the registry by keyword or meaning | `GET /api/v1/skill-search` |
| 2 | Pick the best match (highest score, or best name) | — (client-side) |
| 3 | Pull the full skill content | `GET /api/v1/skills/:idOrName/json` |
| 4 | Read `SKILL.md` and follow its instructions | — (agent reads content) |
| 5a | *If `plain` skill:* follow the prompt and emit output | — |
| 5b | *If `runtime-based`/`mixed`:* execute scripts locally, or open the playground for managed execution | `POST /api/v1/playground/chat` |

CLI example:

```bash
# 1. Search
nyxid proxy request ornn \
  "/api/v1/skill-search?query=korean+translation&mode=semantic&scope=public&pageSize=5" \
  --method GET --output json

# 3. Pull the best match by name (e.g. "any-language-to-korean-translation")
nyxid proxy request ornn \
  "/api/v1/skills/any-language-to-korean-translation/json" \
  --method GET --output json
```

The `/json` variant returns the skill as a `{ name, description, metadata, files }` structure where `files` maps each relative path in the package to its full text content. Use this instead of the `presignedPackageUrl` in `GET /skills/:idOrName` — you avoid a second HTTP hop to storage.

### 2.2 Build → Package → Upload

**Intent:** you need a capability that does not exist. Have Ornn's LLM generate it, or package one yourself, then publish it to the registry.

| Step | Action | API |
|------|--------|-----|
| 1 | Generate via AI from prompt / source / OpenAPI | `POST /api/v1/skills/generate*` (SSE) |
| 2 | *(or)* Author `SKILL.md` + scripts locally | — |
| 3 | Package into a ZIP with a root folder | — (local) |
| 4 | *(optional)* Validate against format rules | `POST /api/v1/skill-format/validate` |
| 5 | Upload | `POST /api/v1/skills` |

See §6.1 for the full upload recipe and §6.7 for the AI-generation recipe.

### 2.3 Try → Share → Audit-aware

**Intent:** after building a skill, test it interactively, share it with a user / org / the public, and let the audit verdict travel as a passive label + notification rather than as a gate.

| Step | Action | API |
|------|--------|-----|
| 1 | Test in the playground with real inputs | `POST /api/v1/playground/chat` (SSE) |
| 2 | Owner edits the sharing allow-list (this is what "shares" the skill) | `PUT /api/v1/skills/:id/permissions` |
| 3 | Owner (or any consumer) triggers an audit on the current version | `POST /api/v1/skills/:idOrName/audit` |
| 4 | Watch the notifications feed for the audit verdict | `GET /api/v1/notifications` |

Sharing is **unconditional**. There is **no separate share endpoint** — sharing happens as a side-effect of `PUT /skills/:id/permissions`. The backend stores the desired allow-list as-is, with no audit gate, no waiver, no reviewer.

Audit is a **passive risk label**:

- A skill that has never been audited is shown as *not yet audited*.
- A completed audit produces a verdict — `green` (low risk), `yellow` (some findings), or `red` (serious findings) — that decorates the skill in the UI/API.
- When an audit completes, the **owner** is always notified. When the verdict is `yellow` or `red`, **every consumer** (everyone in `sharedWithUsers`, plus every member of every org in `sharedWithOrgs`) is also notified so they can decide whether to keep using the skill.

---

## §3. Full API Reference

Every Ornn endpoint:

- Lives under the `/api/v1/...` prefix (the backend mounts `apiApp` at `/api/v1`).
- Is invoked as: `nyxid proxy request ornn <path> --method <VERB> [--data <body>] [--stream]`.
- Returns JSON envelope `{ "data": <T> | null, "error": { "code": string, "message": string } | null }` unless it is an SSE stream (§5).
- Requires an authenticated NyxID session except where "Anonymous" is noted.

Command shorthand used in tables:
- `G <path>` = `--method GET`
- `P <path>` = `--method POST`
- `PUT <path>` = `--method PUT`
- `PATCH <path>` = `--method PATCH`
- `D <path>` = `--method DELETE`

### 3.1 Skills CRUD

| Method | Path | Permission / Auth | Use when |
|--------|------|-------------------|----------|
| POST | `/api/v1/skills` | `ornn:skill:create` | Upload a new skill (body = ZIP binary) |
| POST | `/api/v1/skills/pull` | `ornn:skill:create` | Import from a public GitHub repo |
| POST | `/api/v1/skills/:id/refresh` | `ornn:skill:update` + owner/admin | Re-pull the imported repo at current HEAD |
| GET | `/api/v1/skills/:idOrName` | Optional | Get metadata + `presignedPackageUrl` to download ZIP |
| GET | `/api/v1/skills/:idOrName/json` | `ornn:skill:read` | Get full package as `{ files: { path: content } }` — preferred for agents |
| GET | `/api/v1/skills/:idOrName/versions` | Optional | List every published version, newest first |
| GET | `/api/v1/skills/:idOrName/versions/:from/diff/:to` | Optional | Structured file-level diff between two versions |
| PUT | `/api/v1/skills/:id` | `ornn:skill:update` + owner/admin | Upload a new version (ZIP) or flip `isPrivate` |
| PUT | `/api/v1/skills/:id/permissions` | `ornn:skill:update` + owner/admin | Replace the sharing allow-list (`sharedWithUsers`, `sharedWithOrgs`) |
| PATCH | `/api/v1/skills/:idOrName/versions/:version` | `ornn:skill:update` + owner/admin | Toggle a version's deprecated flag |
| DELETE | `/api/v1/skills/:id` | `ornn:skill:delete` + owner/admin | Hard-delete the skill and all its versions |
| DELETE | `/api/v1/skills/:idOrName/versions/:version` | `ornn:skill:delete` + owner/admin | Delete a single non-latest version. Refused for the only version (use the row above) or the current latest (publish a newer version first). |

**Inputs worth knowing:**

- `POST /skills` accepts a binary ZIP (`Content-Type: application/zip`) or `multipart/form-data`. A ZIP must contain exactly one root folder with `SKILL.md` inside. Query `skip_validation=true` lets you bypass format checks (use sparingly — the registry will happily store malformed packages).
- `POST /skills/pull` body: `{ "repo": "owner/name", "ref": "main", "path": "", "skip_validation": false }`. The server clones, zips, and registers.
- `PUT /skills/:id` with JSON body `{ "isPrivate": false }` only flips visibility — it does not touch package content. With a ZIP body, it publishes a new version.
- `GET /skills/:idOrName` accepts `?version=1.2` to fetch a specific version. Without it, you get the latest.

### 3.2 Skills Search & Discovery

| Method | Path | Auth | Use when |
|--------|------|------|----------|
| GET | `/api/v1/skill-search` | Optional | Keyword or LLM-ranked search (semantic mode requires auth) |
| GET | `/api/v1/skill-counts` | Optional | Registry tab counts (`public`, `mine`, `sharedWithMe`) |

**Query parameters for `/skill-search`:**

| Param | Values | Notes |
|-------|--------|-------|
| `query` | string (max 2000 chars) | Empty = return all |
| `mode` | `keyword` (default) \| `semantic` | Semantic uses LLM re-ranking |
| `scope` | `public` \| `private` \| `mixed` \| `shared-with-me` \| `mine` | Default depends on auth |
| `page`, `pageSize` | int (pageSize 1–100, default 9) | Offset pagination |
| `model` | model id | Overrides platform-default LLM for semantic mode |
| `systemFilter` | `any` (default) \| `only` \| `exclude` | Filter "system skills" (tag matches a NyxID service slug) |
| `sharedWithOrgs`, `sharedWithUsers` | comma-separated ids | Narrow by grant source (when `scope=mine`) |
| `createdByAny` | comma-separated user_ids | Narrow by author (admin / directory use) |

### 3.3 Skills Generation *(SSE — see §5)*

| Method | Path | Permission | Use when |
|--------|------|------------|----------|
| POST | `/api/v1/skills/generate` | `ornn:skill:build` | Generate from a natural-language prompt |
| POST | `/api/v1/skills/generate/from-source` | `ornn:skill:build` | Generate by analyzing source code (inline snippet or GitHub repo URL) |
| POST | `/api/v1/skills/generate/from-openapi` | `ornn:skill:build` | Generate from an OpenAPI 3 spec |

All three stream events until completion. Use `--stream` when invoking via CLI.

**Body shapes:**

```jsonc
// /generate — single-shot prompt
{ "prompt": "Build a skill that converts CSV to JSON using csv-parse" }

// /generate — multi-turn refinement
{ "messages": [{ "role": "user", "content": "..." }, ...] }

// /generate/from-source
{
  "code": "<inline snippet>",              // OR
  "repoUrl": "https://github.com/org/repo", // one of the two
  "path": "src/mymodule/index.ts",         // optional, narrows the scan
  "framework": "express",                  // hint for the generator
  "description": "extract a skill that ..."
}

// /generate/from-openapi
{
  "spec": "<OpenAPI YAML or JSON>",
  "endpoints": ["GET /users", "POST /users"], // optional allow-list
  "description": "generate a skill that ..."
}
```

`/generate` additionally accepts `multipart/form-data` with a `prompt` field and an optional `package` ZIP attachment to iterate on an existing package.

### 3.4 Skill Format & Validation

| Method | Path | Auth | Use when |
|--------|------|------|----------|
| GET | `/api/v1/skill-format/rules` | Anonymous | Fetch the canonical format rules as markdown |
| POST | `/api/v1/skill-format/validate` | `ornn:skill:read` | Validate a ZIP against the rules without uploading |

`POST /validate` body = ZIP binary. Response: `{ "valid": true }` or `{ "valid": false, "violations": [{ rule, message }] }`. Validation is strict by default; the same rules run on upload unless `skip_validation=true` is set on `POST /skills`.

### 3.5 Skills Audit

Audits are **owner-triggered**, not auto-produced. Run one before sharing — the share gate (§3.6) reads the latest *completed* audit and refuses if none exists. Each click of the trigger creates a new row immediately so the agent / UI sees the run starting; the LLM pipeline finishes in the background and updates the row.

| Method | Path | Permission / Auth | Use when |
|--------|------|-------------------|----------|
| GET  | `/api/v1/skills/:idOrName/audit?version=<v>` | Visibility mirrors `GET /skills/:idOrName` | Read the latest *completed* audit for the current (or pinned) version. `null` until at least one audit completes. |
| GET  | `/api/v1/skills/:idOrName/audit/history?version=<v>` | Visibility mirrors `GET /skills/:idOrName` | List audit runs newest-first. Without `?version=` returns every run across versions; with it, narrows to that version. Includes `running` rows. |
| POST | `/api/v1/skills/:idOrName/audit` | Owner OR `ornn:skill:admin` | Start a new audit. Body `{ "force"?: boolean }` — `force=true` bypasses the 30-day cache. Returns the new row at `status: "running"`. |
| POST | `/api/v1/admin/skills/:idOrName/audit` | `ornn:skill:admin` | Same as above, but bypasses the ownership check entirely (platform-admin override). |

**Audit record lifecycle.** Each row has `status`:

| Status | Meaning |
|--------|---------|
| `running` | LLM pipeline is in flight. `verdict` / `overallScore` / `scores` / `findings` are placeholders until completion. |
| `completed` | Pipeline finished cleanly. `verdict` is `green` / `yellow` / `red`. `overallScore` is the 0–10 weighted average. |
| `failed` | Pipeline errored (storage fetch, LLM parse, etc.). `errorMessage` carries a short cause. The row stays in history; trigger another run to retry. |

**Audit cache.** With `force=false` the backend reuses the most recent `completed` row that has the same `skillHash` and is younger than 30 days, instead of inserting a new row. With `force=true` you always get a fresh run.

**Polling pattern for agents.** When you trigger an audit, poll `GET /audit/history?version=` every few seconds until your row's status is no longer `running`. The web UI uses 3-second poll while running, then stops.

### 3.6 Sharing

There is **no `POST /skills/:idOrName/share` endpoint, no waiver flow, and no review queue.** Sharing is a side-effect of `PUT /skills/:id/permissions` (§3.1). The backend stores the requested `isPrivate` / `sharedWithUsers` / `sharedWithOrgs` as-is and the response shape is:

```jsonc
{ "data": { "skill": <SkillDetail> }, "error": null }
```

No audit check, no waiver list, no reviewer. Whoever the owner names in the allow-list immediately gains access; whoever the owner removes immediately loses it.

The audit pipeline (§3.5) runs independently and surfaces its verdict via the notifications feed (§3.7). It never blocks a share.

### 3.7 Notifications

| Method | Path | Use when |
|--------|------|----------|
| GET | `/api/v1/notifications?unread=true&limit=50` | List your notifications |
| GET | `/api/v1/notifications/unread-count` | Badge count |
| POST | `/api/v1/notifications/:id/read` | Mark one read |
| POST | `/api/v1/notifications/mark-all-read` | Mark all read |

All endpoints authenticated. Two notification categories are emitted today:

| Category | Sent to | Trigger |
|----------|---------|---------|
| `audit.completed`            | Skill owner    | Every audit completion. The body distinguishes `green` (passed) from `yellow`/`red` (flagged risk) and links to the audit history page. |
| `audit.risky_for_consumer`   | Every consumer of a `yellow`/`red` audited skill — i.e. each user in `sharedWithUsers`, plus the membership of each org in `sharedWithOrgs` (resolved via NyxID) | Same audit completion. Skipped for `green`. |

### 3.8 Analytics

Two endpoints, both visibility-gated like `GET /skills/:idOrName`:

| Method | Path | Use when |
|--------|------|----------|
| GET | `/api/v1/skills/:idOrName/analytics?window=7d\|30d\|all&version=<v>` | Execution summary: invocation count, success rate, p50/p95/p99 latency, unique users, top error codes. Without `version`, aggregates across every version. |
| GET | `/api/v1/skills/:idOrName/analytics/pulls?bucket=hour\|day\|month&from=<iso>&to=<iso>&version=<v>` | Time-series of skill **pulls** (the count of times the package was materialized somewhere). Returns `{ items: [{ bucket, total, bySource: { api, web, playground } }, ...] }`. Default window: last 7 days. |

**`bySource` enum** for the pulls endpoint:

| Source | Recorded by |
|--------|-------------|
| `api`        | `GET /api/v1/skills/:idOrName/json` — programmatic pull (SDK / CLI / external agent). The closest signal to the north-star metric "skills consumed by external agents". |
| `web`        | `GET /api/v1/skills/:idOrName` — minted-presigned-URL pull from the detail page in a browser. |
| `playground` | `POST /api/v1/playground/chat` when bound to a real skill. |

Anonymous callers only see analytics for public skills.

### 3.9 Playground *(SSE — see §5)*

| Method | Path | Permission | Use when |
|--------|------|------------|----------|
| POST | `/api/v1/playground/chat` | `ornn:playground:use` | Run a chat with a skill injected; Ornn handles tool-use + sandbox execution |

Body:

```jsonc
{
  "messages": [
    { "role": "user", "content": "Translate: Hello" }
    // Subsequent turns append role/content, plus toolCalls / toolCallId
    // when the LLM used a built-in tool.
  ],
  "skillId": "<guid or name>",               // optional — without it, the chat is a "blank" agent
  "envVars": { "API_KEY": "..." }            // optional — injected into sandbox for runtime skills
}
```

The backend runs a server-side tool-use loop (up to 5 rounds): when the LLM emits a `function_call` to `execute_script` or `skill_search`, Ornn auto-executes it (no client approval), feeds the result back, and keeps streaming. From the agent's side this looks like one call with a chunked response.

### 3.10 Admin

Admin endpoints require `ornn:admin:skill` (or `ornn:admin:category`) permission. Most agents never call these — documented here for completeness.

| Method | Path | Permission | Use when |
|--------|------|------------|----------|
| GET | `/api/v1/admin/stats` | `ornn:admin:skill` | Platform dashboard totals |
| GET | `/api/v1/admin/activities` | `ornn:admin:skill` | Activity audit log |
| GET | `/api/v1/admin/users` | `ornn:admin:skill` | User directory + per-user counts |
| GET | `/api/v1/admin/skills` | `ornn:admin:skill` | Registry-wide skill browser |
| DELETE | `/api/v1/admin/skills/:id` | `ornn:admin:skill` | Admin delete |
| GET | `/api/v1/admin/categories` | `ornn:admin:category` | List categories |
| POST | `/api/v1/admin/categories` | `ornn:admin:category` | Create category |
| PUT | `/api/v1/admin/categories/:id` | `ornn:admin:category` | Update category |
| DELETE | `/api/v1/admin/categories/:id` | `ornn:admin:category` | Delete category |
| GET | `/api/v1/admin/tags` | `ornn:admin:skill` | List tags (query `?type=predefined\|custom`) |
| POST | `/api/v1/admin/tags` | `ornn:admin:skill` | Create a custom tag |
| DELETE | `/api/v1/admin/tags/:id` | `ornn:admin:skill` | Delete tag |
| POST | `/api/v1/admin/skills/:idOrName/audit` | `ornn:admin:skill` | Force-rerun audit |
| GET  | `/api/v1/admin/settings` | `ornn:admin:skill` | Read platform-wide settings (audit waiver threshold etc.) |
| PATCH | `/api/v1/admin/settings` | `ornn:admin:skill` | Update platform settings. Body `{ "auditWaiverThreshold": <0-10> }`. |

### 3.11 Me *(caller identity & grants)*

| Method | Path | Use when |
|--------|------|----------|
| GET | `/api/v1/me` | Caller snapshot: userId, email, displayName, roles, permissions |
| GET | `/api/v1/me/orgs` | List org memberships (admin + member roles only) |
| GET | `/api/v1/me/orgs/:orgId` | Resolve a single org (useful even after leaving it) |
| GET | `/api/v1/me/nyxid-services` | Personal + org-inherited NyxID services — powers the "system skill" filter |
| GET | `/api/v1/me/skills/grants-summary` | For each grantee (user/org), how many of your skills they can see |
| GET | `/api/v1/me/shared-skills/sources-summary` | For each grantor (user/org), how many skills they shared with you |
| POST | `/api/v1/activity/login` | Fire-and-forget session-open telemetry |
| POST | `/api/v1/activity/logout` | Fire-and-forget session-close telemetry |

### 3.12 Users *(directory lookup)*

| Method | Path | Use when |
|--------|------|----------|
| GET | `/api/v1/users/search?q=<email-prefix>&limit=10` | Typeahead for the sharing picker |
| GET | `/api/v1/users/resolve?ids=a,b,c` | Batch-resolve user_ids to `{ email, displayName }` |

Both require authentication. Unknown ids are silently dropped (no 404).

---

## §4. Auth & Envelope

### 4.1 Response envelope

Every JSON response has exactly this shape:

```jsonc
{
  "data":  <T> | null,
  "error": { "code": string, "message": string } | null
}
```

- HTTP 2xx → `data` set, `error` is `null`.
- HTTP 4xx/5xx → `data` is `null`, `error` populated.
- Streaming responses (§5) do **not** use the envelope — each SSE event is its own JSON object.

Do not parse success from `error === null` alone; always also check HTTP status. Concretely: a 500 with a proxy-injected body will still have `data: null` but may carry a different envelope.

### 4.2 Permission catalog

Every write or privileged read requires one of these permissions. They are issued by NyxID based on the caller's role.

| Permission | Who has it | What it unlocks |
|------------|-----------|-----------------|
| `ornn:skill:read` | `ornn-user` | Read private skills you can access; fetch `/json` view |
| `ornn:skill:create` | `ornn-user` | Upload new skills (ZIP or GitHub import) |
| `ornn:skill:update` | `ornn-user` | Edit own skills (package, visibility, permissions) |
| `ornn:skill:delete` | `ornn-user` | Delete own skills |
| `ornn:skill:build` | `ornn-user` | Use `/skills/generate*` (AI generation) |
| `ornn:playground:use` | `ornn-user` | Use `/playground/chat` |
| `ornn:admin:skill` | `ornn-admin` | Any-skill admin operations; stats / activities / users / audit |
| `ornn:admin:category` | `ornn-admin` | Category CRUD |

Typical role mapping:

| Role | Permissions |
|------|-------------|
| `ornn-user` | `skill:read`, `skill:create`, `skill:update`, `skill:delete`, `skill:build`, `playground:use` |
| `ornn-admin` | All `ornn-user` + `admin:skill` + `admin:category` |

If a call returns `403 FORBIDDEN` with `"Missing permission: <perm>"`, check `nyxid whoami` — the permission is missing from your session.

### 4.3 Error codes

Common codes you should handle:

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_MISSING` | 401 | No credentials presented |
| `FORBIDDEN` | 403 | Authenticated, but permission missing or ownership check failed |
| `SKILL_NOT_FOUND` | 404 | Skill/version/guid does not exist |
| `VALIDATION_FAILED` | 400 | ZIP failed format validation (`violations[]` in envelope) |
| `INVALID_BODY` | 400 | Malformed JSON or missing fields |
| `PAYLOAD_TOO_LARGE` | 413 | ZIP exceeds `MAX_PACKAGE_SIZE_BYTES` (default 50 MiB) |
| `CONFLICT` | 409 | Duplicate version publish, etc. |
| `INTERNAL_ERROR` | 500 | Generic server failure — retry with backoff |

Correlation: every response carries an `X-Request-ID` header. Include it when reporting failures — it matches the server log line.

---

## §5. SSE Streaming

Two endpoint families stream Server-Sent Events instead of returning a JSON envelope:

- Skill generation: `POST /api/v1/skills/generate`, `/generate/from-source`, `/generate/from-openapi`
- Playground chat: `POST /api/v1/playground/chat`

### 5.1 Consuming a stream via the CLI

Pass `--stream` and the CLI emits each event line to stdout:

```bash
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{"prompt":"Create a skill that counts word frequencies in a file"}' \
  --stream
```

The connection stays open for minutes; an LLM generation with validation retries can take 30–90 seconds, and a playground chat with multiple sandbox rounds can exceed two minutes. Do not set a short client timeout.

### 5.2 Skill generation events

Emitted by `/skills/generate*`:

| Event `type` | Meaning | Notes |
|--------------|---------|-------|
| `generation_start` | Stream opened, LLM engaged | — |
| `token` | Incremental content chunk | Concatenate `content` fields |
| `generation_complete` | Full generated skill | `raw` holds the final payload |
| `validation_error` | Generated skill failed format check | `retrying: true` means the server is auto-retrying |
| `error` | Fatal stream error | Connection will close |
| `keepalive` | Heartbeat | Ignore |

End-of-stream: either `generation_complete` followed by close, or `error`.

### 5.3 Playground chat events

Emitted by `/playground/chat`:

| Event `type` | Meaning |
|--------------|---------|
| `text-delta` | Incremental assistant text |
| `tool-call` | LLM invoked a tool (`skill_search`, `execute_script`); `toolCall` has `id`, `name`, `args` |
| `tool-result` | Tool finished; `toolCallId` links back, `result` is text |
| `file-output` | Runtime skill produced a file; `{ path, content, size, mimeType }` |
| `error` | Fatal error |
| `finish` | Stream end; `finishReason` set |
| `keepalive` | Heartbeat |

A normal chat ends with a `finish` event. `tool-call` / `tool-result` pairs appear only for runtime skills or when the agent explicitly searches the registry mid-chat.

---

## §6. Use Cases

Each subsection is a complete recipe — copy it verbatim, substitute the obvious arguments, and it works.

### 6.1 Upload a new skill

**When:** you have a local directory (or generated output) you want to publish.

```bash
# 1. Arrange the package. The ZIP must contain a single root folder named
#    after your skill (kebab-case). Inside: SKILL.md is required.
#    my-skill/
#    ├── SKILL.md
#    └── scripts/ (optional)
cd ~/skills
zip -r my-skill.zip my-skill/

# 2. (Optional) Validate before upload.
nyxid proxy request ornn "/api/v1/skill-format/validate" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json

# 3. Upload. Defaults to private; flip visibility later with step 6.5.
nyxid proxy request ornn "/api/v1/skills" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

On success, `data.guid` is your new skill's uuid. To bypass validation at upload time (rare — usually only for legacy packages): append `?skip_validation=true` to the path.

### 6.2 Download (pull) a skill

**When:** you want to run a skill locally or inject its content into your agent.

```bash
# Option A — full JSON (preferred for agents): every file inline.
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/json" \
  --method GET --output json

# Option B — just metadata + presigned ZIP URL. Useful if you only need
# one file or want to cache the binary on disk.
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>" \
  --method GET --output json
# Then download the ZIP with curl:
curl -o skill.zip "$(jq -r '.data.presignedPackageUrl' <<< "$RESPONSE")"
```

Add `?version=<semver>` to either call to pin to a specific version. Without it you get the latest.

### 6.3 Publish a new version

**When:** you edited an existing skill and want to release a new version.

```bash
# Bump the version in SKILL.md frontmatter (e.g. 1.2 → 1.3), re-zip,
# then PUT to the same skill id. A new immutable version is created;
# the latest pointer advances.
nyxid proxy request ornn "/api/v1/skills/<id>" \
  --method PUT \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

The old version remains readable via `GET /skills/<idOrName>?version=<old>`. Consumers that didn't pin a version automatically get the new one.

### 6.4 Deprecate a version

**When:** a version has a known issue but you don't want to remove it from history.

```bash
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/1.2" \
  --method PATCH \
  --data '{"isDeprecated":true,"deprecationNote":"Breaks with axios >= 1.7; use 1.3+."}' \
  --output json
```

The version remains in `/versions` listings and is still resolvable, but `GET /skills/<idOrName>?version=1.2` now returns the deprecation banner headers. `isDeprecated: false` un-deprecates.

### 6.5 Run an audit *(label, not a gate)*

**When:** you've published a new version and want to refresh the public risk verdict, or a consumer asked you to. There's no auto-publish trigger — owner clicks "Start Auditing" / hits this endpoint deliberately. Sharing does not require an audit; this is purely about producing a label and a notification.

```bash
# Trigger an audit. Returns immediately at status: "running".
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit" \
  --method POST \
  --data '{"force":false}' \
  --output json

# Poll until it completes (status is no longer "running").
while true; do
  STATUS=$(nyxid proxy request ornn \
    "/api/v1/skills/<idOrName>/audit/history" \
    --method GET --output json \
    | jq -r '.data.items[0].status')
  [ "$STATUS" != "running" ] && break
  sleep 5
done

# Read the verdict.
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit" \
  --method GET --output json
```

Pass `"force": true` if you want to bypass the 30-day cache (re-audit even if the same skill bytes were just scored).

### 6.6 Share a skill *(unconditional)*

**When:** you want to grant another user, an org, or the public access. Audit verdict — if any — is purely informational and never blocks the call.

```bash
# Edit the allow-list. The backend stores it as-is.
nyxid proxy request ornn "/api/v1/skills/<id>/permissions" \
  --method PUT \
  --data '{
    "isPrivate": true,
    "sharedWithUsers": ["user_abc"],
    "sharedWithOrgs": ["org_xyz"]
  }' \
  --output json
# Response: { "data": { "skill": <updated> }, "error": null }
```

To revoke, send the same request with the targets removed. To make a skill public, send `"isPrivate": false`. To make it private again, send `"isPrivate": true` with empty allow-lists.

If you also want a fresh risk verdict for the version you just shared, trigger an audit (§6.5). The owner will receive an `audit.completed` notification on completion, and any `yellow`/`red` verdict additionally fans out an `audit.risky_for_consumer` notification to everyone you shared with.

### 6.6.1 Delete a non-latest version

**When:** an old version is broken or superseded; you want to prune storage without nuking the skill.

```bash
# Cannot delete the only remaining version (delete the whole skill instead)
# or the current latest (publish a newer version first).
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/<X.Y>" \
  --method DELETE --output json
```

### 6.7 Generate a skill with AI *(SSE)*

**When:** you need a brand-new skill and want Ornn's LLM to scaffold it.

```bash
# Single-shot prompt.
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{"prompt":"Create a plain skill that detects API keys, passwords, and PII in text"}' \
  --stream

# Multi-turn refinement (reuse the previous conversation).
nyxid proxy request ornn "/api/v1/skills/generate" \
  --method POST \
  --data '{
    "messages": [
      { "role": "user", "content": "Create a CSV-to-JSON skill" },
      { "role": "assistant", "content": "<previous generation>" },
      { "role": "user", "content": "Now use csv-parse, not papaparse" }
    ]
  }' \
  --stream
```

Capture the stream (§5.2). When you see `generation_complete`, `event.raw` contains the finished skill. Re-package it (§6.1) and upload.

### 6.8 Generate from existing source code

**When:** you have a function or module that already does the work; you just want it packaged as a skill.

```bash
nyxid proxy request ornn "/api/v1/skills/generate/from-source" \
  --method POST \
  --data '{
    "repoUrl": "https://github.com/someuser/some-repo",
    "path": "src/utils/summarizer.ts",
    "framework": "none",
    "description": "Package the summarize() function as a reusable skill"
  }' \
  --stream
```

Or pass `code: "<inline>"` instead of `repoUrl` for a snippet you already have locally.

### 6.9 Generate from an OpenAPI spec

**When:** you want an HTTP API exposed as a skill. Ornn reads the spec and generates a skill that invokes the right endpoint with the right body.

```bash
SPEC=$(cat openapi.yaml | jq -Rs .)   # JSON-encode the YAML as a single string
nyxid proxy request ornn "/api/v1/skills/generate/from-openapi" \
  --method POST \
  --data "{\"spec\":$SPEC,\"endpoints\":[\"POST /v1/summary\"],\"description\":\"Wrap the summary endpoint\"}" \
  --stream
```

The optional `endpoints` array narrows which operations the generator covers — omit it to generate a skill that supports every operation in the spec.

### 6.10 Validate a package before upload

```bash
nyxid proxy request ornn "/api/v1/skill-format/validate" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
# → { "data": { "valid": true, "violations": [] }, "error": null }
```

Always cheap, always safe to call. Run it before `/skills` upload in CI.

### 6.11 Run a skill in the playground *(SSE)*

**When:** you want to test a skill end-to-end with real inputs, including script execution in the sandbox.

```bash
nyxid proxy request ornn "/api/v1/playground/chat" \
  --method POST \
  --data '{
    "skillId": "<guid or name>",
    "messages": [
      { "role": "user", "content": "Translate: Hello, world." }
    ],
    "envVars": { "OPENAI_API_KEY": "..." }
  }' \
  --stream
```

Consume events as in §5.3. For runtime-based skills, watch for `tool-call` with `name: "execute_script"` and the matching `tool-result` — that's the sandbox run.

### 6.12 See analytics for a skill

```bash
# Execution summary across all versions.
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics?window=30d" \
  --method GET --output json

# Same, narrowed to one version.
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics?window=30d&version=1.2" \
  --method GET --output json

# Pull time-series — last 7 days bucketed by day (default).
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=day" \
  --method GET --output json

# Custom range, hourly buckets, single version.
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=hour&from=2026-04-20T00:00:00Z&to=2026-04-21T00:00:00Z&version=1.2" \
  --method GET --output json
```

`window` values: `7d`, `30d`, `all`. `bucket` values: `hour`, `day`, `month`. Anonymous callers get analytics only for public skills.

### 6.13 Diff two versions

**When:** you want to see exactly what changed between v1.2 and v1.3 before consuming a new release.

```bash
nyxid proxy request ornn \
  "/api/v1/skills/<idOrName>/versions/1.2/diff/1.3" \
  --method GET --output json
```

Response shape: `{ added: [...], removed: [...], modified: [{ path, before, after }] }`. File-level; content of modified files is included so you can render a unified diff locally.

### 6.14 Handle your notifications

```bash
# Unread count — cheap, poll it for a badge.
nyxid proxy request ornn "/api/v1/notifications/unread-count" \
  --method GET --output json

# Fetch unread notifications.
nyxid proxy request ornn "/api/v1/notifications?unread=true&limit=50" \
  --method GET --output json

# Mark a single one read.
nyxid proxy request ornn "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json

# Or flush the inbox.
nyxid proxy request ornn "/api/v1/notifications/mark-all-read" \
  --method POST --data '{}' --output json
```

The two audit notification categories above (§3.7) and admin actions against your skills land here.

### 6.15 React to an audit risk notification

**When:** you received an `audit.risky_for_consumer` notification for a skill someone shared with you, and you want to inspect the findings before continuing to use it.

```bash
# 1. Get the notification's deep-link (the bell + /notifications page exposes it).
#    The link points at /skills/<idOrName>/audits?version=<v>.

# 2. Read the audit history for that version.
nyxid proxy request ornn "/api/v1/skills/<idOrName>/audit/history?version=<v>" \
  --method GET --output json

# 3. Mark the notification read.
nyxid proxy request ornn "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json
```

If you decide to stop using the skill, ask the owner to drop you from `sharedWithUsers` or unshare the org you're a member of (§6.6). Consumers can't self-revoke today — that's an owner-side edit.

---

## Appendix A — Pitfalls & conventions

- **Path prefix is `/api/v1/`** — every example in this manual includes it. Dropping `/v1/` returns 404 from the backend (there is no implicit redirect).
- **Anonymous calls are rare.** `/skill-format/rules` and the public `/skill-search` slice are the main ones. Everywhere else, `nyxid login` first.
- **ZIPs must have exactly one root folder**, named after the skill (`my-skill/SKILL.md`, not a flat `SKILL.md` at the archive root). Validation will reject either mistake.
- **Version pinning** on `GET /skills/:idOrName[?version=]` accepts `X.Y` semver — it matches the version strings in `SKILL.md` frontmatter.
- **Skill name vs guid.** Most GETs accept either, but writes (PUT `/skills/:id`, DELETE `/skills/:id`) require the guid. `POST /skills` returns the guid at creation; keep it for later writes.
- **Audit record statuses** (observable on `GET /audit/history`): `running`, `completed`, `failed`. Sharing is unconditional and does not depend on audit status; the audit verdict is purely informational. See §3.5 for the lifecycle.
- **Audit verdicts**: `green`, `yellow`, `red`. Only `yellow`/`red` triggers a fan-out notification to consumers (see §3.7).
- **403 on read but 404 on write.** If a private skill is hidden from you, you get 404 (not 403) from `GET` so the existence of the skill isn't leaked. Writes use 403 when you're authed but lack ownership / admin.

---

## Appendix B — Where to learn more

- `GET /api/v1/skill-format/rules` — canonical format spec, always up-to-date.
- `GET /api/v1/openapi.json` — auto-generated OpenAPI 3 schema. Every endpoint above is in here with full Zod-derived request/response types.
- Technical References (in this docs site): **System Architecture** for how the pieces fit together, **External Integrations** for NyxID / chrono-sandbox / chrono-storage details.
