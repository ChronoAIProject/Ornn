# NyxID Token Model

Companion to `SKILL.md` §0.6 + §3. This file explains how NyxID tokens flow — bearer issuance, refresh, scope vs permission, the proxy strip vs forward decision, JWT-mode vs headers-mode identity propagation, the per-user `forward_access_token` flag, and the role → permission mapping. Consult when you hit a 401 / 403 / silent-empty-list and need to know *why*.

---

## 1. Token types

NyxID issues four kinds of credentials. Pick the right one for the situation:

| Type | TTL | Use case | How to get one |
|---|---|---|---|
| **Access token (OIDC)** | 15 min default | Interactive user sessions, CLI after `nyxid login`, "Sign in with NyxID" web apps | OIDC authorization-code flow with PKCE; or `POST /api/v1/auth/login` with email + password |
| **Refresh token** | Long-lived (configurable) | Rotate the access token without re-prompting the user | Returned alongside the access token |
| **NyxID API key** | Indefinite (until revoked) | Headless agents, CI / cron, AI-tool environments where browser OAuth is impractical | `nyxid api-key create --name "..."` or `POST /api/v1/api-keys`. Returns the value **once** |
| **Service account access token** | 1 hour default | Server-to-server (no human), client_credentials grant | `POST /oauth/token` with `grant_type=client_credentials`, using a service-account `client_id` + `client_secret` (admin creates it via `POST /api/v1/admin/service-accounts`) |

All four are bearer tokens. Pass them as `Authorization: Bearer <value>`. NyxID API keys may also be passed as `X-API-Key: <value>`.

---

## 2. Refresh flow

```bash
# Refresh an access token using a refresh token
curl -X POST "$NYXID_BASE/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=<REFRESH_TOKEN>" \
  -d "client_id=<YOUR_CLIENT_ID>"

# Or use the JSON convenience endpoint
curl -X POST "$NYXID_BASE/api/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<REFRESH_TOKEN>"}'
```

The CLI does this automatically — `nyxid` checks token expiry on each call and refreshes when needed, transparently to the agent. NyxID API keys never refresh because they don't expire.

> **Permissions are baked into a token at issue time.** If the user gets a new role mid-session, the existing access token does not pick it up. The CLI may auto-refresh and inherit the new permissions, depending on whether the refresh-token flow re-issues claims (it usually does), but the safest path is **log out + log in again** after a role change.

---

## 3. Scope vs permission — they're not the same thing

Two orthogonal authorization layers, often confused:

| Layer | What it gates | Where it lives |
|---|---|---|
| **Scope** (`openid`, `profile`, `email`, ...) | OIDC userinfo endpoint, what claims the access token carries | OAuth client config + token-issue request |
| **Permission** (`ornn:skill:read`, `ornn:skill:create`, ...) | NyxID-protected API surface, including everything Ornn exposes | NyxID role definitions, baked into the token at issue time |

A token with `openid profile email` and **no Ornn permissions** can authenticate to NyxID's `/oauth/userinfo` but every Ornn write call returns `403 FORBIDDEN: Missing permission: <name>`. Conversely, a token with `ornn:skill:create` but no `email` scope can create skills but cannot read its own email.

**You almost always care about permissions, not scopes,** when you're the agent. Scopes matter for OIDC integrations (§1.6 in `SKILL.md`).

---

## 4. The proxy — what it does to your token

Every Ornn API call goes through the **NyxID proxy**. The proxy is a separate component sitting between the caller and `ornn-api`. Its job:

1. Validate the inbound bearer (signature + expiry + issuer).
2. Decode the identity (or look it up from the API key).
3. Forward to the target service with **identity headers**, optionally also forwarding the bearer.
4. Stream the response back.

### 4.1 Forwarded identity headers

Two propagation modes, controlled by the per-service `forward_identity_mode` setting on each NyxID-side service binding:

