---
"ornn-api": minor
---

Audit-gated skill sharing. New `shares` domain with `ShareRequest` state machine (`pending-audit → green | needs-justification → pending-review → accepted | rejected | cancelled`). Endpoints: `POST /api/v1/skills/:idOrName/share` (initiate, runs cached audit), `GET /api/v1/shares/:id`, `POST /api/v1/shares/:id/justification` (owner), `POST /api/v1/shares/:id/review` (reviewer), `POST /api/v1/shares/:id/cancel`, `GET /api/v1/shares` (caller's own), `GET /api/v1/shares/review-queue` (routed by target: user recipient / org admin / platform admin). Green audit short-circuits and applies the share immediately via `setSkillPermissions`. Part of #94 / #95 / #96 / #97. Private skills remain un-audited by virtue of never going through the share path.
