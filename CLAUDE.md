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
- Docker orchestration lives in `chrono-docker-compose` (separate repo). **Never** create docker-compose files in this repo.
- Each package has its own `Dockerfile`. Dockerfiles MUST NOT contain `ENV` definitions.
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

## Git Rules

- **Never** include `Co-Authored-By` lines in commit messages.
- **Never** auto-push without explicit user approval.
- **Never** force push.
- Single `.gitignore` at repo root only. Must ignore `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`.
