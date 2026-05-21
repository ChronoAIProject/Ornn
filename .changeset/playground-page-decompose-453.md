---
"ornn-web": patch
---

Decompose PlaygroundPage into 6 colocated components (#453).

`pages/PlaygroundPage.tsx`: **813 → 518 lines (−36%)**. Six new components under `components/playground/`:

- `PlaygroundHelpers` (101L) — pure helpers + `ThinkingBubble` indicator
- `PlaygroundEmptyHero` (86L) — centered welcome flag + 3 suggestion chips
- `PlaygroundConversation` (109L) — forwardRef: turns + streaming buffer + file outputs + error banner + scroll anchor
- `PlaygroundRail` (101L) — fixed right-edge rail with hover-peek + click-to-pin
- `PlaygroundEnvDrawerBody` (81L) — per-key input list + lock hint
- `PlaygroundPackageDrawerBody` (79L) — SkillPackagePreview + registry-link footer

PlaygroundPage now carries state plumbing (hooks for skill / package / chat / quota), the drawer outer container, the composer (ChatInput + ModelPicker + QuotaInline), and the early-return states (no-skill / loading / 404 / over-limit). The suggested `usePlaygroundSession()` hook extraction is deferred — would pull queries / chat state / handlers out and likely bring the page under 300L, but the data flow doesn't bisect into a small commit.

Closes the page-component portion of #453 (SkillDetailPage in #651, DocsPage in #659, this PR). Issue stays open for the deferred hook-extraction work.
