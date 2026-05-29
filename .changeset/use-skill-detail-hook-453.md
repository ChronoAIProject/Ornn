---
"ornn-web": patch
---

Extract `useSkillDetail()` hook from SkillDetailPage (#453).

The deferred follow-up from #651: pull every query, mutation, derived value, local UI state, and handler callback out of the page into a single `useSkillDetail(idOrName)` hook. The page is a thin shell that destructures the hook and wires props into the already-extracted subcomponents.

Net delta: `SkillDetailPage.tsx` **873 → 625 lines** (−28%). Cumulative #453 progress on SkillDetailPage: **1133 → 625** (−45% across #651 + this PR).

What the hook owns: 6 queries (skill, versions, audit summary + history, 7d pulls, package), 6 mutations (delete, delete version, update package, deprecation, refresh-from-source, start audit), all derived state (isOwner, isAdmin, mergedContents, mergedFiles, etc.), 11 pieces of local UI state (7 modal toggles + skipValidation + 3 edit-state maps), 10 useCallback handlers, and the skill-id-change effect that resets modal toggles.

Behavior unchanged; 110 web tests still pass.
