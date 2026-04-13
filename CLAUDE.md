# CLAUDE.md — chrono-ornn

## Tech Stack

TypeScript, Bun workspace monorepo

- **Runtime:** Bun (backend + tests), Vite (frontend dev/build)
- **Backend:** Hono
- **Frontend:** React 19, Zustand, TanStack Query, Tailwind CSS 4, Framer Motion, React Router 7
- **Database:** MongoDB 7
- **Validation:** Zod
- **Logging:** Pino
- **Testing:** Bun test (backend), Vitest + Testing Library (frontend)

**Packages:**

| Package | Description |
|---------|-------------|
| `ornn-api` | Backend API |
| `ornn-web` | React SPA |

## Architecture

- Two packages: `ornn-api` (backend) and `ornn-web` (web UI).
- All configurable values MUST be read from environment variables. Zero hardcoded config.
- For project domain knowledge (external services, skill format, etc.), see `docs/ARCHITECTURE.md`.

## Code Standards

- TypeScript + Bun. Follow TypeScript and Bun conventions.
- Use `Result` patterns and Zod validation. No bare `try/catch` in routes — use error middleware.
- Keep code simple. Fewer lines > more abstractions.
- All code MUST include sufficient logging (Pino). `info` for lifecycle events, `debug` for detailed flow, `error` for failures with context.
- Logs MUST NOT contain plaintext secrets. Mask or redact sensitive values.
- No hardcoded secrets, credentials, API keys, tokens in code — ever.
- Backend tests: `bun test`. Frontend tests: `vitest run`.
- Unit tests colocated with source files. Integration tests in `tests/` directory.
- Always use Docker to run and test locally. Do not run services directly with `bun run dev`.

## Branching Strategy

- **`main`** — Production release branch. Protected: no direct push, no force push, PRs only from `develop`.
- **`develop`** — Active development branch (default). Protected: no direct push, no force push, PRs from any feature branch.
- **Workflow:** `feature/xxx` → PR → `develop` → PR → `main`
- PR merge auto-deletes the source branch (protected branches excluded).

## Versioning & Releases

This project uses **Changesets** (`@changesets/cli`) for versioning.

- Both packages (`ornn-api`, `ornn-web`) share a unified version number (fixed mode).
- Each package has its own `CHANGELOG.md`, auto-generated with GitHub PR links.
- Release notes are published on [GitHub Releases](https://github.com/aevatarAI/chrono-ornn/releases).

**Workflow:**

1. After completing a feature or fix, create a changeset:
   ```bash
   bun changeset
   ```
   Select affected package(s), semver bump level (`patch`/`minor`/`major`), and write a short description. Commit the generated `.changeset/*.md` file with the PR.

2. When preparing a release, consume all pending changesets:
   ```bash
   bun run version-packages
   ```
   This updates `package.json` versions, appends to `CHANGELOG.md`, and deletes consumed changeset files.

3. Tag the release:
   ```bash
   bun run release
   ```

4. Merge `develop` → `main` via PR, then create a GitHub Release with release notes.

## Scripts

```bash
bun install          # install all dependencies
bun run test         # run backend tests
bun run lint         # run ESLint
bun run typecheck    # run TypeScript type check (frontend)
bun run build:web    # build frontend for production
```

## Docker

### ornn-api

```bash
docker build -t ornn-api -f ornn-api/Dockerfile .
docker run -e NYXID_JWKS_URL=... -e NYXID_ISSUER=... ornn-api
```

Runtime environment variables:

| Variable | Required | Default |
|----------|----------|---------|
| `NYXID_JWKS_URL` | yes | |
| `NYXID_ISSUER` | yes | |
| `NYXID_AUDIENCE` | yes | |
| `NYXID_INTROSPECTION_URL` | yes | |
| `NYXID_TOKEN_URL` | yes | |
| `NYXID_CLIENT_ID` | yes | |
| `NYXID_CLIENT_SECRET` | yes | |
| `NYX_LLM_GATEWAY_URL` | yes | |
| `MONGODB_URI` | yes | |
| `STORAGE_SERVICE_URL` | yes | |
| `SANDBOX_SERVICE_URL` | yes | |
| `PORT` | no | 3802 |
| `MONGODB_DB` | no | ornn |
| `STORAGE_BUCKET` | no | ornn |
| `LOG_LEVEL` | no | info |
| `DEFAULT_LLM_MODEL` | no | gpt-4o |

### ornn-web

```bash
docker build -t ornn-web -f ornn-web/Dockerfile \
  --build-arg VITE_API_BASE_URL=... \
  --build-arg VITE_NYXID_AUTHORIZE_URL=... \
  .
```

Build args (baked into static bundle at build time):

| Build Arg | Required |
|-----------|----------|
| `VITE_API_BASE_URL` | yes |
| `VITE_NYXID_AUTHORIZE_URL` | yes |
| `VITE_NYXID_TOKEN_URL` | yes |
| `VITE_NYXID_CLIENT_ID` | yes |
| `VITE_NYXID_REDIRECT_URI` | yes |
| `VITE_NYXID_LOGOUT_URL` | yes |

## Git Rules

- **Never** include `Co-Authored-By` lines in commit messages.
- **Never** auto-push without explicit user approval.
- **Never** force push.
- Single `.gitignore` at repo root only. Must ignore `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`.
