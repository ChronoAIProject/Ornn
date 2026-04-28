---
name: ornn-agent-manual
description: Operational manual for AI agents using the Ornn skill-lifecycle API. Loads as a skill so that, once installed, the host agent can search / pull / execute / build / upload / share skills via the NyxID CLI without further setup. Authoritative contract between Ornn and the agent. Pair this file with references/api-reference.md (the full per-endpoint catalogue and error legend) — both ship together as one Ornn skill.
metadata:
  category: plain
  tag:
    - ornn-api
    - agent
    - manual
    - skill-lifecycle
version: "2.2"
lastUpdated: 2026-04-28
---

# Agent Manual

> **Paste this whole skill into an AI agent's system context.** The skill ships as `SKILL.md` (this file: workflow patterns + recipes) plus `references/api-reference.md` (full per-endpoint catalogue + error legend). Once loaded, the agent can operate every Ornn capability end-to-end via the `nyxid` CLI — discover skills, pull skills, execute skills, create new skills, manage its own skill library, share skills, react to audit notifications. No SDK. No MCP. Just the CLI.
>
> Ornn's product is **Skill-as-a-Service for AI agents.** Skills are packaged AI capabilities (a `SKILL.md` prompt + optional scripts + YAML metadata) that any agent can pull and execute. This manual is the contract between Ornn and you.

## §0. Updating this manual

This manual is itself an Ornn skill (`name: ornn-agent-manual`). Its source of truth is the Ornn registry, not a static docs page. There is no separate URL to fetch — pull a fresh copy through the same API every other skill flows through.

**Whenever you (the agent) want to check for an update, follow these steps verbatim:**

1. Pull the latest version of this skill from Ornn:

   ```bash
   nyxid proxy request ornn-api \
     "/api/v1/skills/ornn-agent-manual/json" \
     --method GET --output json
   ```

2. The response is `{ data: { name, description, metadata, files: { "SKILL.md": "...", "references/api-reference.md": "..." } } }`. Read the YAML frontmatter at the top of `SKILL.md` and find the `version:` field.

3. Compare it to the `version:` in **your loaded copy** (the frontmatter at the top of this file). If they match, you are current — stop here.

4. If the published version is newer:
   - List every version available by calling `GET /api/v1/skills/ornn-agent-manual/versions`. The response has one row per version, newest first.
   - Ask the user which version they want to load (they may want to pin to an older one for reproducibility).
   - Once the user picks, fetch with `GET /api/v1/skills/ornn-agent-manual/json?version=<X.Y>` and replace your context with the new `SKILL.md` (and `references/api-reference.md` if they consume it). The new content's frontmatter overwrites the old.

5. If you encounter `AUDIT_NOT_FOUND` / `SKILL_NOT_FOUND` errors in step 1, the registry instance you are pointing at has not published the skill yet. Keep operating on the version you have. The Ornn API is backwards-compatible within `/api/v1`, so older manuals continue to produce valid calls — you will only miss capabilities introduced in newer versions.

If `nyxid` is unavailable or the proxy is unreachable, keep operating on the version you have. Do not retry-loop the update check; treat it as a once-per-session inquiry the user can re-trigger explicitly.

---

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

Opens a browser for the OAuth authorization-code flow. On success, tokens are stored under `~/.nyxid/` and persist across invocations. Tokens auto-refresh; you rarely need to log in again.

### 1.3 Verify identity and permissions

```bash
nyxid whoami
```

Expected output includes `user_id`, `email`, `roles`, and `permissions`. For any non-trivial Ornn operation, confirm the permission list contains at least:

- `ornn:skill:read`
- `ornn:skill:create`
- `ornn:skill:build`
- `ornn:playground:use`

If a permission is missing, your NyxID admin needs to grant the corresponding role (typically `ornn-user`). Without these, every write call returns `403` with `error.code = "FORBIDDEN"` and a `Missing permission: <perm>` message. The full permission catalogue lives in `references/api-reference.md`.

### 1.4 Discover the Ornn service

```bash
nyxid proxy discover --output json
```

The response lists every service the authenticated user can reach through NyxID. Confirm an entry with `"slug": "ornn-api"` is present. From this point on, every Ornn call in this manual uses the slug `ornn-api`.

---

## §2. Core Workflows

Ornn exposes ~50 endpoints, but almost all real agent usage reduces to the three workflows below. Internalize these first; the per-endpoint mechanics live in `references/api-reference.md`.

### 2.1 Discover → Pull → Execute

**Intent:** you need a capability you do not already have. Ornn may already host a skill for it.

