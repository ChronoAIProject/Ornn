---
"ornn-web": patch
---

Fix `ornn-web-config` ConfigMap accidentally reusing ornn-api's `NYXID_TOKEN_URL` / `NYXID_CLIENT_ID` values. ornn-api wants internal K8s DNS + a service-account client; ornn-web needs a browser-reachable URL + a user-facing OAuth client. The ConfigMap now sources ornn-web's two vars from dedicated `.env.ornn` entries (`NYXID_WEB_TOKEN_URL`, `NYXID_WEB_CLIENT_ID`); the container env keys stay `NYXID_TOKEN_URL` / `NYXID_CLIENT_ID` so no frontend code change is needed.
