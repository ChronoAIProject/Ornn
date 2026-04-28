# API Reference — Skill Format

## `GET /api/v1/skill-format/rules`

**Canonical SKILL.md / package format spec, in Markdown.**

> **Auth: anonymous.**

### Response 200

```json
{ "data": { "rules": "# Skill format\n\n..." }, "error": null }
```

No errors.

---

## `POST /api/v1/skill-format/validate`

**Validate a ZIP without uploading it.**

> **Auth required.** Permission: `ornn:skill:read`.

### Request

| In | Header / Body | Notes |
|---|---|---|
| Header | `Content-Type: application/zip` (or `application/octet-stream`) | Required |
| Body | binary ZIP | Required |

### Response 200 (valid)

```json
{ "data": { "valid": true }, "error": null }
```

### Response 200 (invalid — not an HTTP error)

```jsonc
{
  "data": {
    "valid": false,
    "violations": [
      { "rule": "FRONTMATTER_VALIDATION_FAILED", "message": "name must not contain 'claude'" }
    ]
  },
  "error": null
}
```

This intentionally returns 200; validation failures are content, not faults.

### Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_CONTENT_TYPE` | — |
| 400 | `EMPTY_BODY` | — |
| 401 | `AUTH_MISSING` | — |
| 403 | `FORBIDDEN` | Missing `ornn:skill:read` |
