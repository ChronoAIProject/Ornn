# API Reference — Skills CRUD

Mounted under `/api/v1/skills`. The skill package is a ZIP whose root folder contains a `SKILL.md` and any number of supporting files. The platform models each upload as a *new version* of a stable skill identity (`guid`).

> Auth model + permission catalogue + visibility rules: see **API Reference — Overview & Conventions**.

## `POST /api/v1/skills`

**Upload a new skill (binary ZIP).**

> **Auth required.** Permission: `ornn:skill:create`. New skills are created **private** by default.

### Request

| In | Header / Param | Type | Notes |
|---|---|---|---|
| Header | `Content-Type` | string | One of `application/zip`, `application/octet-stream`, or `multipart/form-data` |
| Query | `skip_validation` | `"true"` (optional) | Skip skill-format validation when set; default false |
| Body | binary | `application/zip` payload | The skill package ZIP |

For multipart uploads, the file field is `package`.

### Response 201

```jsonc
{
  "data": {
    "guid": "01J7...",
    "name": "ornn-api",
    "description": "...",
    "version": "0.1",
    "isPrivate": true,
    "isDeprecated": false,
    "deprecationNote": null,
    "createdBy": "<userId>",
    "createdOn": "2026-04-14T18:59:00.000Z",
    "updatedOn": "2026-04-14T18:59:00.000Z",
    "sharedWithUsers": [],
    "sharedWithOrgs": [],
    "storageKey": "skills/<guid>/<version>.zip",
    "skillHash": "sha256:..."
  },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_CONTENT_TYPE` | Content-Type missing or unsupported |
| 400 | `EMPTY_BODY` | Body bytes were empty |
| 400 | `VALIDATION_ERROR` | ZIP failed format validation (`error.message` lists violations) |
| 401 | `AUTH_MISSING` | Caller has no NyxID identity |
| 403 | `FORBIDDEN` | Missing `ornn:skill:create` |
| 413 | `PAYLOAD_TOO_LARGE` | ZIP exceeds size cap |

Activity logged: `skill:create`.

---

## `POST /api/v1/skills/pull`

**Create a skill from a public GitHub repo.**

> **Auth required.** Permission: `ornn:skill:create`. Pulled skills retain the GitHub source pointer for later refresh.

### Request body (`application/json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `repo` | string | yes | `owner/name` |
| `ref` | string | no | Branch / tag / commit; default `HEAD` |
| `path` | string | no | Subdirectory inside the repo to package |
| `skip_validation` | boolean | no | Mirror of the query flag on direct upload |

### Response 201

Same shape as `POST /skills`. The skill record additionally carries a `source` object:

```jsonc
{ "type": "github", "repo": "<owner/name>", "ref": "<ref>", "path": "<path>", "commit": "<sha>" }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `MISSING_REPO` | `repo` empty or absent |
| 400 | `INVALID_BODY` | Body not JSON |
| 400 | `VALIDATION_ERROR` | Pulled package failed format validation |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:create` |
| 502 | `PULL_FAILED` | GitHub fetch / clone / build failed |

Activity logged: `skill:create` with `details.source = "github-pull"`.

---

## `POST /api/v1/skills/:id/refresh`

**Re-pull a GitHub-sourced skill at the latest commit (publishes a new version).**

> **Auth required.** Permission: `ornn:skill:update` plus **owner-or-admin** ownership check.

### Path

| Param | Type | Notes |
|---|---|---|
| `id` | string | Skill GUID. Name is **not** accepted on this endpoint. |

### Response 200

Updated skill document (latest version after re-pull).

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Caller is not the author and not a platform admin |
| 404 | `SKILL_NOT_FOUND` | Skill GUID unknown |
| 409 | `NOT_GITHUB_SOURCED` | Skill was not created via `/skills/pull` |
| 502 | `PULL_FAILED` | Re-pull failed |

Activity logged: `skill:refresh` with `details.commit`.

