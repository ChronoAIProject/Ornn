---
---

docs(skill): refresh the `ornn-agent-manual-cli` skill to v1.4.

- Trigger-oriented frontmatter `description` so Claude Code reliably auto-invokes the skill (covers skills **and** skillsets, plugin export, ownership transfer, etc.).
- Full skillset lifecycle across `SKILL.md` §2.16 and `api-reference.md` §5a: remove the phantom `PUT /skillsets/:id/permissions`, add plugin-export + transfer-ownership, document derived visibility, auto-revision, the real response/closure shapes, and the error-code table.
- Broader api-reference drift fixed against current `ornn-api`: skill transfer-ownership + dist-tags, assistant SSE, manifest JSON Schema, public/admin `github/repo` mirror coords, launch-promo, the per-model `assistant` surface flags, and the phantom `ornn:quota:admin` scope (real scope is `ornn:admin:skill`).

Docs-only: no `ornn-api` / `ornn-web` runtime change (the skill is registry-sourced, not bundled into either package image). The skill's own registry version bumps 1.3 → 1.4; publishing the refreshed content to the live registry is a separate operational step.
