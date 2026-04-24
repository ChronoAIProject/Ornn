---
"ornn-web": minor
---

frontend: GitHub import + refresh UI. Adds a fourth creation mode on `/skills/new` ("Import from GitHub") that pulls a public repo into Ornn via `POST /api/v1/skills/pull`. On `SkillDetailPage`, imported skills now show a compact origin chip (repo + commit + synced-at) with a one-click "Refresh from GitHub" action for owners/admins that calls `POST /api/v1/skills/:id/refresh`. Closes #159 from the phase-3 frontend catch-up umbrella (#156).
