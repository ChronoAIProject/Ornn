---
"ornn-web": minor
---

frontend: audit-gated share workflow — PR 1/3. Adds a "Share (audit-gated)" button on `SkillDetailPage` that opens a target picker (user / org / public), fires `POST /api/v1/skills/:idOrName/share`, and surfaces the caller's in-flight requests for this skill inline with status badges and a cancel action. The `/shares/:requestId` detail view and reviewer queue land in follow-up PRs (#160b / #160c). Progresses #160 from the phase-3 frontend catch-up umbrella (#156).
