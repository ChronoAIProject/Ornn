---
"ornn-web": patch
---

Fix nginx SNI when proxying to an HTTPS NyxID upstream behind a multi-tenant edge (Cloudflare et al). Without `proxy_ssl_server_name on` + a proper `proxy_ssl_name`, the upstream TLS handshake fails with alert 40 and the browser sees 502. Adds a new `NYXID_BACKEND_HOST` env var (hostname part of `NYXID_BACKEND_URL`, e.g. `nyx.chrono-ai.fun`) consumed by `nginx.conf.template` for SNI + Host header; plumbed through `deployment/ornn-web/configmap.yaml` and `deployment/.env.sample.ornn`.
