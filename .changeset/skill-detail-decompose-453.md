---
"ornn-web": patch
---

First-pass decomposition of `SkillDetailPage` (#453).

`SkillDetailPage.tsx` was 1133 lines — well over the 300-line target the issue sets. This PR pulls 7 self-contained chunks into colocated components under `components/skill/`:

- `SkillSaveConfirmModal` — save-with-skip-validation toggle
- `SkillDeleteConfirmModal` — whole-skill delete confirmation
- `SkillAuditStartedModal` — post-audit-kickoff acknowledgement
- `SkillVersionsBrowserModal` — all-versions list + Compare button + per-row delete toast
- `AuditVerdictPill` — right-rail audit verdict tile (3 visual states)
- `SkillDetailStates` — loading skeleton + 404 not-found shells
- `SkillVersionsCard` + `SkillVisibilityCard` — right-rail cards

Net: `SkillDetailPage.tsx` from **1133 → 868 lines** (-23%). 9 new component files at 41-124 lines each.

Behavior unchanged. Each new component is stateless except for the toast-emitting delete handler inside the versions browser (kept colocated so the parent doesn't need to thread it through). All 110 frontend tests still pass; typecheck clean.

Per the issue's "one PR per page" guidance, DocsPage (901L) and PlaygroundPage (813L) get their own PRs. A follow-up will also extract the `useSkillDetail()` hook to pull the queries / mutations / derived state out of the page entirely — that's the biggest remaining lever, but the data flow is too entangled with the JSX layout to bisect cleanly in this PR.
