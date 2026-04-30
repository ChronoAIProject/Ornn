---
"ornn-web": minor
---

frontend: per-skill analytics card on `SkillDetailPage`. Shows execution count, success rate with outcome breakdown (ok / fail / timeout), p50 + p95 latency (p99 in hint), unique users, and top error codes for a rolling window (7d / 30d / all). Graceful empty state for skills with no executions yet. Wires up the already-shipped `GET /api/v1/skills/:idOrName/analytics` endpoint; closes #161 from the phase-3 frontend catch-up umbrella (#156).
