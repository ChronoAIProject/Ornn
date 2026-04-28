# API Reference — Users Directory

These routes are scoped to users who have interacted with Ornn (have at least one row in the `activities` collection). They never query NyxID's full user directory.

## `GET /api/v1/users/search`

**Email-prefix typeahead. Powers the permissions modal user picker.**

> **Auth required.**

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string ≤ 256 | `""` | Search prefix |
| `limit` | int 1–50 | `10` | — |

### Response 200

```jsonc
{
  "data": {
    "items": [
      { "userId": "<userId>", "email": "alice@example.com", "displayName": "Alice" }
    ]
  },
  "error": null
}
```

No errors.

---

## `GET /api/v1/users/resolve`

**Batch-resolve user IDs to email + displayName.**

> **Auth required.**

### Query

| Param | Type | Notes |
|---|---|---|
| `ids` | CSV of user IDs | ≤ 100 entries |

### Response 200

```jsonc
{
  "data": {
    "items": [
      { "userId": "<userId>", "email": "alice@example.com", "displayName": "Alice" }
    ]
  },
  "error": null
}
```

Unknown IDs are silently dropped (consumers fall back to rendering the raw id).

No errors.
