---
"ornn-api": minor
"@chronoai/ornn-sdk": minor
---

Skill dependencies (#968). Skills can now declare other skills they depend on via the `metadata.depends-on` SKILL.md frontmatter field — each entry pins one skill by `<name-or-guid>@<major.minor>` or `<name>@<dist-tag>` (no semver ranges, no self-references; max 50 direct deps). The full transitive closure is validated at publish time (`POST /skills`, `PUT /skills/:id`): missing dependencies, cycles, and conflicting versions of the same skill are rejected before the version is committed. A new `GET /api/v1/skills/:idOrName/closure` endpoint resolves and returns the full closure in deps-first topological order, scoped to what the caller may read. Three new error codes: `dependency_cycle` (409), `dependency_conflict` (409), `skill_dependency_not_found` (404). The TypeScript SDK gains `resolveClosure` / `pullClosure`; the Python SDK gains `resolve_closure` / `pull_closure`.
