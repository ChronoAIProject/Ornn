# API Route Refactor — NyxID Proxy Integration

## Goal

Merge the two route sets (`/api/web` and `/api/agent`) into a single `/api` prefix, and route all traffic through NyxID proxy. ornn-api stops doing its own JWT verification.

## Current Architecture

```
Browser → ornn-web (nginx) → ornn-api /api/web/*   [jwtAuthSetup — JWKS + introspection]
Agent   → NyxID proxy      → ornn-api /api/agent/* [proxyAuthSetup — trust X-NyxID-* headers]
```

- `/api/web` routes: skillCrud, search, generation, playground, admin, format, docs
- `/api/agent` routes: skillCrud, search, generation
- Two separate OpenAPI specs (`/api/web/openapi.json`, `/api/agent/openapi.json`)
- ornn-api manages its own JWT verification (JWKS fetch, introspection call)

### Problems

1. Two route prefixes for the same handlers — unnecessary complexity
2. ornn-api duplicates NyxID's auth logic (JWKS verification, token introspection)
3. Agent routes expose fewer endpoints than web routes for no good reason
4. Two OpenAPI specs to maintain

## Target Architecture

```
Browser → ornn-web (nginx) → NyxID proxy → ornn-api /api/*  [proxyAuthSetup]
Agent   → NyxID proxy      → ornn-api /api/*                [proxyAuthSetup]
```

- Single `/api` prefix with all routes
- Single auth strategy: trust NyxID proxy headers (`X-NyxID-User-Id`, `X-NyxID-User-Email`, `X-NyxID-User-Roles`, `X-NyxID-User-Permissions`)
- Single OpenAPI spec (`/api/openapi.json`)
- ornn-api does zero JWT verification

## Changes Required

### 1. NyxID — Register ornn-api as a service

In NyxID dashboard (`http://nyxid.ornn-cluster.local`):

- Service Name: `ornn-api`
- Base URL: `http://ornn-api:3802`
- Auth Type: **Bearer Token**
- Service Category: External Service
- Visibility: Public

After creation, note the service slug (should be `ornn-api`). The proxy URL will be:
```
http://nyxid-backend:3001/api/v1/proxy/s/ornn-api/...
```

### 2. ornn-api — Backend changes

#### 2a. bootstrap.ts — Merge routes

Replace the dual route setup:

```typescript
// BEFORE
const webApp = new Hono();
webApp.use("*", jwtAuthSetup({...}));
webApp.route("/", skillRoutes);
// ... more routes
app.route("/api/web", webApp);

const agentApp = new Hono();
agentApp.use("*", proxyAuthSetup());
agentApp.route("/", skillRoutes);
// ... fewer routes
app.route("/api/agent", agentApp);
```

With a single route set:

```typescript
// AFTER
const apiApp = new Hono();
apiApp.use("*", proxyAuthSetup());
apiApp.route("/", skillRoutes);
apiApp.route("/", searchRoutes);
apiApp.route("/", generationRoutes);
apiApp.route("/", playgroundRoutes);
apiApp.route("/", adminRoutes);
apiApp.route("/", formatRoutes);
apiApp.route("/", docsRoutes);
app.route("/api", apiApp);
```

#### 2b. Remove jwtAuthSetup

Delete or deprecate `jwtAuthSetup()` in `middleware/nyxidAuth.ts`. It is no longer called. Keep `proxyAuthSetup()`, `nyxidAuthMiddleware()`, `getAuth()`, permission helpers.

#### 2c. Remove JWT-related config

In `infra/config.ts`, remove:
- `nyxidJwksUrl`
- `nyxidIssuer`
- `nyxidAudience`
- `nyxidIntrospectionUrl`

Keep (still needed for SA token to call LLM gateway, storage, sandbox):
- `nyxidTokenUrl`
- `nyxidClientId`
- `nyxidClientSecret`

#### 2d. Merge OpenAPI spec

In `openapi/specBuilder.ts`:
- Merge `buildWebSpec()` and `buildAgentSpec()` into a single `buildSpec()`
- Include all paths (skill CRUD, search, generation, playground, admin, format)
- Single endpoint: `GET /api/openapi.json`

#### 2e. Update route files that import from ornn-shared

The old route files (`skillRoutes.ts`, `formatRulesRoutes.ts`, `skillGenerateRoutes.ts`) import `createAuthMiddleware` from shared types. These files use the old pattern of creating auth middleware from a `TokenVerifier`. Since we're removing JWT verification, these files should be updated to use `nyxidAuthMiddleware()` from `middleware/nyxidAuth.ts` instead of `createAuthMiddleware(tokenService)`.

Files to update:
- `domains/skillCrud/routes/skillRoutes.ts`
- `domains/skillCrud/routes/formatRulesRoutes.ts`
- `domains/skillGeneration/routes/skillGenerateRoutes.ts`

