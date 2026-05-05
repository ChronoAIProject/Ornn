# NyxID API Reference

Companion to `SKILL.md` §1. This file enumerates the NyxID HTTP surface (`/api/v1/*` plus the OIDC routes at `/oauth/*` and `/.well-known/*`) at the level of detail the agent actually needs to make calls without guessing. Each section names the path, request shape, response shape, and notable error codes. Per-deployment auth specifics live in `nyxid-token-model.md`.

> **Authoritative source.** This catalogue is derived from the NyxID `docs/AI_AGENT_PLAYBOOK.md` and `docs/API.md`. If the actual API behaviour disagrees, the API is right and this doc is stale — pull a fresh copy of the unified manual (`SKILL.md` §0) before assuming a bug.

---

## 1. Conventions

### 1.1 Base URL and versioning

| Environment | API base | Frontend |
|---|---|---|
| Production | `https://nyx-api.chrono-ai.fun` | `https://nyx.chrono-ai.fun` |
| Local self-host | `http://localhost:3001` | `http://localhost:3000` |

Versioned endpoints under `/api/v1/`. OIDC routes at the root (`/oauth/authorize`, `/oauth/token`, `/.well-known/openid-configuration`, `/.well-known/jwks.json`).

### 1.2 Authentication

| Method | Header | When |
|---|---|---|
| Bearer token (OIDC access token) | `Authorization: Bearer <access-token>` | After `nyxid login` or OAuth flow |
| NyxID API key | `Authorization: Bearer nyxid_...` OR `X-API-Key: nyxid_...` | Headless agents, CI |
| Service account | `Authorization: Bearer <SA-access-token>` | Server-to-server (client_credentials grant) |

Anonymous calls work for OIDC discovery, OpenAPI schema, and a small public slice. See `nyxid-token-model.md` §7 for the exact list.

### 1.3 Common response envelope

Most JSON endpoints follow:

```jsonc
// success
{ "data": <T>, "error": null }

// failure
{ "data": null, "error": { "code": "STRING_CODE", "message": "Human-readable explanation" } }
```

Some legacy routes (notably `/auth/*` and `/oauth/*`) return raw payloads without the envelope — read response shape per-endpoint.

### 1.4 HTTP status mapping

| Status | Meaning |
|---|---|
| 200 | Successful read or write |
| 201 | Resource created |
| 400 | Validation, malformed body, bad query |
| 401 | Authentication missing or invalid |
| 403 | Authenticated but unauthorized (missing role, scope, or per-resource permission) |
| 404 | Resource missing or hidden |
| 409 | Conflict (duplicate, state-machine violation) |
| 410 | Gone (deprecated route, post-removal) |
| 413 | Payload too large |
| 429 | Rate limited |
| 500 | Internal error — capture `X-Request-ID`, retry with backoff |

---

## 2. Authentication & sessions

### 2.1 Register — `POST /api/v1/auth/register`

**Auth: none.** Creates a new user account. Requires an invite code unless `INVITE_CODE_REQUIRED=false` in deployment.

```jsonc
{ "email": "...", "password": "...", "displayName": "...", "invite_code": "NYX-XXXXXXXX" }
```

### 2.2 Login — `POST /api/v1/auth/login`

**Auth: none.** Email + password.

```jsonc
{ "email": "...", "password": "..." }
```

Response: `{ access_token, refresh_token, expires_in, token_type, user: { ... } }`. Access tokens default to 15 min TTL.

### 2.3 Logout — `POST /api/v1/auth/logout`

**Auth: required.** Invalidates the current session.

### 2.4 Refresh — `POST /api/v1/auth/refresh`

**Auth: none** (the refresh token is the credential).

```jsonc
{ "refresh_token": "..." }
```

Same response shape as `/login`.

### 2.5 Forgot / reset password — `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password`

**Auth: none.** First sends an email with a reset code; second consumes the code.

---

## 3. Users

### 3.1 Current user — `GET /api/v1/users/me`

