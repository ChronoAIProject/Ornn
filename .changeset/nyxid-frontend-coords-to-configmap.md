---
"ornn-api": patch
"ornn-web": patch
---

chore: move browser-only NyxID link coords from admin settings into ornn-web configmap (#275).

The `nyxid` admin-settings section used to carry five fields with no server-side consumer (`baseFrontendUrl`, `myServicesPath`, `myProfilePath`, `myOrganizationPath`, `servicesListApiPath`). The four frontend link coords now live in ornn-web's configmap (`NYXID_BASE_FRONTEND_URL`, `NYXID_MY_SERVICES_PATH`, `NYXID_MY_PROFILE_PATH`, `NYXID_MY_ORGANIZATION_PATH`) — delivered via the existing `window.__ORNN_CONFIG__` injection alongside `NYXID_OAUTH_*` and `NYXID_LOGOUT_URL`. `servicesListApiPath` is dropped outright (the runtime hard-codes `/api/v1/user-services`).

The admin NyxID section now contains only `tokenUrl`, `clientId`, `clientSecret`, and `baseApiUrl` — the four fields ornn-api actually consults at runtime.

Migration-free: pre-existing `platform_settings` docs with the legacy fields keep working — Zod's default strip semantics drop unknown keys on parse. Operators upgrading should add the four new env vars to their ornn-web configmap (see `deployment/.env.sample.ornn`).