| Mode | Headers Ornn receives | What `permissions[]` looks like |
|---|---|---|
| **JWT (preferred)** | `X-NyxID-Identity-Token` — a single signed JWT carrying `sub`, `email`, `name`, `roles[]`, `permissions[]` | Populated correctly. Every Ornn `requirePermission` gate works as expected. |
| **Headers (legacy)** | `X-NyxID-User-Id`, `X-NyxID-User-Email`, `X-NyxID-User-Name` — scalar headers | **Empty** (`permissions: []`). Every gated route returns `403 FORBIDDEN`. |

If `GET /me` returns `200` with empty `permissions`, the Ornn service binding is in headers mode. **Fix:** ask the NyxID admin to flip `forward_identity_mode` to `jwt` on the Ornn service binding in the dashboard. The user must then log out + log in (so a new token round-trip happens through the new mode).

### 4.2 Bearer token strip vs forward

By default, the proxy **does not forward the caller's bearer to the upstream service**. It strips it. This is a security property — the upstream sees identity (via `X-NyxID-*` headers) but never the raw bearer, so it can't impersonate the caller against other services.

Some Ornn endpoints, however, need to call **NyxID itself** on the caller's behalf — most notably `/me/orgs`, which enumerates the user's NyxID org memberships. For Ornn to do that, the proxy must forward the bearer through. This is controlled by a **per-user, per-service** flag: `forward_access_token`.

- **Off (default)** — Ornn cannot call NyxID as the user. `/me/orgs` fail-softs to `[]` (no error, no log entry beyond `duration:0`).
- **On** — Ornn receives the bearer in the forwarded request and uses it to call NyxID's user-facing endpoints.

**This is one of the highest-frequency silent failures.** If `/me/orgs` returns `200 + empty list` for a user you know is in orgs, the flag is off. The user must turn it on in the dashboard themselves (NyxID frontend → AI Services → `ornn-api` → "Forward Access Token" toggle). After flipping, run `/me/orgs` again — non-zero `duration` in the server log + populated `items` confirms it's working.