**Auth: required.** Returns `{ userId, email, displayName, roles, permissions, ... }`. Use this to debug 403s — it tells you exactly what the proxy thinks the caller is authorized for.

### 3.2 Update profile — `PUT /api/v1/users/me`

**Auth: required.** Accepts `displayName`, `avatarUrl`, etc. The set of editable fields is enforced server-side.

### 3.3 Sessions — `GET /api/v1/sessions`

**Auth: required.** Active sessions for the caller. Useful for revoking rogue sessions through the dashboard.

### 3.4 MFA — `/api/v1/auth/mfa/*`

```text
POST /api/v1/auth/mfa/setup        — start TOTP enrolment (returns secret + QR URL)
POST /api/v1/auth/mfa/confirm      — confirm with first code
POST /api/v1/auth/mfa/verify       — verify MFA code at login
POST /api/v1/auth/mfa/disable      — disable MFA
```

---

## 4. AI Services (the user-facing key management)

The unified `/api/v1/keys` surface auto-provisions UserEndpoint + UserApiKey + UserService records. New integrations should always use `/keys`; the legacy `/connections` and `/providers/{id}/connect/*` routes are deprecated but still functional.

### 4.1 Add a service — `POST /api/v1/keys`

**Auth: required.** Add from catalogue or fully custom.

```jsonc
// Catalogue add
{ "service_slug": "llm-openai", "credential": "$SERVICE_CREDENTIAL", "label": "Production" }

// Catalogue + custom endpoint URL
{ "service_slug": "llm-openclaw", "credential": "$SERVICE_CREDENTIAL",
  "endpoint_url": "http://localhost:18789", "label": "Local OpenClaw" }

// Fully custom (no catalogue entry)
{ "label": "Internal API",
  "endpoint_url": "https://internal.corp.com/api",
  "credential": "$SERVICE_CREDENTIAL",
  "auth_method": "header", "auth_key_name": "X-API-Key" }

// With node routing
{ "service_slug": "llm-openai", "credential": "...", "node_id": "<NODE_UUID>", "label": "..." }
```

`auth_method` ∈ `bearer | header | query | path | basic | none`.

### 4.2 List services — `GET /api/v1/keys`

**Auth: required.** Returns combined view: endpoint URL + credential metadata + service slug, one row per UserService.

### 4.3 Show service — `GET /api/v1/keys/{id}`

**Auth: required.**

### 4.4 Update service — `PUT /api/v1/keys/{id}`

**Auth: required.** Update label, endpoint URL, node routing, etc.

```jsonc
{ "label": "...", "endpoint_url": "...", "node_id": "<NODE_UUID>" }
```

### 4.5 Delete service — `DELETE /api/v1/keys/{id}`

**Auth: required.** Deactivates the UserService + UserApiKey atomically.

### 4.6 OAuth flow — `POST /api/v1/keys/oauth/authorize`

**Auth: required.** Start an OAuth flow for a provider that requires it (e.g. GitHub). Returns `{ authorization_url }`. User opens the URL in a browser, completes consent, NyxID handles the callback at `GET /api/v1/keys/oauth/callback` and stores the resulting tokens.

### 4.7 Force token refresh — `POST /api/v1/keys/{id}/refresh`

**Auth: required.** For OAuth-backed services where the access token has expired and you want to force a refresh-token round-trip.

### 4.8 Update credential — `PUT /api/v1/api-keys/external/{id}`

**Auth: required.**

```jsonc
{ "credential": "$NEW_CREDENTIAL" }
```

Slug is preserved; existing proxy calls keep working.

### 4.9 Update endpoints / user-services / external-keys directly

Underlying records are also addressable individually:

```text
GET    /api/v1/endpoints                 — list user's endpoints
PUT    /api/v1/endpoints/{id}            — update endpoint URL
DELETE /api/v1/endpoints/{id}

GET    /api/v1/api-keys/external         — list user's external credentials
PUT    /api/v1/api-keys/external/{id}    — rotate, relabel
DELETE /api/v1/api-keys/external/{id}

GET    /api/v1/user-services             — list bindings
PUT    /api/v1/user-services/{id}        — update auth config, node routing
DELETE /api/v1/user-services/{id}        — deactivate
```

