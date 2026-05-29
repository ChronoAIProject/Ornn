---
"ornn-api": patch
---

Sweep the `c.req.json().catch(() => ({}))` bypass pattern across ornn-api routes (#438). Every state-changing endpoint that previously parsed JSON manually now flows through the `validateBody(schema, code)` middleware so malformed bodies surface as RFC 7807 `400 invalid_body` instead of silently coercing to `{}` and bypassing schema validation.

Affected:
- `skills/crud/routes` — `POST /skills/pull`, `POST /skills/:id/refresh`, `PUT /skills/:id/source`, JSON branch of `PUT /skills/:id`
- `skills/audit/routes` — both audit-trigger endpoints (owner + admin)
- `skills/generation/routes` — `POST /skills/generate/from-source`, `POST /skills/generate/from-openapi`, JSON branch of `POST /skills/generate`
- `skills/mirror/routes` — `POST /github/repo`
- `announcements/routes` — admin create + patch
- `broadcasts/routes` — admin create + patch
- `settings/routes` — every per-section `PUT`
- `settings/llmProviders/routes` — provider create / update / model patch
- `settings/exportImport/routes` — `POST /admin/settings/import`
- `platform/routes` — `PATCH /admin/settings`

`validateBody` is also taught to tolerate an empty body (treats it as `{}`) when the schema has no required fields — that's the spot the bypass pattern was covering, and removing it without that tolerance would break the `POST /skills/:id/refresh`-with-no-body case the SPA uses.

Endpoints with rich per-field validation that's hard to express in Zod (mirror config, platform settings) get a thin gate (`z.record(z.string(), z.unknown())`) so the SyntaxError path is covered, while leaving the existing field checks in place. Future PRs can swap those for full schemas without changing the wire contract.
