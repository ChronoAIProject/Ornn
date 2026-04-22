---
"ornn-api": patch
---

Epic 1: skill-\* domain merge + activity → me move (part of #66).

**Domain layout — before → after**
```
domains/skillCrud/       →  domains/skills/crud/
domains/skillSearch/     →  domains/skills/search/
domains/skillFormat/     →  domains/skills/format/
domains/skillGeneration/ →  domains/skills/generation/
```

Four verb-oriented sibling domains are now one resource-oriented `skills/` domain with four submodules. Matches convention §11.4. No external `/api/*` path change.

**Caller telemetry endpoints**

`POST /activity/login` and `POST /activity/logout` moved from `domains/admin/routes.ts` to `domains/me/routes.ts`. They were never admin operations — any authenticated user logs their own session events. The `admin` domain now only exposes `/admin/*` (admin-only permission-gated routes). Path unchanged.

**Mechanical import updates**

- `bootstrap.ts`: 9 import paths updated to the new `domains/skills/*` layout.
- Cross-domain imports (from `me/`, `admin/`, `playground/chatService.ts`): `../skillCrud/*` → `../skills/crud/*`.
- Intra-skills sibling imports: `../skillCrud/*` → `../crud/*`.
- Every relative import inside `skills/*` that escapes the module gained one `../` (path depth increased by one).
- `@module` JSDoc comments updated to the new paths.

All 136 backend tests pass. Backend typecheck: 13 pre-existing errors (unchanged). Web typecheck + lint green.
