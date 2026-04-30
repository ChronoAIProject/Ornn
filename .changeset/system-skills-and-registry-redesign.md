---
"ornn-api": minor
"ornn-web": minor
---

System skills + registry redesign:

- **Skill ↔ NyxID-service tie.** A skill can be linked to a NyxID catalog service via `PUT /api/v1/skills/:id/nyxid-service`. Tying to an admin-tier service (`visibility: "public"` in NyxID) marks the skill `isSystemSkill: true` and atomically forces `isPrivate: false`. Personal-tier ties leave privacy alone. New `GET /api/v1/nyxid-services/:serviceId/skills` reverse-lookup. `GET /api/v1/me/nyxid-services` redefined to return catalog rows with a `tier` field. New `SYSTEM_SKILL_MUST_BE_PUBLIC` invariant blocks `PUT /skills/:id/permissions` and `PUT /skills/:id` from flipping a system skill private.
- **Registry redesign.** New "System Skills" tab (default landing). Two-column layout per tab: search bar up top, sidebar filter chips on the left, cards on the right. Per-tab filters: System → service; Public → tags + authors; My Skills → tags + grant-orgs + grant-users; Shared with me → source-orgs + source-users. All filter state URL-encoded.
- **New facet endpoints.** `/skill-facets/tags?scope=...`, `/skill-facets/authors?scope=...`, `/skill-facets/system-services` aggregate visibility-scoped chip data.
- **Search params extended.** `/skill-search` now accepts `nyxidServiceId` (single id) and `tags` (CSV, AND-match).
- **Skill detail polish.** New NyxID-service tie card + modal next to permissions. Skill content section capped at `min(80vh, viewport-140px)` with internal scroll. "Skill pulls" chart renamed to "Skill Usage", switched from stacked bars to multi-line, fixed canned windows (24h / 7d / 12mo) with full bucket padding, recolored to the editorial-forge palette.
- **Docs become a system skill.** The `agent-manual.md` + 14 `api-*.md` docs-site pages are deleted. Their content is republished as the `ornn-agent-manual` Ornn skill (source at `skills/ornn-agent-manual/`, `SKILL.md` + `references/api-reference.md`, v2.2). Pull it via `GET /api/v1/skills/ornn-agent-manual/json`.
