# API Reference — Admin

Mounted under `/api/v1/admin`. Most endpoints require `ornn:admin:skill`. Category endpoints require `ornn:admin:category`.

## `GET /api/v1/admin/stats`

**Platform-wide totals for the dashboard.**

> **Auth required.** Permission: `ornn:admin:skill`.

```jsonc
{
  "data": {
    "totalSkills": 42,
    "totalUsers": 15,
    "totalActivities": 1234,
    "skillsByCategory": { "plain": 10, "tool-based": 15, "runtime-based": 12, "mixed": 5 }
  },
  "error": null
}
```

No errors.

---

## `GET /api/v1/admin/activities`

**Paginated activity log.**

> **Auth required.** Permission: `ornn:admin:skill`.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | — |
| `pageSize` | int 1–100 | `20` | — |
| `action` | activity action | — | Filter (see Appendix B in original API doc) |
| `userId` | string | — | Filter by actor |

### Response 200

```jsonc
{
  "data": {
    "items": [
      {
        "id": "...",
        "userId": "...",
        "userEmail": "...",
        "userDisplayName": "...",
        "action": "skill:create",
        "details": { "skillId": "...", "skillName": "ornn-api" },
        "createdAt": "..."
      }
    ],
    "total": 1234,
    "page": 1,
    "pageSize": 20,
    "totalPages": 62
  },
  "error": null
}
```

No errors.

---

## `GET /api/v1/admin/users`

**Paginated user directory (aggregated from activities).**

> **Auth required.** Permission: `ornn:admin:skill`.

### Query

| Param | Type | Default |
|---|---|---|
| `page` | int ≥ 1 | `1` |
| `pageSize` | int 1–100 | `20` |

### Response 200

```jsonc
{
  "data": {
    "items": [
      { "userId": "...", "email": "...", "displayName": "...", "skillCount": 5, "lastActivityAt": "..." }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "error": null
}
```

No errors.

---

## `GET /api/v1/admin/skills`

**Registry-wide skill browser. Admins see every skill, public or private, regardless of authorship.**

> **Auth required.** Permission: `ornn:admin:skill`.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | `1` | — |
| `pageSize` | int 1–100 | `20` | — |
| `q` | string | — | Search by name / description |
| `userId` | string | — | Filter by author |

### Response 200

```jsonc
{
  "data": {
    "items": [ /* SkillSummary[] with createdByEmail / createdByDisplayName populated */ ],
    "total": 42, "page": 1, "pageSize": 20, "totalPages": 3
  },
  "error": null
}
```

No errors.

---

## `DELETE /api/v1/admin/skills/:id`

**Force-delete any skill (no ownership check).**

> **Auth required.** Permission: `ornn:admin:skill`.

### Response 200

```json
{ "data": { "success": true }, "error": null }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `SKILL_NOT_FOUND` | — |

Activity logged: `skill:delete` with `details.adminAction = true`.

---

## `GET /api/v1/admin/categories`

**List all skill categories.**

> **Auth required.** Permission: `ornn:admin:category`.

```jsonc
{
  "data": [
    { "id": "...", "name": "plain", "slug": "plain", "description": "Pure prompts", "order": 0 }
  ],
  "error": null
}
```

No errors.

---

## `POST /api/v1/admin/categories`

**Create a category.**

> **Auth required.** Permission: `ornn:admin:category`.

### Request body

```jsonc
{ "name": "plain", "slug": "plain", "description": "...", "order": 0 }
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | One of `plain`, `tool-based`, `runtime-based`, `mixed` |
| `slug` | yes | Kebab-case |
| `description` | yes | — |
| `order` | no | Default 0 |

### Response 201

The created category document.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body validation failed |

---

## `PUT /api/v1/admin/categories/:id`

**Patch category metadata. `name` and `slug` are immutable.**

> **Auth required.** Permission: `ornn:admin:category`.

### Request body

```jsonc
{ "description": "Updated", "order": 1 }
```

Both fields optional.

### Response 200

Updated category.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `CATEGORY_NOT_FOUND` | — |
| 400 | `VALIDATION_ERROR` | — |

---

## `DELETE /api/v1/admin/categories/:id`

**Delete a category.**

> **Auth required.** Permission: `ornn:admin:category`.

```json
{ "data": { "success": true }, "error": null }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `CATEGORY_NOT_FOUND` | — |

---

## `GET /api/v1/admin/tags`

**List skill tags.**

> **Auth required.** Permission: `ornn:admin:skill`.

### Query

| Param | Type | Notes |
|---|---|---|
| `type` | `predefined` \| `custom` | Optional filter |

```jsonc
{ "data": [ { "id": "...", "name": "api", "type": "predefined" } ], "error": null }
```

No errors.

---

## `POST /api/v1/admin/tags`

**Create a custom tag.**

> **Auth required.** Permission: `ornn:admin:skill`.

### Request body

```jsonc
{ "name": "agent" }
```

`name` is ≤ 30 chars, lowercase alphanumerics with `-` / `_`.

### Response 201

Created tag document.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | — |
| 409 | `TAG_EXISTS` | Tag with that name already exists |

---

## `DELETE /api/v1/admin/tags/:id`

**Delete a tag.**

> **Auth required.** Permission: `ornn:admin:skill`.

```json
{ "data": { "success": true }, "error": null }
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `TAG_NOT_FOUND` | — |