---

## `GET /api/v1/skills/:idOrName`

**Fetch one skill, optionally pinned to a version.**

> **Auth optional.** Visibility rules apply (see Overview).

### Path & Query

| Param | In | Type | Notes |
|---|---|---|---|
| `idOrName` | path | string | Skill GUID or kebab-case name |
| `version` | query | string | `<major>.<minor>`; defaults to latest |

### Response 200

```jsonc
{
  "data": {
    "guid": "01J7...",
    "name": "ornn-api",
    "description": "...",
    "version": "0.1",
    "isPrivate": true,
    "isDeprecated": false,
    "deprecationNote": null,
    "createdBy": "<userId>",
    "createdByEmail": "<email>",
    "createdByDisplayName": "<display name>",
    "createdOn": "...",
    "updatedOn": "...",
    "sharedWithUsers": [],
    "sharedWithOrgs": [],
    "tags": ["api", "ornn"],
    "metadata": { "category": "plain" },
    "storageKey": "skills/<guid>/<version>.zip",
    "skillHash": "sha256:...",
    "presignedPackageUrl": "https://..."
  },
  "error": null
}
```

### Response headers (deprecation)

| Header | When |
|---|---|
| `X-Skill-Deprecated: true` | The version returned is deprecated |
| `X-Skill-Deprecation-Note: <urlencoded note>` | A deprecation note exists |

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | Unknown name/guid OR caller cannot see this skill |

Side effect: emits a `pull` analytics event with `source = "web"` (fire-and-forget).

---

## `GET /api/v1/skills/:idOrName/json`

**Fetch the full skill package as JSON (decoded UTF-8 file map).**

> **Auth required.** Permission: `ornn:skill:read`. Visibility rules apply.

This is the agent-friendly path: instead of a presigned ZIP URL, you get the whole package back as `{ files: [{ path, content }] }` so an agent can inject files into context directly.

### Response 200

```jsonc
{
  "data": {
    "name": "ornn-api",
    "version": "0.1",
    "files": [
      { "path": "SKILL.md", "content": "---\nname: ornn-api\n..." },
      { "path": "scripts/run.py", "content": "..." }
    ]
  },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:read` |
| 404 | `SKILL_NOT_FOUND` | — |

Side effect: `pull` analytics event with `source = "api"`.

---

## `GET /api/v1/skills/:idOrName/versions`

**List all published versions, newest first.**

> **Auth optional.** Visibility rules apply.

### Response 200