The flag is per-user (every user toggles their own), per-service (the toggle on the `ornn-api` binding doesn't affect other services), and deliberately defaulted off as a least-privilege posture.

### 4.3 Strip vs forward — diagnostic table

| Symptom | Likely cause |
|---|---|
| `GET /api/v1/me` returns `200` with `permissions: []` | Headers-mode identity propagation (§4.1). Fix: flip `forward_identity_mode` to `jwt`. |
| `GET /api/v1/me/orgs` returns `200` with `items: []` for a user you know is in orgs; server logs show `duration:0` | `forward_access_token` is off. Fix: user flips it on in NyxID dashboard. |
| `GET /api/v1/me/orgs` returns `500 NYXID_ORG_LOOKUP_FAILED` | Ornn called NyxID and got a non-OK response other than 404/403. Most likely cause in prod: `NYXID_BASE_URL` is unset and the host-derivation fallback is wrong (frontend host ≠ API host — see §5). |
| Every authenticated call returns `401 AUTH_MISSING` | Token expired, malformed, or the proxy didn't recognise it. Re-run `nyxid login` (or re-export `$NYXID_API_KEY`). |
| Every gated call returns `403 FORBIDDEN: Missing permission: <name>` | The token's `permissions[]` doesn't include the name. Either headers-mode propagation (§4.1) or NyxID role mapping doesn't grant it. |

---

## 5. `NYXID_BASE_URL` — production gotcha

Ornn has a fallback that derives the NyxID API base URL from the proxy-forwarded token's issuer claim. **The fallback assumes the NyxID frontend and API live on the same host.**

In production, our deployment splits them:

- Frontend: `https://nyx.chrono-ai.fun`
- API: `https://nyx-api.chrono-ai.fun`

The fallback derives `https://nyx.chrono-ai.fun/api/...` from the token issuer, which is **wrong** — the API is on a different host. Server-side calls back to NyxID (e.g. `/me/orgs` org resolution) fail with network errors or `NYXID_ORG_LOOKUP_FAILED`.

**Fix:** ornn-api MUST run with `NYXID_BASE_URL=https://nyx-api.chrono-ai.fun` set explicitly in its environment. Locally on a single-host self-hosted NyxID this isn't required (frontend + API on `localhost:3001` — fallback is correct), but in **any** deployment where the frontend and API have different hosts, you must set it.

This was the cause of an Ornn v0.5.0 prod incident. Keep it on the checklist when standing up new environments.

---

## 6. Role → permission mapping

The mapping is owned by NyxID, configured in the NyxID admin UI (or via NyxID's role API), not Ornn. The defaults shipped with NyxID:

| NyxID role | Permissions granted (Ornn-relevant) |
|---|---|
| `ornn-user` | `ornn:skill:read`, `ornn:skill:create`, `ornn:skill:update`, `ornn:skill:delete`, `ornn:skill:build`, `ornn:playground:use` |
| `ornn-admin` | All of `ornn-user` plus `ornn:admin:skill`, `ornn:admin:category` |
| (no Ornn role) | empty Ornn permissions; user can hit anonymous endpoints only |

To grant a permission to a user:

1. NyxID admin assigns the role in the NyxID dashboard (`Users → <user> → Roles`).
2. The user logs out and logs in again — permissions are baked at token-issue time.

There is no "promote my permissions mid-session" flow. The CLI's auto-refresh *may* pick up new permissions if NyxID re-issues claims on refresh-token grants; the only reliable path is full re-login.

---

## 7. Anonymous calls — what works without a token

A small slice of Ornn is reachable with no `Authorization` header at all:

- `GET /api/v1/skill-format/rules` — canonical skill format spec.
- `GET /api/v1/skill-search` with `scope=public` — public skills only, keyword mode (semantic mode requires auth — `400 AUTH_REQUIRED`).
- `GET /api/v1/skills/:idOrName` for public skills — anonymous gets `404 SKILL_NOT_FOUND` for private (existence is intentionally not leaked).
- `GET /api/v1/skills/:idOrName/versions`, `/audit`, `/audit/history`, `/audit/summary-by-version`, `/analytics`, `/analytics/pulls` — visibility-gated to public skills only when anonymous.
- `GET /api/v1/skills/:idOrName/json` — **requires auth + `ornn:skill:read`**. The closest signal to "agent pulled this skill"; recorded as `api` source in analytics.
- `GET /openapi.json`, `/health`, `/livez`, `/readyz` — all anonymous.

Everything else requires authentication. The full per-endpoint auth + authorization rules are in `references/ornn-api-reference.md` §1.4 and per-endpoint sections.

---

## 8. Self-hosted vs hosted differences

| Concern | Hosted (production) | Self-hosted (localhost) |
|---|---|---|
| Frontend host | `https://nyx.chrono-ai.fun` | `http://localhost:3000` |
| API host | `https://nyx-api.chrono-ai.fun` | `http://localhost:3001` |
| Ornn host | `https://ornn.chrono-ai.fun` | varies — you set it |
| TLS | Always required | Usually disabled for `localhost` |
| `NYXID_BASE_URL` on `ornn-api` | **Must be explicit** (see §5) | Optional — fallback works |
| Email verification | Enabled by default | Auto-verified if `AUTO_VERIFY_EMAIL=true` in `.env.dev` |
| Invite codes | Required for registration | Disabled if `INVITE_CODE_REQUIRED=false` |
| OIDC issuer in tokens | `https://nyx-api.chrono-ai.fun` | `http://localhost:3001` |

Self-hosted NyxID setup is documented in the NyxID repo's `README.md` and `docs/QUICKSTART.md`.

---

## 9. Quick reference — when something doesn't work

```text
401 AUTH_MISSING                    → re-login or re-export $NYXID_API_KEY
403 FORBIDDEN: Missing permission   → either §4.1 (headers mode) or §6 (role not granted)
200 + permissions:[]                → §4.1 — headers mode; flip forward_identity_mode=jwt
200 + me/orgs items:[] + dur:0      → §4.2 — forward_access_token off; user toggles in dashboard
500 NYXID_ORG_LOOKUP_FAILED in prod → §5 — set NYXID_BASE_URL explicitly
404 SKILL_NOT_FOUND for known skill → private skill, you're not in share list (intentional)
```
