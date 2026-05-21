---
---

Add direct ornn-api ingress that bypasses the NyxID proxy (#661).

The web SPA today routes every backend call through `nyx-api.../api/v1/proxy/s/ornn-api/*`, and that proxy gates every request behind NyxID's auth — even routes that ornn-api itself codes as anonymous-friendly (announcements, skill-search, public skill reads). Net effect: a visitor landing on `ornn.chrono-ai.fun` without login sees the SPA shell but every API call 401s, so News / Registry / Docs pages stay empty (the #467 audit gap).

This change adds `deployment/ornn-api/ingress.yaml` — a dedicated nginx Ingress that exposes ornn-api on its own host (`api.ornn-cluster.local` locally, `ornn-api.chrono-ai.fun` in prod once DNS + TLS land), so anonymous traffic can reach the public-read endpoints without the proxy gate. Authenticated routes (`/admin/*`, `/me/*`, all mutations) still enforce auth via ornn-api's per-route `nyxidAuthMiddleware` when reached this way, so private state isn't exposed by accident.

Verified locally: anonymous `GET /livez`, `GET /api/v1/announcements/active`, and `GET /api/v1/skill-search?q=…` all return 200 through the new ingress.

No package code changed; deployment-side fix only.
