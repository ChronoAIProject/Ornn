---
"ornn-api": patch
---

`Skip validation` on GitHub import now also bypasses the frontmatter Zod check (#529).

`POST /skills/pull` (and the symmetric `POST /skills` + `POST /skills/:id/refresh` paths) accepted `skipValidation: true` but it only short-circuited the directory-structure validator (`validateZipFormat`). The frontmatter Zod schema in `extractSkillInfo` ran unconditionally, so importing a third-party skill (e.g. Anthropic's official skills repo) with non-Ornn-shaped frontmatter still failed with `frontmatter_validation_failed`. The toggle's name + tooltip both said "skip Ornn package format validation" — users reasonably expected the frontmatter check to be part of that surface.

Fix extends the `skipValidation` semantics into `extractSkillInfo`. When the flag is set AND the strict schema rejects, the parser falls back to `extractSkillInfoLenient` — a best-effort extract that:

- Requires `name` (no defensible fallback for the document-id).
- Defaults `version` to `0.1` when missing — downstream `parseVersion` still enforces the `<major>.<minor>` format.
- Defaults `metadata.category` to `plain` (the safest category — no runtime / tool execution expected). User can edit post-import.
- Pulls `tags` only when the value looks plausibly correct (array of strings); dropped silently otherwise.
- YAML syntax errors still hard-fail — we can't import what we can't parse, no matter how lenient we want to be.

The dry-run refresh preview also passes `skipValidation: true` to `extractSkillInfo` so a third-party-shaped SKILL.md doesn't kill the preview flow.

All 805 existing tests pass; typecheck clean.
