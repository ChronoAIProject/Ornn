# API Reference — Skill Audit

Audit verdicts are computed asynchronously and stored per-version. Verdicts are advisory: they appear on the skill detail UI, drive consumer notifications when risky, but never block sharing or use.

## `GET /api/v1/skills/:idOrName/audit`

**Most recent completed audit for the version (cache hit; never triggers).**

> **Auth optional.** Visibility rules apply.

### Query

| Param | Type | Notes |
|---|---|---|
| `version` | string | `<major>.<minor>`; defaults to latest |

### Response 200

```jsonc
{
  "data": {
    "_id": "01J...",
    "skillGuid": "...",
    "version": "0.1",
    "status": "completed",
    "verdict": "green",
    "overallScore": 7.8,
    "scores": [ { "dimension": "security", "score": 8, "rationale": "..." } ],
    "findings": [ { "severity": "info", "dimension": "documentation", "message": "...", "file": "SKILL.md", "line": 12 } ],
    "completedAt": "...",
    "triggeredBy": "<userId>"
  },
  "error": null
}
```

`verdict` is one of `green`, `yellow`, `red`. `status` is one of `running`, `completed`, `failed` — only `completed` rows are surfaced here. `findings[*].severity` is `info` / `warning` / `critical`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | — |
| 404 | `AUDIT_NOT_FOUND` | No completed audit for that (skill, version) |

---

## `GET /api/v1/skills/:idOrName/audit/summary-by-version`

**Latest completed audit per version (powers per-version badges).**

> **Auth optional.** Visibility rules apply.

### Response 200

```jsonc
{
  "data": {
    "byVersion": {
      "0.1": { "verdict": "green", "overallScore": 7.8, "completedAt": "...", "status": "completed" },
      "0.2": { "verdict": "yellow", "overallScore": 6.2, "completedAt": "...", "status": "completed" }
    }
  },
  "error": null
}
```

Versions without a completed audit are absent from the map.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | — |

---

## `GET /api/v1/skills/:idOrName/audit/history`

**All audit records, newest first. Optionally narrow to a single version.**

> **Auth optional.** Visibility rules apply.

### Query

| Param | Type | Notes |
|---|---|---|
| `version` | string | Narrow to one version |

### Response 200

```jsonc
{
  "data": {
    "items": [
      { "_id": "...", "version": "0.2", "status": "completed", "verdict": "yellow", "overallScore": 6.2 },
      { "_id": "...", "version": "0.1", "status": "completed", "verdict": "green" }
    ]
  },
  "error": null
}
```

`running` rows are included so the UI can render in-flight badges.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | — |

---

## `POST /api/v1/skills/:idOrName/audit`

**Owner-triggered audit (Start Auditing).**

> **Auth required.** Owner-or-admin only. Ownership is the gate; no permission string required.

Returns immediately with the `running` row; clients poll `audit/history` (or wait for the `audit.completed` notification).

### Request body

```jsonc
{ "force": false }
```

| Field | Type | Notes |
|---|---|---|
| `force` | boolean | Bypass the 30-day same-bytes cache |

### Response 200

Initial running record:

```jsonc
{
  "data": {
    "_id": "...",
    "skillGuid": "...",
    "version": "0.1",
    "status": "running",
    "triggeredBy": "<userId>"
  },
  "error": null
}
```

If the cache is hit (`force=false` and a completed audit exists with the same skill hash within TTL) the existing record is returned with `status: "completed"`.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Not author and not admin |
| 404 | `SKILL_NOT_FOUND` | — |

---

## `POST /api/v1/admin/skills/:idOrName/audit`

**Force-rerun audit as platform admin (bypasses ownership).**

> **Auth required.** Permission: `ornn:admin:skill`.

Same body / response shape as the owner endpoint. `force: true` is honoured.