| Step | Action | API |
|------|--------|-----|
| 1 | Search the registry by keyword or meaning | `GET /api/v1/skill-search` |
| 2 | Pick the best match (highest score, or best name) | (client-side) |
| 3 | Pull the full skill content | `GET /api/v1/skills/:idOrName/json` |
| 4 | Read `SKILL.md` and follow its instructions | (agent reads content) |
| 5a | *If `plain` skill:* follow the prompt and emit output | — |
| 5b | *If `runtime-based` / `mixed`:* execute scripts locally, or open the playground for managed execution | `POST /api/v1/playground/chat` |

CLI example:

```bash
# 1. Search
nyxid proxy request ornn-api \
  "/api/v1/skill-search?query=korean+translation&mode=semantic&scope=public&pageSize=5" \
  --method GET --output json

# 3. Pull the best match by name
nyxid proxy request ornn-api \
  "/api/v1/skills/any-language-to-korean-translation/json" \
  --method GET --output json
```

The `/json` variant returns the skill as a `{ name, description, metadata, files }` structure where `files` maps each relative path in the package to its full text content. Use this instead of the `presignedPackageUrl` that `GET /skills/:idOrName` returns — you avoid a second HTTP hop to storage and you get every file in one envelope.

### 2.2 Build → Package → Upload

**Intent:** you need a capability that does not exist. Have Ornn's LLM generate it, or package one yourself, then publish to the registry.

| Step | Action | API |
|------|--------|-----|
| 1 | Generate via AI from prompt / source / OpenAPI | `POST /api/v1/skills/generate*` (SSE) |
| 2 | *(or)* Author `SKILL.md` + scripts locally | — |
| 3 | Package into a ZIP with a single root folder | (local) |
| 4 | *(optional)* Validate against format rules | `POST /api/v1/skill-format/validate` |
| 5 | Upload | `POST /api/v1/skills` |

See §3.1 for the upload recipe and §3.7 for the AI-generation recipe.

### 2.3 Try → Share → Audit-aware

**Intent:** after building a skill, test it interactively, share it with a user / org / the public, and let the audit verdict travel as a passive label + notification rather than as a gate.

| Step | Action | API |
|------|--------|-----|
| 1 | Test in the playground with real inputs | `POST /api/v1/playground/chat` (SSE) |
| 2 | Owner edits the sharing allow-list (this is what "shares" the skill) | `PUT /api/v1/skills/:id/permissions` |
| 3 | Owner (or any consumer) triggers an audit on the current version | `POST /api/v1/skills/:idOrName/audit` |
| 4 | Watch the notifications feed for the audit verdict | `GET /api/v1/notifications` |

Sharing is **unconditional**. There is **no separate share endpoint**. There is no audit gate, no waiver, no review queue. The backend stores the desired `isPrivate` / `sharedWithUsers` / `sharedWithOrgs` exactly as the owner sets them.

Audit is a **passive risk label**:

- A skill that has never been audited shows as *not yet audited*.
- A completed audit produces a verdict — `green` (low risk), `yellow` (some findings), or `red` (serious findings) — that decorates the skill in the UI / API.
- When an audit completes, the **owner** is always notified (`audit.completed`). When the verdict is `yellow` or `red`, **every consumer** (everyone in `sharedWithUsers`, plus every member of every org in `sharedWithOrgs`) is also notified (`audit.risky_for_consumer`) so they can decide whether to keep using the skill.

---

## §3. Use Cases

Each subsection is a complete recipe — copy it verbatim, substitute the obvious arguments, and it works. For full request / response shapes, error codes, and edge cases, cross-reference `references/api-reference.md`.

### 3.1 Upload a new skill

**When:** you have a local directory (or generated output) you want to publish.

```bash
# 1. Arrange the package. The ZIP must contain a single root folder named
#    after your skill (kebab-case). Inside: SKILL.md is required.
#    my-skill/
#    ├── SKILL.md
#    └── scripts/   (optional)
cd ~/skills
zip -r my-skill.zip my-skill/

# 2. (Optional) Validate before upload.
nyxid proxy request ornn-api "/api/v1/skill-format/validate" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json

# 3. Upload. New skills default to private; flip later with §3.6.
nyxid proxy request ornn-api "/api/v1/skills" \
  --method POST \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

On success, `data.guid` is the new skill's UUID. To bypass validation at upload time (rare — usually only for legacy packages): append `?skip_validation=true` to the path.

### 3.2 Import a skill from a public GitHub repo

**When:** the source already lives on GitHub and you want a one-shot copy that can later be re-pulled with one call.

```bash
nyxid proxy request ornn-api "/api/v1/skills/pull" \
  --method POST \
  --data '{
    "repo": "owner/name",
    "ref": "main",
    "path": "skills/my-skill"
  }' \
  --output json