Prefer `/keys` unless you have a specific reason to address one component.

---

## 5. Catalogue (read-only — discover available services)

### 5.1 List — `GET /api/v1/catalog`

**Auth: required.** Connectable services only.

Query: `include_all=true` — include system / no-auth services.

### 5.2 Show — `GET /api/v1/catalog/{slug}`

**Auth: required.** Full metadata for a single service template — `homepage_url`, `repository_url`, `openapi_spec_url`, `capabilities`, `auth_notes`, `known_limitations`, `required_permissions`.

### 5.3 Endpoints — `GET /api/v1/catalog/{slug}/endpoints`

**Auth: required.** Parsed API endpoints from the service's OpenAPI spec — `{ method, path, name, description, parameters, request_body }`.

---

## 6. Services (admin — catalogue management)

These create the templates that users add via §4. Admin only.

```text
GET    /api/v1/services
POST   /api/v1/services
GET    /api/v1/services/{id}
PUT    /api/v1/services/{id}
DELETE /api/v1/services/{id}
POST   /api/v1/services/{id}/endpoints                   — add API endpoint
POST   /api/v1/services/{id}/discover-endpoints          — auto-discover from OpenAPI
GET    /api/v1/services/{id}/oidc-credentials            — for OIDC services, get client_id + secret
PUT    /api/v1/services/{id}/redirect-uris               — update OIDC redirect URIs
POST   /api/v1/services/{id}/regenerate-secret           — rotate OIDC client secret
```

`POST /services` body schema (selected fields):

```jsonc
{
  "name": "OpenAI API",
  "slug": "openai",
  "base_url": "https://api.openai.com",
  "auth_method": "header",
  "auth_key_name": "Authorization",
  "service_category": "connection",      // "connection" | "internal" | "provider" | "ssh"
  "visibility": "public",                // "public" | "private"
  "openapi_spec_url": "https://api.example.com/openapi.json",
  "credential": "<shared-cred>"          // optional; for internal services where admin provides the key
}
```

For `auth_method: "oidc"`, NyxID auto-creates an OAuth client with generated `client_id` + `client_secret` and sets the default redirect to `{base_url}/callback`.

---

## 7. Proxy

### 7.1 Proxy by slug — `* /api/v1/proxy/s/{slug}/{path}`

**Auth: required.** Any HTTP method. Path is forwarded verbatim to `<service.base_url>/<path>` with the configured credential injected.

### 7.2 Proxy by service ID — `* /api/v1/proxy/{service_id}/{path}`

**Auth: required.** Same semantics; addresses by UUID rather than slug.

### 7.3 Discover — `GET /api/v1/proxy/services`

**Auth: required.** Lists services the caller can route through. Legacy — `GET /api/v1/keys` returns a richer combined view.

### 7.4 Streaming and large bodies

The proxy streams without server-side buffering. HTTP Range requests are supported when the upstream sets `Accept-Ranges`. Request bodies up to 100 MB by default (configurable via `PROXY_MAX_BODY_SIZE`).

### 7.5 Identity propagation (optional)

Per-service flag — when set, the proxy forwards:

```text
X-User-ID                  — NyxID userId
X-User-Email               — caller email
X-User-Name                — caller displayName
X-NyxID-Authenticated      — always "true"
```

Independent of bearer-token forwarding (`forward_access_token`); see `nyxid-token-model.md` §4.2.

---

## 8. Providers

Provider configs back the OAuth / API-key / device-code flows that catalogue services use. Most agents never call these directly — they're admin-managed.

