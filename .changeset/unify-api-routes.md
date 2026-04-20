---
"ornn-api": minor
"ornn-web": minor
---

Unify API routes under `/api` prefix. All traffic now flows through NyxID proxy; JWT self-verification and `jose` dependency removed. Frontend service paths updated from `/api/web/*` to `/api/*`.
