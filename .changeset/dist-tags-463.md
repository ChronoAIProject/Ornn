---
"ornn-api": minor
---

Add dist-tags for skill versions (#463). Lets callers pin to a stable channel without enumerating versions or hard-coding numbers, matching the shape npm / yarn / pnpm exposes.

**New surface**

```http
GET    /api/v1/skills/{idOrName}/dist-tags           → { tags: { latest, stable, ... } }
PUT    /api/v1/skills/{id}/dist-tags/{tag}           Body: { version }
DELETE /api/v1/skills/{id}/dist-tags/{tag}
GET    /api/v1/skills/{idOrName}?version=@stable     → resolves via dist-tag
```

`SkillDetailResponse` now carries a `distTags` field on every read.

**Semantics**

- `latest` is **auto-managed**. Every successful publish sets `distTags.latest = newVersion`. `PUT` / `DELETE` against `latest` return 400 `dist_tag_immutable`.
- Custom tags (`stable`, `beta`, `rc-1`, ...) are owner-managed. Tag names match `/^[a-z][a-z0-9-]{0,49}$/` — npm rules, leading letter required so tags don't look like version numbers.
- Setting a tag for a non-existent version returns 404 `skill_version_not_found`.
- `?version=@latest` falls back to `skill.latestVersion` on legacy skills predating this PR so the resolution path stays compatible.

**Out of scope**

- TS / Python SDK helper methods around dist-tags — the endpoints work directly via the raw client. SDK convenience wrappers ride in a follow-up so this PR stays scoped.
- OpenAPI spec entries for the new paths — `/api/v1/openapi.json` is already incomplete for `/skills/:id/*` write paths; the bigger contract-test pass in #462 will pick all of them up at once.
- schemastore-style schema for the dist-tag write body (not visible in any IDE flow today).
