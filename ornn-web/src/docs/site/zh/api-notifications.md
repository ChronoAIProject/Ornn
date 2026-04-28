# API Reference — Notifications

All four endpoints are scoped to the caller's own notifications. There is no admin override.

## `GET /api/v1/notifications`

**List notifications, newest first.**

> **Auth required.** No specific permission; identity is the gate.

### Query

| Param | Type | Default | Notes |
|---|---|---|---|
| `unread` | `"true"` | — | Filter to unread only |
| `limit` | int 1–200 | `50` | — |

### Response 200

```jsonc
{
  "data": {
    "items": [
      {
        "_id": "...",
        "userId": "<self>",
        "category": "audit.completed",
        "title": "Skill audit passed — ornn-api v0.1 · score 7.8/10",
        "body": "...",
        "link": "/skills/<guid>/audits?version=0.1",
        "data": { "skillGuid": "...", "version": "0.1", "verdict": "green", "overallScore": 7.8 },
        "readAt": null,
        "createdAt": "..."
      }
    ]
  },
  "error": null
}
```

Two categories are emitted today:

| Category | Recipient | Trigger |
|---|---|---|
| `audit.completed` | Skill owner | Every audit completion |
| `audit.risky_for_consumer` | Every consumer of a `yellow` / `red` skill | Same audit completion; `green` skipped |

No errors.

---

## `GET /api/v1/notifications/unread-count`

**Badge count for the bell.**

> **Auth required.**

```json
{ "data": { "count": 5 }, "error": null }
```

No errors.

---

## `POST /api/v1/notifications/:id/read`

**Mark a single notification read.**

> **Auth required.** Caller must own the notification.

### Response 200

Updated notification document.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 404 | `NOTIFICATION_NOT_FOUND` | Unknown id or not the caller's |

---

## `POST /api/v1/notifications/mark-all-read`

**Mark every unread notification read.**

> **Auth required.**

### Response 200

```json
{ "data": { "updated": 5 }, "error": null }
```

No errors.
