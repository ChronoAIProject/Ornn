---
"ornn-web": patch
---

Two install-card polish fixes:

- Install card visibility now follows the skill itself — anyone who can see the skill can see the install card, including unauthenticated viewers on public skills. The prior `canTryWithCli` gate from #411 was an unnecessary second wall on top of the page-level access control.
- Install card height is stable when switching tabs. The Via-prompt code block is now a fixed 160px scrollable preview (was 288px max, which dwarfed the npx tab); both tabpanels reserve the same 224px envelope so the card outline doesn't jump.
