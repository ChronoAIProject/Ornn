---
"ornn-api": minor
---

Sliding-window rate-limit middleware + RFC 9239 headers on every response (#439 + #460).

New `ornn-api/src/middleware/rateLimit.ts` exports `rateLimit({ windowMs, max, label?, keyBy? })`. Defaults:
- **Key:** `auth.userId` when present, else `x-forwarded-for` first IP, else `"anonymous"`.
- **Storage:** in-memory `Map` per process; cleanup pass every 60s on access.
- **Headers:** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds) emitted on every allowed AND denied response. Denied responses also carry `Retry-After`.
- **Deny:** throws `AppError(429, "rate_limited", "...")` — the global handler emits it as `application/problem+json` per RFC 7807.

Applied to the three highest-cost endpoints:

| Route | Limit | Why |
|---|---|---|
| `GET /skill-search` | 60/min/user | Mongo aggregation (keyword) or LLM rerank (semantic) |
| `POST /skills` | 10/min/user | ZIP validate + storage write + AgentSeal scan |
| `POST /skills/generate` | 20/min/user | Every request is an LLM call |

6 new unit tests pin: header emission, per-user keying, window reset, 429 response shape, multi-label composition. Full suite 704 / 0.

**Storage caveat for prod:** in-memory means multi-pod clusters get per-pod-buckets — the effective limit is `N × max` where N is the replica count. Acceptable for the current single-replica dev/staging cluster; a Redis backend is the natural next step before prod traffic hits a multi-replica deployment.