```text
GET    /api/v1/providers
POST   /api/v1/providers                                      — admin
GET    /api/v1/providers/{id}
PUT    /api/v1/providers/{id}                                 — admin
DELETE /api/v1/providers/{id}                                 — admin
GET    /api/v1/providers/{id}/connect/oauth                   — deprecated; use /keys/oauth/authorize
POST   /api/v1/providers/{id}/connect/api-key                 — deprecated; use POST /keys
POST   /api/v1/providers/{id}/connect/device-code/initiate    — start device-code flow
POST   /api/v1/providers/{id}/connect/device-code/poll        — poll device-code status
POST   /api/v1/providers/{id}/refresh                         — refresh provider token
DELETE /api/v1/providers/{id}/disconnect
GET    /api/v1/providers/{id}/credentials                     — get user's own OAuth app creds
PUT    /api/v1/providers/{id}/credentials                     — set user's own OAuth app creds
DELETE /api/v1/providers/{id}/credentials
```

Provider modes (`credential_mode`):

- `admin` — admin provides client credentials, users just authorize.
- `user` — users bring their own client_id / client_secret.
- `both` — admin defaults; users can override.

Device-code flow shape:

```bash
# Initiate
POST /api/v1/providers/{id}/connect/device-code/initiate
# → { user_code, verification_uri, state, expires_in, interval }

# Poll (every interval)
POST /api/v1/providers/{id}/connect/device-code/poll
{ "state": "STATE_FROM_INITIATE" }
# → { status: "pending" | "success" | "expired" | "denied" }
```

---

## 9. Nodes (on-premise credential agents)

### 9.1 Registration tokens — `POST /api/v1/nodes/register-token`

**Auth: required.**

```jsonc
{ "name": "Production Node" }
```

Response: `{ token: "nyx_nreg_...", token_id, expires_at }`. Tokens expire 1 hour after issue.

### 9.2 List / show / delete / rotate

```text
GET    /api/v1/nodes
GET    /api/v1/nodes/{id}
DELETE /api/v1/nodes/{id}
POST   /api/v1/nodes/{id}/rotate-token
```

### 9.3 Bindings (deprecated — use `PUT /user-services/{id}` with `node_id`)

```text
POST   /api/v1/nodes/{id}/bindings
DELETE /api/v1/nodes/{id}/bindings/{binding_id}
```

### 9.4 WebSocket protocol — `GET /api/v1/nodes/ws`

The node agent (running on-prem) connects here over WebSocket and authenticates with its registration token. Live credential rotation, request routing, and metadata exchange happen over this socket. Protocol detail: NyxID's `docs/NODE_PROXY_PROTOCOL.md`.

---

## 10. Developer apps (OAuth clients for "Sign in with NyxID")

```text
GET    /api/v1/developer/oauth-clients
POST   /api/v1/developer/oauth-clients
GET    /api/v1/developer/oauth-clients/{id}
PATCH  /api/v1/developer/oauth-clients/{id}
DELETE /api/v1/developer/oauth-clients/{id}
POST   /api/v1/developer/oauth-clients/{id}/rotate-secret
```

`POST` body:

```jsonc
{
  "name": "My App",
  "redirect_uris": ["https://myapp.example.com/auth/callback"],
  "client_type": "public",                      // "public" | "confidential"
  "allowed_scopes": ["openid", "profile", "email"]
}
```

For `client_type: "confidential"`, the response includes `client_secret` **once**. For `public`, no secret (PKCE expected at the OAuth flow).

`POST .../rotate-secret` returns the new secret (one-time display) and invalidates the old.

---

## 11. OAuth / OIDC routes

```text
GET  /.well-known/openid-configuration                   — OIDC discovery document
GET  /.well-known/jwks.json                              — public signing keys (RS256)
GET  /oauth/authorize                                    — authorization endpoint (browser)
POST /oauth/token                                        — token endpoint
GET  /oauth/userinfo                                     — userinfo endpoint
POST /oauth/userinfo                                     — same, accepts POST too
POST /oauth/introspect                                   — RFC 7662 token introspection
POST /oauth/revoke                                       — RFC 7009 token revocation
```

`POST /oauth/token` grant types:

```text
grant_type=authorization_code   — exchange code (PKCE) for tokens
grant_type=refresh_token        — refresh access token
grant_type=client_credentials   — service-account flow
grant_type=device_code          — device-code grant after polling success
```