```jsonc
{
  "data": {
    "items": [
      {
        "version": "0.2",
        "isDeprecated": false,
        "deprecationNote": null,
        "createdBy": "<userId>",
        "createdByEmail": "...",
        "createdByDisplayName": "...",
        "createdOn": "...",
        "skillHash": "sha256:...",
        "storageKey": "skills/<guid>/0.2.zip"
      }
    ]
  },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | — |

---

## `GET /api/v1/skills/:idOrName/versions/:fromVersion/diff/:toVersion`

**Structured file-level diff between two versions.**

> **Auth optional.** Visibility rules apply.

### Response 200

```jsonc
{
  "data": {
    "fromVersion": "0.1",
    "toVersion": "0.2",
    "files": [
      { "path": "SKILL.md", "status": "modified", "fromContent": "...", "toContent": "..." },
      { "path": "scripts/new.py", "status": "added",    "fromContent": null, "toContent": "..." },
      { "path": "scripts/old.py", "status": "removed",  "fromContent": "...", "toContent": null }
    ]
  },
  "error": null
}
```

`status` is one of `added`, `removed`, `modified`. Both `fromContent` and `toContent` are full file text — clients render line-level diffs themselves.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | Skill or one of the versions unknown |

---

## `PATCH /api/v1/skills/:idOrName/versions/:version`

**Toggle deprecation flag on a single version.**

> **Auth required.** Permission: `ornn:skill:update` + owner-or-admin.

### Request body

```jsonc
{
  "isDeprecated": true,
  "deprecationNote": "Use 0.2+; this version mishandles JSON arrays."
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `isDeprecated` | boolean | yes | — |
| `deprecationNote` | string | no | ≤ 1024 chars |

### Response 200

The updated version row.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_DEPRECATION_PATCH` | Schema validation failed |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | Skill or version unknown |

Activity logged: `skill:update` with `details.deprecationChange = true`.

---

## `PUT /api/v1/skills/:id`

**Publish a new version of an existing skill, or flip its visibility, or both.**

> **Auth required.** Permission: `ornn:skill:update` + owner-or-admin. Path takes the **GUID only**.

This endpoint multiplexes by `Content-Type`:

| Content-Type | Body | Effect |
|---|---|---|
| `application/zip` / `application/octet-stream` | binary ZIP | New version |
| `multipart/form-data` | `package: <File>`, `isPrivate?: "true" \| "false"` | New version + optional visibility |
| `application/json` | `{ "isPrivate": boolean }` | Visibility-only |

Query `skip_validation=true` is honoured for ZIP uploads.

### Response 200

Updated skill document (same shape as `GET /skills/:idOrName`).

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_CONTENT_TYPE` | Unsupported MIME |
| 400 | `NO_UPDATE` | Neither ZIP nor `isPrivate` provided |
| 400 | `VALIDATION_ERROR` | ZIP failed format validation |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | Skill GUID unknown |
| 413 | `PAYLOAD_TOO_LARGE` | — |

Activity logged: `skill:update` (ZIP upload) or `skill:visibility_change` (visibility-only).

---

## `PUT /api/v1/skills/:id/permissions`

**Replace the sharing allow-list (and / or `isPrivate`).**

> **Auth required.** Permission: `ornn:skill:update` + owner-or-admin.
>
> **Sharing is unconditional.** The new state is applied immediately. There is no audit gate, no waiver, no reviewer.

### Request body

```jsonc
{
  "isPrivate": true,
  "sharedWithUsers": ["user_abc", "user_def"],
  "sharedWithOrgs": ["org_xyz"]
}
```

| Field | Type | Notes |
|---|---|---|
| `isPrivate` | boolean | Required |
| `sharedWithUsers` | string[] | ≤ 500 entries, each 1–128 chars |
| `sharedWithOrgs` | string[] | ≤ 100 entries, each 1–128 chars |

### Response 200

```jsonc
{
  "data": {
    "skill": { /* full SkillDetail, same shape as GET /skills/:idOrName */ }
  },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_PERMISSIONS` | Body schema validation failed |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | — |

Activity logged: `skill:permissions_change`.

If the resulting state is yellow / red on a fresh audit, the audit pipeline (separately) will fire `audit.risky_for_consumer` notifications. This endpoint itself never blocks.

---

## `DELETE /api/v1/skills/:id`

**Hard-delete a skill and every version.**

> **Auth required.** Permission: `ornn:skill:delete` + owner-or-admin.

### Response 200

```json
{ "data": { "success": true }, "error": null }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | — |

Activity logged: `skill:delete`.

---

## `DELETE /api/v1/skills/:idOrName/versions/:version`

**Delete one non-latest, non-only version.**

> **Auth required.** Permission: `ornn:skill:delete` + owner-or-admin.

Refuses to delete:

- the **only** remaining version (`ONLY_VERSION_DELETE_REFUSED`) — use `DELETE /skills/:id` instead;
- the **current latest** version (`LATEST_VERSION_DELETE_REFUSED`) — publish a newer version first.

### Response 200

```json
{ "data": { "success": true }, "error": null }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `LATEST_VERSION_DELETE_REFUSED` | Caller targeted the latest |
| 400 | `ONLY_VERSION_DELETE_REFUSED` | Caller targeted the sole remaining version |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | Skill or version unknown |

Activity logged: `skill:version_delete`.
