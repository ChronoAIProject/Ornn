---
"ornn-web": patch
---

Extract `usePlaygroundSession()` hook from PlaygroundPage (#453).

The second hook-extraction follow-up — parallel to `useSkillDetail()` from #664. The hook owns every query, ref, derived value, drawer state, and handler callback; the page is left with the JSX layout shell + prop wiring.

Net delta: `PlaygroundPage.tsx` **518 → 386 lines** (−25%). Cumulative #453 progress on PlaygroundPage: **813 → 386** (−53% across #660 + this PR).

Closes the page-component + hook-extraction portions of #453 across all three pages (SkillDetailPage 1133→625, DocsPage 905→303, PlaygroundPage 813→386). DocsPage is already under the 300L target; the two larger pages now have their data flow cleanly split — state lives in hooks, layout lives in pages.

Behavior unchanged; 110 web tests still pass.
