---
"ornn-api": minor
"ornn-web": minor
---

Restructure `.env.sample.ornn` into four explicit sections (kubernetes, docker, ornn-api runtime, ornn-web runtime) and trim it down. Two operator-facing changes:

- **NyxID service-account credentials moved out of env into admin Settings → Integrations → NyxID.** `NYXID_SA_TOKEN_URL`, `NYXID_SA_CLIENT_ID`, `NYXID_SA_CLIENT_SECRET` are gone. `NyxidSaTokenProvider` now resolves credentials lazily from the `integrations/nyxid` settings section on every refresh. After deploy, configure the section once via /admin/settings — SA token minting fails-fast with a clear error until you do.
- **ornn-web URL config consolidated to 3 base URLs + 5 paths** (`NYXID_API_BASE_URL`, `NYXID_WEB_BASE_URL`, `ORNN_API_BASE_URL` + `NYXID_OAUTH_{AUTHORIZE,TOKEN,REDIRECT}_PATH` / `NYXID_LOGOUT_PATH` / `NYXID_SETTINGS_PATH`). Replaces 12 full-URL vars. The SPA composes full URLs centrally in `src/config.ts`. `NYXID_BACKEND_HOST` is now derived from `NYXID_API_BASE_URL` by a sourced entrypoint script. Dead vars (`ORNN_API_URL`, `NYXID_BASE_FRONTEND_URL`, `NYXID_MY_*_PATH`) removed.

Closes #294.
