---
"ornn-web": patch
---

`SkillDetailPage` main grid now caps at a viewport-relative height on lg+ (`calc(100vh-280px)`, with a 480px min floor) and lets each column scroll its own long content inside the frame. Previously every long file or growing audit history pushed the whole page longer; now both columns stay readable side-by-side and only their internal content scrolls. Mobile keeps natural page-flow.

Closes #341.
