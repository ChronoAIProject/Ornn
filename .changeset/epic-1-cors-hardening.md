---
"ornn-api": patch
---

Epic 1 CORS security hardening (part of #66):

- CORS origin is now validated against an env-driven allow-list (`ALLOWED_ORIGINS`, comma-separated). Empty list denies all cross-origin requests. The previous `origin: (origin) => origin` reflection combined with `credentials: true` was a CSRF-class risk — any cross-site page could issue credentialed requests.
- Dropped stale allow-listed request headers `X-API-Key`, `X-User-Email`, `X-User-Display-Name` — nothing on the backend read them; identity is sourced from the NyxID proxy.
- `deployment/ornn-api/configmap.yaml` and `deployment/.env.sample.ornn` updated to pass the new variable through.
- `deployment/ornn-api/deployment.yaml` migrated to the new K8s probes: `readinessProbe` → `/readyz` (pings Mongo, adds `timeoutSeconds` + `failureThreshold`), `livenessProbe` → `/livez`.

**Deploy requirement**: `ALLOWED_ORIGINS` must be set in `.env.ornn` before rolling out this image, or cross-origin requests from `ornn-web` will be blocked. Empty is deny-all by design.
