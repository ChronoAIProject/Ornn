# API Reference — Me / Caller scope

Every route below requires authentication. There is no permission gate beyond identity.

## `GET /api/v1/me`

**Snapshot of the authenticated caller.**

```jsonc
{
  "data": {
    "userId": "<sub>",
    "email": "<email>",
    "displayName": "<name>",
    "roles": ["ornn-user"],
    "permissions": ["ornn:skill:read", "ornn:skill:create", "ornn:playground:use"]
  },
  "error": null
}
```

No errors.

---

## `POST /api/v1/activity/login`

**Record a session-opened event.**

> **Auth required.** Fire-and-forget from the frontend after the OAuth callback completes.

```json
{ "data": { "success": true }, "error": null }
```

Activity logged: `login`.

---

## `POST /api/v1/activity/logout`

**Record a session-closed event.**

> **Auth required.** Called by the frontend before clearing local auth state.

```json
{ "data": { "success": true }, "error": null }
```

Activity logged: `logout`.

---

## `GET /api/v1/me/orgs`

**Caller's NyxID org memberships (admin + member roles only).**

> **Auth required.**

```jsonc
{
  "data": {
    "items": [
      { "userId": "<orgId>", "role": "admin", "displayName": "Acme Corp" }
    ]
  },
  "error": null
}
```

Fail-soft: NyxID outage returns `items: []` rather than 5xx. Diagnosis: response duration ≈ 0 ms is the giveaway.

No errors.

---

## `GET /api/v1/me/orgs/:orgId`

**Resolve a single org (useful even after the caller leaves it).**

> **Auth required.**

```jsonc
{
  "data": { "userId": "<orgId>", "displayName": "Acme Corp", "avatarUrl": "https://..." },
  "error": null
}
```

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `ORG_NOT_FOUND` | NyxID does not return that org or the caller cannot resolve it |

---

## `GET /api/v1/me/nyxid-services`

**Caller's NyxID user-services (personal + org-inherited).**

> **Auth required.**

Used to power the system-skill filter on the registry.

```jsonc
{
  "data": { "items": [ { "id": "...", "slug": "ornn-api", "label": "ornn-api" } ] },
  "error": null
}
```

Fail-soft: returns `items: []` when NyxID is unreachable or no proxy token is set.

---

## `GET /api/v1/me/skills/grants-summary`

**Caller's outbound shares — orgs and users they've granted access to.**

> **Auth required.**

```jsonc
{
  "data": {
    "orgs":  [ { "id": "<orgId>", "displayName": "Acme",     "skillCount": 5 } ],
    "users": [ { "userId": "<userId>", "email": "...", "displayName": "...", "skillCount": 2 } ]
  },
  "error": null
}
```

Display names are best-effort: orgs resolved via NyxID, users via Ornn activity directory; missing values fall back to the raw id.

---

## `GET /api/v1/me/shared-skills/sources-summary`

**Caller's inbound shares — orgs and users that have granted them access.**

> **Auth required.**

Same shape as `grants-summary`. `orgs` are bridge memberships (orgs caller is in where someone has shared a skill); `users` are authors who shared directly.
