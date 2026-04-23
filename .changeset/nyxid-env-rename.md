---
"ornn-api": minor
"ornn-web": minor
---

**Breaking (operator-facing):** rename NyxID env vars to distinguish service-account credentials (ornn-api, machine-to-machine) from OAuth credentials (ornn-web, user sign-in). Same underlying OAuth concepts, clearer names end-to-end — outer `.env.ornn`, ConfigMap/Secret keys, pod env, and code reads all aligned.

## Rename map

| Old | New | Used by |
|---|---|---|
| `NYXID_TOKEN_URL` | `NYXID_SA_TOKEN_URL` | ornn-api |
| `NYXID_CLIENT_ID` | `NYXID_SA_CLIENT_ID` | ornn-api |
| `NYXID_CLIENT_SECRET` | `NYXID_SA_CLIENT_SECRET` | ornn-api |
| `NYXID_AUTHORIZE_URL` | `NYXID_OAUTH_AUTHORIZE_URL` | ornn-web |
| `NYXID_WEB_TOKEN_URL` | `NYXID_OAUTH_TOKEN_URL` | ornn-web |
| `NYXID_WEB_CLIENT_ID` | `NYXID_OAUTH_CLIENT_ID` | ornn-web |
| `NYXID_REDIRECT_URI` | `NYXID_OAUTH_REDIRECT_URI` | ornn-web |

Unchanged: `NYXID_BASE_URL`, `NYXID_LOGOUT_URL`, `NYXID_SETTINGS_URL`.

## Migration

1. Update `deployment/.env.ornn` — rename the keys per the table.
2. Re-envsubst + kubectl apply the ConfigMap + Secret manifests.
3. Rolling-restart `ornn-api` + `ornn-web` deployments.

## Cleanup

Also drops the dead `VITE_NYXID_*` + `VITE_API_BASE_URL` build args from the `docker-build` step in `ci.yml` — PR #117 made config runtime-driven; those build args haven't been read from the Dockerfile for a while.
