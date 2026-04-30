---
"ornn-api": minor
"ornn-web": minor
---

feat: per-version audit badges + share scheme B (#188).

**Backend.** New `GET /api/v1/skills/:idOrName/audit/summary-by-version` returns the most recent *completed* audit for each version of a skill. `AuditRepository.findLatestCompletedPerVersion` is one Mongo aggregation (`$match status:completed → $sort createdAt -1 → $group _id:version $first:doc`); `AuditService.summaryByVersion` exposes it as `Record<version, AuditRecord>`. Visibility mirrors the rest of the audit endpoints.

**Frontend.** New `useAuditSummaryByVersion` hook + `fetchAuditSummaryByVersion` service; `useStartAudit` invalidates this key alongside the history keys. `SkillVersionList` accepts an `auditSummary` prop and renders an `AuditPill` next to each version row (green / yellow / red verdict pill, or a neutral "?" pill for versions that never had a completed audit). `SkillDetailPage` mounts a one-line cautionary banner above the main grid when the currently-viewed version is yellow / red / not-yet-audited; green is silent. Banner has a deep link to `/skills/:idOrName/audits?version=` so the user lands on that version's audit history. en/zh translations added.

**Share semantics — scheme B confirmed in code.** The share gate already only consumes the *latest version's* completed audit (`shareService.initiateShare` looks up via `auditService.getAudit(skill.guid, skill.version)`). Older versions keep whatever audit they had; consumers see the per-version pill. Documented in `agent-manual.md` already (#192).
