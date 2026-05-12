---
"ornn-web": minor
---

Stop proxying ornn-api requests through ornn-web's nginx. The SPA now hits NyxID's proxy URL directly via `ORNN_API_BASE_URL=https://<nyxid>/api/v1/proxy/s/ornn-api`. Fixes a 502 regression from #295 in any topology where the ornn-web pod can't resolve the same hostname the browser uses.

Removes the `/api/v1/` proxy_pass block from `nginx.conf.template`, the `15-derive-nyxid-api-host.envsh` entrypoint script, and the `NGINX_ENVSUBST_FILTER` plumbing in the configmap. `NYXID_API_BASE_URL` is now SPA-only (used to compose the OAuth token URL); nginx no longer needs it.

Closes #298.
