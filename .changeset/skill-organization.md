---
"ornn-api": minor
---

Organization-scoped skills (#8). A skill (or topic) can now be owned by a person or an organization. Org members see and manage org-owned skills; non-members see only public. Ornn consumes NyxID's org model directly — zero org data is stored in Ornn itself.

**Data model.** New `ownerId: string` field on `SkillDocument` and `TopicDocument` — either a person `user_id` (for personal ownership) or an org `user_id` (for org-owned). `createdBy` still records the actual person-author and never changes meaning. Ownership is immutable after create.

**Visibility.** `!isPrivate` → visible to everyone. `isPrivate` + personal → author + platform admin. `isPrivate` + org-owned → author + admins/members of that org + platform admin. NyxID's `viewer` role is treated as non-member for MVP.

**Creation.** `POST /api/skills?targetOrgId=<org>` and `POST /api/topics { targetOrgId }` verify the caller is an admin/member of that org (fail-closed 403 `NOT_ORG_MEMBER`) before setting `ownerId`. Updates cannot change ownership.

**Write gate.** Mutations allowed when `actor === createdBy` (author), or actor is an admin of the owning org, or actor holds `ornn:admin:skill`. Otherwise 403.

**NyxID integration.** New `NyxidOrgsClient` calls `GET /api/v1/orgs` with the caller's own bearer token. A request-scoped middleware attaches a memoized getter so every downstream route shares a single NyxID round-trip per request. Fail-soft on reads (empty org list), fail-closed on writes.

**Migration (required).** Run `bun run migrate:ownership` to backfill `ownerId = createdBy` on existing `skills` and `topics` documents. Idempotent.
