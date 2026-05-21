---
"ornn-web": patch
---

Fix three Playground / Skill-Gen quota refresh races (#629 + #630 + #624).

All three were the same family of "the chrome and the truth disagree":

- **#629** — `QuotaInline` warning banner and `QuotaSummary` row both rendered `Math.round((used / ceiling) * 100)`. With `used=199, ceiling=200, remaining=1`, that's `99.5 → 100%` even though the chip next to it showed `1 Playground calls left`. New shared `displayUsagePercent(used, ceiling, remaining)` uses `Math.floor`, clamps to `[0, 99]` whenever `remaining > 0`, and only returns `100` when `remaining <= 0`. Pinned with 6 unit assertions.
- **#630** — `usePlaygroundChat`'s `finish` / `error` handlers didn't invalidate `MY_QUOTA_KEY`. The page kept showing the pre-charge snapshot for up to 60 seconds (the next poll). Added `qc.invalidateQueries({ queryKey: MY_QUOTA_KEY })` on both terminal events so the chip / banner / over-limit gate reflect the actual remaining count immediately.
- **#624** — `CreateSkillGenerativePage` (and `PlaygroundPage`) routed to `OverLimitPage` whenever `isOverLimit` flipped true, even if the user had a generated result / live conversation on screen. The post-charge quota poll arriving after the *final* allowed run would yank the result away. Now the over-limit redirect only fires on a *fresh* arrival (no preview / no messages); the Send button's existing `isOverLimit` disable still prevents new runs.

Net effect: the user's last allowed run lands, the result stays visible, the chip flips to 0/N right away, and the banner copy stops contradicting the chip.
