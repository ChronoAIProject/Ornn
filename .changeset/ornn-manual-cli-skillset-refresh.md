---
---

docs(skill): refresh the `ornn-agent-manual-cli` skill to v1.4 — a trigger-oriented frontmatter `description` so Claude Code auto-invokes it, removal of the phantom `PUT /skillsets/:id/permissions` endpoint, and full skillset-lifecycle coverage (plugin-export, transfer-ownership, derived visibility, auto-revision, error codes) across `SKILL.md` §2.16 and `api-reference.md` §5a.

Docs-only: no `ornn-api` / `ornn-web` runtime change (the skill is registry-sourced, not bundled into either package image). The skill's own registry version bumps 1.3 → 1.4; publishing the updated content to the live registry is a separate operational step.
