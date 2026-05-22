---
"ornn-web": patch
---

EditSkillPage hands the resolved skill GUID to write mutations (#565).

Background: PR #586 tightened the backend's `PUT /skills/:id` and `DELETE /skills/:id` routes to resolve via `skillRepo.findByGuid` only — no fallback to `findByName`. The SPA's owner-edit page route stays human-readable (`/skills/:name/edit`) for shareability, but the page was passing the URL `:id` (the skill name) directly into `useUpdateSkill` / `useUpdateSkillPackage`. The mutations then built `PUT /api/v1/skills/<name>` and the backend returned 404, surfacing on the live cluster as "Failed to update package" with no visible reason.

End-to-end QA on the local cluster (2026-05-22) confirmed the failure. Owner-edit was 100% broken — every PUT returned `404 skill_not_found`.

Fix: resolve through `useSkill(id)` first (which accepts name OR GUID) and pass `skill.guid` to both write hooks. The fallback to the URL `:id` only matters on the first paint before skill data arrives; both mutations are gated behind the `isLoading` / `!skill` early returns, so the user can never click a button while the resolved id is still pointing at the name. Same pattern as `useSkillDetail.ts:77`.

Coverage: new `EditSkillPage.test.tsx` mocks `useSkill` to return `{ guid: "abc-123", name: "my-public-skill" }` and asserts the write hooks both receive `"abc-123"`, not `"my-public-skill"`. The test fails on the pre-fix code.
