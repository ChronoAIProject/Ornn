---
"ornn-web": minor
---

frontend: skill audit banner on SkillDetailPage. Shows the cached verdict (green / yellow / red), overall 0–10 score, and a collapsible drawer with per-dimension scores and findings. Admins get a "Rerun" button (and a "Run audit" CTA for skills that have never been audited). Wires up the already-shipped `/api/v1/skills/:idOrName/audit` endpoints; closes #158 from the phase-3 frontend catch-up umbrella (#156).
