---
"ornn-web": patch
---

Fix the right-edge rail tabs on Playground and the AI Skill Generation page — labels were rendering upside-down for CJK because of a `writing-mode: vertical-rl` + `rotate(180deg)` combo intended only for vertical English.

Replaced the rotated text with icon-only tab handles (`SkillIcon`, `EnvIcon`, `PackageIcon`) and a horizontal mono-uppercase tooltip that fades in on hover (`[§ SKILL]` / `[§ ENV]` / `[§ PACKAGE]`, matching the drawer header voice). All three tabs are now equal-height — previously `PACKAGE` was ~1.7× taller than `ENV` because of letter count. `aria-label` keeps using the i18n string so screen readers stay locale-correct.

Closes #522.