These are older route files that may be dead code (superseded by `domains/skillCrud/routes.ts`, `domains/skillGeneration/routes.ts`). Verify and delete if unused.

### 3. ornn-web — Frontend changes

#### 3a. nginx.conf — Proxy through NyxID

Change the API proxy target from direct ornn-api to NyxID proxy:

```nginx
# BEFORE
location /api/web/ {
    proxy_pass http://ornn-api:3802;
    ...
}

# AFTER
location /api/ {
    proxy_pass http://nyxid-backend:3001/api/v1/proxy/s/ornn-api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE support
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
    proxy_buffering off;
    proxy_cache off;
}
```

This means:
- Browser requests `http://ornn.ornn-cluster.local/api/skills` 
- nginx proxies to `http://nyxid-backend:3001/api/v1/proxy/s/ornn-api/skills`
- NyxID validates Bearer token, injects headers, forwards to `http://ornn-api:3802/api/skills`

#### 3b. Frontend API paths

All frontend API calls currently use `/api/web/...` paths. Update to `/api/...`:

- `/api/web/skills` → `/api/skills`
- `/api/web/skill-search` → `/api/skill-search`
- `/api/web/skills/generate` → `/api/skills/generate`
- `/api/web/playground/chat` → `/api/playground/chat`
- `/api/web/admin/*` → `/api/admin/*`
- `/api/web/docs/*` → `/api/docs/*`

Search for `/api/web/` and `/api/agent/` across all frontend files and update.

#### 3c. VITE_API_BASE_URL

This env var can stay as-is (empty or `""`) since the frontend makes relative requests to the same origin, and nginx handles the proxying.

#### 3d. Auth flow — No changes needed

The OAuth flow (authorize → callback → token exchange → Bearer header) stays exactly the same. The frontend already sends `Authorization: Bearer <token>` on every request. NyxID proxy will read this token and authenticate.

### 4. Deployment changes

#### 4a. ornn-api configmap

Remove from `deployment/ornn-api/configmap.yaml`:
- `NYXID_JWKS_URL`
- `NYXID_ISSUER`
- `NYXID_AUDIENCE`
- `NYXID_INTROSPECTION_URL`

Remove from `.env.sample.ornn` and `.env.ornn` accordingly.

#### 4b. ornn-web nginx.conf

Already covered in section 3a. Remove the separate `/api/web/`, `/api/agent/`, `/api/auth`, `/api/users` location blocks. Replace with single `/api/` block.

### 5. Cleanup

After refactoring, delete:
- `jwtAuthSetup()` function in `middleware/nyxidAuth.ts` (and its `JwtAuthConfig` interface)
- `jose` dependency from `ornn-api/package.json` (no longer doing JWKS verification)
- `buildWebSpec()` and `buildAgentSpec()` — replaced by `buildSpec()`
- Old duplicate route files if confirmed dead code:
  - `domains/skillCrud/routes/skillRoutes.ts` (if superseded by `domains/skillCrud/routes.ts`)
  - `domains/skillCrud/routes/formatRulesRoutes.ts`
  - `domains/skillGeneration/routes/skillGenerateRoutes.ts` (if superseded by `domains/skillGeneration/routes.ts`)
- `createAuthMiddleware` and `TokenVerifier` from `shared/types/index.ts` (if no longer referenced)
- `services/jwtVerifier.ts` (local JWT verifier, no longer needed)

### 6. Testing

- Update test files that mock `TokenVerifier` or `createAuthMiddleware` — use `proxyAuthSetup` pattern instead (set auth context directly)
- All existing route tests should pass with proxy-header auth mocking
- Manual testing:
  1. Login via NyxID OAuth on `http://ornn.ornn-cluster.local`
  2. Verify API calls go through NyxID proxy (check NyxID backend logs)
  3. Verify skill CRUD, search, generation, playground, admin all work
  4. Verify agent access via MCP tools still works

### 7. Migration checklist

- [ ] Register ornn-api in NyxID as Bearer Token service
- [ ] ornn-api: merge routes into `/api`
- [ ] ornn-api: remove `jwtAuthSetup`, use only `proxyAuthSetup`
- [ ] ornn-api: remove JWKS/introspection config
- [ ] ornn-api: merge OpenAPI specs
- [ ] ornn-api: clean up old route files and dead code
- [ ] ornn-web: update nginx to proxy `/api/` through NyxID
- [ ] ornn-web: update all `/api/web/` paths to `/api/`
- [ ] ornn-web: remove `/api/agent/` references
- [ ] deployment: update configmap and env files
- [ ] tests: update mocks for proxy-header auth
- [ ] manual test: full flow on local cluster
