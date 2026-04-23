---
"ornn-api": minor
---

Authors can include release notes per version via SKILL.md frontmatter (`release-notes:` or `releaseNotes:`, plain text, capped at 2000 chars). Persisted on `SkillVersionDocument.releaseNotes`, returned from `GET /api/v1/skills/:id/versions` and both `from`/`to` sides of the diff endpoint. Closes #26.