`/oauth/userinfo` returns `{ sub, email, email_verified, name, picture, roles, groups, permissions }`. Subject to scope: `openid` is required, `profile` adds name/picture, `email` adds email/email_verified.

---

## 12. Service accounts (server-to-server)

### 12.1 Create — `POST /api/v1/admin/service-accounts`

**Auth: required.** **Admin.**

```jsonc
{ "name": "My Backend Service", "description": "Automated data pipeline" }
```

Response includes `secret` **once** — save it.

### 12.2 Use — `POST /oauth/token`

```bash
curl -X POST "$NYXID_BASE/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=<SERVICE_ACCOUNT_ID>" \
  -d "client_secret=<SECRET>"
```

Token TTL defaults to 1 hour.

---

## 13. Approvals

### 13.1 Configure a service — `PUT /api/v1/approvals/service-configs/{service_id}`

**Auth: required.** Service owner / admin.

```jsonc
{ "approval_required": true, "approval_mode": "per_request" }   // default
{ "approval_required": true, "approval_mode": "grant" }         // legacy — creates time-based grants
```

### 13.2 List requests — `GET /api/v1/approvals/requests`

### 13.3 Request detail — `GET /api/v1/approvals/requests/{id}`

### 13.4 Decide — `POST /api/v1/approvals/requests/{id}/decide`

```jsonc
{ "approved": true }
{ "approved": false, "reason": "Not authorized for production data" }
```

### 13.5 Status (poll) — `GET /api/v1/approvals/requests/{id}/status`

Returns `{ status, expires_at, action_description }` where `status` ∈ `pending | approved | denied`.

### 13.6 Grants (only meaningful in grant mode)

```text
GET    /api/v1/approvals/grants
DELETE /api/v1/approvals/grants/{id}
GET    /api/v1/approvals/service-configs
DELETE /api/v1/approvals/service-configs/{service_id}
```

### 13.7 Proxy responses on gated services

| Status | Meaning |
|---|---|
| `403 7000` | Approval pending — body has `request_id`, `action_description` |
| `403 7001` | Approval failed (rejected, expired, timed out) — body has `approve_url` |

---

## 14. Notifications

```text
GET    /api/v1/notifications/settings
PUT    /api/v1/notifications/settings
POST   /api/v1/notifications/telegram/link
DELETE /api/v1/notifications/telegram
POST   /api/v1/notifications/devices                        — register push notification device
GET    /api/v1/notifications/devices
DELETE /api/v1/notifications/devices/{id}
```

`PUT /settings` body:

```jsonc
{ "approval_email": true, "approval_push": true, "approval_telegram": true, "approval_grants": true }
```

---

## 15. SSH

```text
POST /api/v1/ssh/{service_id}/certificate                   — issue user certificate
POST /api/v1/ssh/{service_id}/exec                          — execute remote command
GET  /api/v1/ssh/{service_id}/terminal                      — interactive terminal (WebSocket upgrade)
GET  /api/v1/ssh/{service_id}                               — SSH tunnel (WebSocket upgrade)
```

Certificate body:

```jsonc
{ "public_key": "ssh-ed25519 AAAA..." }
```

Response: `{ certificate, validity_period }`. Default 30-minute TTL.

Exec body:

```jsonc
{ "command": "uptime" }
```

Response: `{ stdout, stderr, exit_code }`.

WebSocket terminal / tunnel: see NyxID's `docs/SSH_REMOTE_EXEC.md` and `docs/SSH_TUNNELING.md` for the wire protocol.

---

## 16. LLM Gateway

OpenAI-compatible interface that injects user-stored credentials.

```text
GET  /api/v1/llm/status                                     — providers available + caller's keys
ANY  /api/v1/llm/gateway/{path}                             — unified gateway (auto-routes to active provider)
ANY  /api/v1/{provider-slug}/{path}                         — route to specific provider
```

Example (OpenAI-compatible):