```

`ref` accepts a branch, tag, or commit SHA; `path` narrows to a sub-directory inside the repo (use `""` for the repo root). Ornn records the source so you can later refresh:

```bash
nyxid proxy request ornn-api "/api/v1/skills/<id>/refresh" \
  --method POST --output json
```

Refresh re-pulls the same `repo` + `ref` (HEAD of the branch) and publishes a new version when the bytes changed.

### 3.3 Download (pull) a skill

**When:** you want to run a skill locally or inject its content into your agent.

```bash
# Option A — full JSON (preferred for agents): every file inline.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/json" \
  --method GET --output json

# Option B — just metadata + a presigned ZIP URL. Useful if you only need
# one file or want to cache the binary on disk.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>" \
  --method GET --output json
# Then download the ZIP:
curl -o skill.zip "$(jq -r '.data.presignedPackageUrl' <<< "$RESPONSE")"
```

Add `?version=<X.Y>` to either call to pin to a specific version. Without it you get the latest.

### 3.4 Publish a new version

**When:** you edited an existing skill and want to release a new version.

```bash
# Bump the version in SKILL.md frontmatter (e.g. 1.2 → 1.3), re-zip,
# then PUT to the same skill id. A new immutable version is created;
# the latest pointer advances.
nyxid proxy request ornn-api "/api/v1/skills/<id>" \
  --method PUT \
  --data @my-skill.zip \
  --header "Content-Type: application/zip" \
  --output json
```

The old version remains readable via `GET /skills/<idOrName>?version=<old>`. Consumers that did not pin a version automatically get the new one.

### 3.5 Deprecate (or un-deprecate) a version

**When:** a version has a known issue but you do not want to remove it from history.

```bash
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/versions/1.2" \
  --method PATCH \
  --data '{"isDeprecated":true,"deprecationNote":"Breaks with axios >= 1.7; use 1.3+."}' \
  --output json
```

The version stays in `/versions` listings and is still resolvable, but `GET /skills/<idOrName>?version=1.2` now returns the deprecation warning headers (`X-Skill-Deprecated: true`, `X-Skill-Deprecation-Note: <urlencoded>`). Send `"isDeprecated": false` to un-deprecate.

### 3.6 Share a skill *(unconditional)*

**When:** you want to grant another user, an org, or the public access. The audit verdict — if any — is purely informational and never blocks the call.

```bash
# Replace the allow-list. The backend stores it as-is.
nyxid proxy request ornn-api "/api/v1/skills/<id>/permissions" \
  --method PUT \
  --data '{
    "isPrivate": true,
    "sharedWithUsers": ["user_abc"],
    "sharedWithOrgs": ["org_xyz"]
  }' \
  --output json
# Response: { "data": { "skill": <updated SkillDetail> }, "error": null }
```

To revoke, send the same request with the targets removed. To make a skill public, send `"isPrivate": false`. To make it private again, send `"isPrivate": true` with empty allow-lists. The previous allow-list values are not retained when you flip to public — they are simply ignored while `isPrivate: false` is in effect.

If you also want a fresh risk verdict for the version you just shared, trigger an audit (§3.8). The owner receives an `audit.completed` notification on completion, and any `yellow` / `red` verdict additionally fans out an `audit.risky_for_consumer` notification to everyone you shared with.

### 3.7 Generate a skill with AI *(SSE)*

**When:** you need a brand-new skill and want Ornn's LLM to scaffold it.

```bash
# Single-shot prompt.
nyxid proxy request ornn-api "/api/v1/skills/generate" \
  --method POST \
  --data '{"prompt":"Create a plain skill that detects API keys, passwords, and PII in text"}' \
  --stream

# Multi-turn refinement.
nyxid proxy request ornn-api "/api/v1/skills/generate" \
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

Capture the SSE stream — see `references/api-reference.md` § "SSE event shapes". When you observe `generation_complete`, `event.raw` contains the finished skill. Re-package it (§3.1) and upload.

### 3.8 Run an audit *(label, not a gate)*

**When:** you have published a new version and want to refresh the public risk verdict, or a consumer asked you to. There is no auto-trigger — the owner clicks "Start Auditing" / hits this endpoint deliberately. Sharing does not require an audit; this is purely about producing a label and notifications.

