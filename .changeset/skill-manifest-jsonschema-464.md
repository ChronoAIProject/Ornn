---
"ornn-api": minor
---

Publish JSON Schema for `SKILL.md` frontmatter (#464). New endpoint:

```
GET /api/v1/skill-manifest-schema.json
```

- Generated from the Zod source of truth (`shared/schemas/skillFrontmatter.ts`) so the published contract cannot drift from the runtime validator.
- Output is JSON Schema **draft-2020-12**, served with `Content-Type: application/schema+json`.
- Public, no auth, `Cache-Control: public, max-age=3600`.

Lets VS Code / Cursor / JetBrains YAML language servers autocomplete + validate `SKILL.md` frontmatter directly against the live server contract. Schema-store registration (`schemastore.org`) is a separate, one-time external action.

The OpenAPI spec at `GET /api/v1/openapi.json` lists the new path so contract tests pick it up. Documented in `docs/CONVENTIONS.md` §10.1.
