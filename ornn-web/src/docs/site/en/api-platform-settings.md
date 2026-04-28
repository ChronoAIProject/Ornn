# API Reference — Platform Settings

## `GET /api/v1/admin/settings`

**Read platform-wide settings.**

> **Auth required.** Permission: `ornn:admin:skill`.

```jsonc
{
  "data": {
    "auditWaiverThreshold": 5.5
  },
  "error": null
}
```

`auditWaiverThreshold` is a 0–10 floating-point value retained from the previous audit-gated share design. It currently has no functional effect (sharing is unconditional); the field is preserved so we can re-introduce a threshold-based UX later without a migration.

No errors.

---

## `PATCH /api/v1/admin/settings`

**Patch platform-wide settings.**

> **Auth required.** Permission: `ornn:admin:skill`.

### Request body

```jsonc
{ "auditWaiverThreshold": 5.5 }
```

Partial patch — only the keys you supply are written. Numbers are clamped to `[0, 10]` and rounded to 0.1.

### Response 200

Updated settings object.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_SETTING` | Unknown field or value out of range |