```bash
# Trigger an audit. Returns immediately at status: "running".
nyxid proxy request ornn-api "/api/v1/skills/<idOrName>/audit" \
  --method POST \
  --data '{"force":false}' \
  --output json

# Poll until it leaves "running".
while true; do
  STATUS=$(nyxid proxy request ornn-api \
    "/api/v1/skills/<idOrName>/audit/history" \
    --method GET --output json \
    | jq -r '.data.items[0].status')
  [ "$STATUS" != "running" ] && break
  sleep 5
done

# Read the verdict.
nyxid proxy request ornn-api "/api/v1/skills/<idOrName>/audit" \
  --method GET --output json
```

Pass `"force": true` if you want to bypass the 30-day cache (re-audit even if the same skill bytes were just scored).

### 3.9 React to an audit-risk notification

**When:** you received an `audit.risky_for_consumer` notification for a skill someone shared with you, and you want to inspect the findings before continuing to use it.

```bash
# 1. Get the unread notifications.
nyxid proxy request ornn-api "/api/v1/notifications?unread=true&limit=50" \
  --method GET --output json

# 2. The notification's link points at /skills/<idOrName>/audits?version=<v>.
#    Pull the audit history for that version.
nyxid proxy request ornn-api "/api/v1/skills/<idOrName>/audit/history?version=<v>" \
  --method GET --output json

# 3. Mark the notification read.
nyxid proxy request ornn-api "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json
```

Consumers cannot self-revoke today — if you decide to stop using a skill, ask the owner to drop you from `sharedWithUsers` or to unshare the org you are in.

### 3.10 Diff two versions

**When:** you want to see what changed between v1.2 and v1.3 before consuming a new release.

```bash
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/versions/1.2/diff/1.3" \
  --method GET --output json
```

Response shape: `{ skill, from, to, diff: { added, removed, modified: [{ path, before, after }] } }` — file-level, with full content of modified files so the caller can render a unified diff locally.

### 3.11 Run a skill in the playground *(SSE)*

**When:** you want to test a skill end-to-end with real inputs, including script execution in the chrono-sandbox.

```bash
nyxid proxy request ornn-api "/api/v1/playground/chat" \
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

The backend runs a server-side tool-use loop (up to 5 rounds): when the LLM emits a `function_call` to `execute_script` or `skill_search`, Ornn auto-executes it (no client approval), feeds the result back, and keeps streaming. From the agent's side this looks like one call with a chunked response. For runtime-based skills, watch for `tool-call` with `name: "execute_script"` and the matching `tool-result` — that is the sandbox run.

### 3.12 See analytics for a skill

```bash
# Execution summary across all versions.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/analytics?window=30d" \
  --method GET --output json

# Same, narrowed to one version.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/analytics?window=30d&version=1.2" \
  --method GET --output json

# Pull time-series — last 7 days bucketed by day.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=day" \
  --method GET --output json

# Custom range, hourly buckets, single version.
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/analytics/pulls?bucket=hour&from=2026-04-20T00:00:00Z&to=2026-04-21T00:00:00Z&version=1.2" \
  --method GET --output json
```

`window` values: `7d`, `30d`, `all`. `bucket` values: `hour`, `day`, `month`. Anonymous callers only see analytics for public skills.

### 3.13 Handle your notifications

```bash
# Cheap unread badge — poll this for indicators.
nyxid proxy request ornn-api "/api/v1/notifications/unread-count" \
  --method GET --output json

# Fetch unread notifications.
nyxid proxy request ornn-api "/api/v1/notifications?unread=true&limit=50" \
  --method GET --output json

# Mark a single one read.
nyxid proxy request ornn-api "/api/v1/notifications/<id>/read" \
  --method POST --data '{}' --output json

# Or flush the inbox.
nyxid proxy request ornn-api "/api/v1/notifications/mark-all-read" \
  --method POST --data '{}' --output json
```

Two notification categories are emitted today (`audit.completed`, `audit.risky_for_consumer`) — full table in `references/api-reference.md`.

### 3.14 Delete a non-latest version

**When:** an old version is broken or superseded; you want to prune storage without nuking the whole skill.

```bash
# Cannot delete the only remaining version (delete the whole skill instead)
# or the current latest version (publish a newer one first).
nyxid proxy request ornn-api \
  "/api/v1/skills/<idOrName>/versions/<X.Y>" \
  --method DELETE --output json
```

### 3.15 Tie a skill to a NyxID service *(system / personal)*

**When:** you want to mark a skill as either a platform-wide *system skill* (admin tier) or attach it to one of your personal NyxID services. The tie is a separate axis from sharing — privacy and ACL are managed via §3.6.

```bash
# 1. List the services you can tie to. Each row carries a tier:
#    "admin"    — platform-wide; tying forces the skill public.
#    "personal" — yours; tying does not change privacy.
nyxid proxy request ornn-api "/api/v1/me/nyxid-services" \
  --method GET --output json

