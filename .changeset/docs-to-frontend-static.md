---
"ornn-api": minor
"ornn-web": minor
---

Move docs (product guides + release notes) from backend to frontend static build. `/api/docs/tree`, `/api/docs/content/:lang/:slug`, `/api/docs/releases`, `/api/docs/releases/:version` are removed; `ornn-api` no longer serves docs traffic, no longer ships `ornn-api/docs/`, and `ornn-web/nginx.conf` drops the `/api/docs/` bypass. `ornn-web` loads markdown at build time via Vite `import.meta.glob`. Closes #40.
