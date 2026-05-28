---
"ornn-web": patch
---

Skill Detail now surfaces a "latest rerun failed" indicator next to the score so a failed audit rerun is no longer invisible (#718).

Background: `auditSummaryByVersion` returns the latest *completed* audit per version. When a rerun ends in `failed`, the summary still points at the previous successful record, and Skill Detail renders that stale score — visually identical to "current passing audit". Admins only discovered the failure by opening Audit History.

Fix: `useSkillDetail` already loads `versionAuditHistory` (newest-first across all statuses) to compute `versionAuditRunning`. Compute one more derived flag from it — `versionAuditLatestFailed = history[0].status === "failed" && newer than the displayed completed audit` — and thread it through to `AuditVerdictPill` as the new `latestRerunFailed` prop. The pill keeps the old completed score (so admins can still see the last-good number) and renders a danger-toned banner directly below: "Latest rerun failed — score above is from the prior audit. Check audit history for details." (`skillDetail.auditLatestFailed`).

No backend change. The shape `getAudit` returns is unchanged — the gap was that the *latest-of-any-status* signal was already in hand and just wasn't propagated.