# 2. Tie. Tying to an admin service flips `isPrivate: false` atomically.
nyxid proxy request ornn-api "/api/v1/skills/<id>/nyxid-service" \
  --method PUT \
  --data '{"nyxidServiceId":"<service-id>"}' \
  --output json

# 3. Untie. Leaves `isPrivate` alone.
nyxid proxy request ornn-api "/api/v1/skills/<id>/nyxid-service" \
  --method PUT \
  --data '{"nyxidServiceId":null}' \
  --output json
```

A skill marked `isSystemSkill: true` cannot be flipped back to private without first untying — `PUT /skills/:id/permissions` with `isPrivate: true` is rejected with `SYSTEM_SKILL_MUST_BE_PUBLIC`. Run step 3 first.

To list every skill tied to a given service:

```bash
nyxid proxy request ornn-api \
  "/api/v1/nyxid-services/<service-id>/skills?page=1&pageSize=20" \
  --method GET --output json
```

For admin (system) services, every authenticated caller can browse the list; for personal services, only the service owner (or platform admin) sees results.

To filter the registry to **only** system skills (or to exclude them):

```bash
nyxid proxy request ornn-api \
  "/api/v1/skill-search?systemFilter=only&scope=public" \
  --method GET --output json
# Or systemFilter=exclude to hide them.
```

### 3.16 Hard-delete a skill

**When:** you no longer want the skill to exist in any form.

```bash
nyxid proxy request ornn-api "/api/v1/skills/<id>" \
  --method DELETE --output json
```

This is destructive: it removes the skill record, all version records, and the storage objects. Subsequent `GET /skills/<id>` returns `404 SKILL_NOT_FOUND`. There is no undelete.

---

## §4. Conventions & Pitfalls

- **Path prefix is `/api/v1/`** — every example in this manual includes it. Dropping `/v1/` returns 404 (there is no implicit redirect).
- **Anonymous calls are rare.** `/skill-format/rules` and the public slice of `/skill-search` are the main ones. Everywhere else, `nyxid login` first.
- **ZIPs must have exactly one root folder**, named after the skill (`my-skill/SKILL.md`, not a flat `SKILL.md` at the archive root). Validation rejects either mistake.
- **Version pinning** on `GET /skills/:idOrName?version=<X.Y>` accepts `<major>.<minor>` semver — it matches the version strings in `SKILL.md` frontmatter.
- **Skill name vs guid.** Most GETs accept either; writes (`PUT /skills/:id`, `DELETE /skills/:id`, `PUT /skills/:id/permissions`) require the guid. `POST /skills` returns the guid at creation; keep it for later writes.
- **Audit record statuses** (visible on `GET /audit/history`): `running`, `completed`, `failed`. Sharing is unconditional and does not depend on audit status; the audit verdict is purely informational.
- **Audit verdicts:** `green`, `yellow`, `red`. Only `yellow` / `red` triggers the consumer fan-out notification.
- **404 on read but 403 on write.** If a private skill is hidden from you, `GET` returns 404 (not 403) so the existence of the skill is not leaked. Writes use 403 when you are authed but lack ownership / admin.
- **Identical SSE keepalives across endpoints.** Both `/skills/generate*` and `/playground/chat` emit `event: keepalive` heartbeats; ignore them.
- **Anonymous calls and visibility.** Anonymous callers querying any skill-scoped read endpoint receive 404 for private skills (never 403) and only the `public` scope on search.
- **`X-Request-ID`** is set on every response. Capture it when reporting failures — it correlates with the server log line that produced the error.

---

## §5. References & further reading

- `references/api-reference.md` — exhaustive per-endpoint catalogue: every method + path, request body schema, response shape, all error codes with HTTP mapping, auth + authorization rules. Pull this into context whenever you need the full contract for an endpoint.
- `GET /api/v1/skill-format/rules` — canonical skill package format spec, always up-to-date with what the validator enforces.
- `GET /api/v1/openapi.json` — auto-generated OpenAPI 3 schema. Every endpoint above is in here with full Zod-derived request/response types.
- `GET /api/v1/me` — reads your current identity snapshot (userId, email, displayName, roles, permissions). Useful when debugging a 403.

If you find a discrepancy between this manual and the actual API behaviour, the API is right and the manual is stale — re-pull the skill (§0) before assuming a bug.