```bash
curl "$NYXID_BASE/api/v1/llm/gateway/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

OpenClaw integration via `s/llm-openclaw/`:

```text
POST /api/v1/proxy/s/llm-openclaw/v1/chat/completions       — chat completions
POST /api/v1/proxy/s/llm-openclaw/tools/invoke              — tools / skills
POST /api/v1/proxy/s/llm-openclaw/v1/responses              — OpenResponses API
```

---

## 17. API keys (NyxID-side bearers)

### 17.1 Create — `POST /api/v1/api-keys`

**Auth: required.**

```jsonc
{
  "name": "AI Agent Key",
  "scopes": "read write proxy",                      // space-separated scope list
  "allowed_service_ids": ["<svc-uuid>", ...],         // restrict which services this key can proxy through
  "allowed_node_ids": ["<node-uuid>", ...],           // restrict node routing
  "allow_all_services": true,                         // ignore allowed_service_ids when true (default)
  "allow_all_nodes": true,                            // ignore allowed_node_ids when true (default)
  "callback_url": "https://my-agent.example.com/webhook"  // optional — channel bot relay
}
```

Response includes `full_key` **once** — save it. Format: `nyxid_...`.

### 17.2 List — `GET /api/v1/api-keys`

**Auth: required.** Returns metadata only — never the key value.

### 17.3 Show — `GET /api/v1/api-keys/{id}`

**Auth: required.**

### 17.4 Update — `PUT /api/v1/api-keys/{id}`

**Auth: required.**

```jsonc
{ "allowed_node_ids": [...], "allow_all_services": false, "callback_url": "..." }
```

### 17.5 Rotate — `POST /api/v1/api-keys/{key_id}/rotate`

**Auth: required.** Returns a new value, invalidates the old. One-time display.

### 17.6 Delete — `DELETE /api/v1/api-keys/{key_id}`

**Auth: required.**

### 17.7 Bindings (`/keys/.../bind`)

CLI: `nyxid api-key bind <ID> --service <SLUG>`. Use bindings + `allow_all_services: false` for tightly-scoped agent keys.

---

## 18. Admin

```text
GET  /api/v1/admin/users                                    — list all users
GET  /api/v1/admin/audit-log                                — platform audit log
POST /api/v1/admin/service-accounts                         — create service account (§12)
POST /api/v1/admin/invite-codes                             — mint invite codes
```

`POST /admin/invite-codes` body:

```jsonc
{ "max_uses": 10, "expires_at": "2026-12-31T23:59:59Z" }
```

`max_uses` accepts 1..1000.

---

## 19. Health / readiness / discovery

```text
GET  /health                                                — liveness probe
GET  /livez                                                 — alias for /health
GET  /readyz                                                — readiness (checks DB)
GET  /openapi.json                                          — auto-generated OpenAPI 3 schema
GET  /llms-full.txt                                         — LLM-friendly playbook (auto-derived from docs)
```

---

## 20. Common error codes (cross-cutting)

| Code | Status | Meaning |
|---|---|---|
| `AUTH_MISSING` / `invalid_token` | 401 | No usable identity |
| `FORBIDDEN` | 403 | Authed but missing role / permission / ownership |
| `NOT_FOUND` | 404 | Resource missing or hidden |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `RATE_LIMITED` | 429 | Too many calls |
| `INTERNAL_ERROR` | 500 | Unhandled — capture `X-Request-ID` |

NyxID-specific codes appear per-route; consult the dashboard's error display or NyxID's source for the canonical list.

---

## 21. What's NOT exposed (yet)

The following are **dashboard-only** today; AI agents cannot drive them via API. When the user asks for these, surface the dashboard URL and stop:

- **Org creation, invitation flow, member approval, role binding inside an org** — `<NYXID_FRONTEND>/orgs/<orgId>/members`. See `SKILL.md` §1.4 for the workaround.
- **Email verification template management** — admin dashboard.
- **Custom catalogue service authoring with branded metadata** — admin section under `<NYXID_FRONTEND>/services`.

When in doubt, look at the dashboard first; if there's no UI, the API likely doesn't exist either.
