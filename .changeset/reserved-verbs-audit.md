---
"ornn-api": patch
---

Reserved-verb enforcement + DB audit tooling (closes #69).

Epic 2's `/v1/skills/{verb}` sub-resource action paths (`format`, `validate`, `search`, `counts`, `generate`, `lookup`) take router priority over `:id` captures, so a skill named after any of these verbs would become unreachable via its canonical read endpoint.

This PR ships the enforcement + an audit tool:

- **`ornn-api/src/shared/reservedVerbs.ts`** — single-source catalog of reserved verbs per resource. `isReservedVerb("skill", name)` is the check.
- **`SkillService.createSkill`** rejects reserved names with `RESERVED_NAME` (400) before the uniqueness check. Covers all create paths (direct API upload, skill generation).
- **`ornn-api/scripts/audit-reserved-verbs.ts`** — new one-shot script, exposed as `bun run audit:reserved-verbs`. Scans the `skills` collection for name collisions and exits non-zero when any are found. **Must be run against prod once before the Epic 2 deploy** so any colliding rows can be renamed with their owners' consent.
- **`ornn-api/src/shared/reservedVerbs.test.ts`** — unit tests for the catalog + guard.

Category and tag names currently use constrained whitelists (fixed enum / regex), so no enforcement needed on those paths yet. The `RESERVED_VERBS.category` / `RESERVED_VERBS.tag` slots are present and empty, ready for future v1-style action paths if any are added.

Frontend mirror deferred: the skill name comes from `SKILL.md` frontmatter inside the uploaded ZIP, not a UI input — server-side enforcement is the only gate worth mirroring. If future skill-generation flows introduce a name input, a `ornn-web/src/lib/reservedVerbs.ts` mirror is a small follow-up.
