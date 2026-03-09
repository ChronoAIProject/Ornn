# CLAUDE.md — chrono-ornn

## Project Overview

chrono-ornn is an AI skill platform. Users create, publish, search, and execute AI skills (packaged prompts + scripts) via a web UI or API. Authentication and LLM calls go through NyxID. Script execution runs in chrono-sandbox.

**Tech stack:** TypeScript, Bun workspace monorepo

- **Runtime:** Bun (backend + tests), Vite (frontend dev/build)
- **Backend framework:** Hono
- **Frontend:** React 19, Zustand, TanStack Query, Tailwind CSS 4, Framer Motion, React Router 7
- **Databases:** MongoDB 7, Milvus 2.5 (vector search), SQLite (credential encryption)
- **Object storage:** chrono-storage (S3-compatible backend)
- **AI/LLM:** Nyx Provider (NyxID LLM Gateway, Responses API format)
- **Sandbox:** chrono-sandbox (OpenSandbox-based, supports Node.js + Python)
- **Auth:** NyxID (OAuth, JWT, API keys)
- **Validation:** Zod
- **Logging:** Pino
- **Testing:** Bun test (backend), Vitest + Testing Library (frontend)

**Packages:**

| Package | Description |
|---------|-------------|
| `ornn-skill` | Backend API — skill CRUD, search, AI generation, playground chat, admin |
| `ornn-frontend` | React SPA — skill browsing, creation, playground, admin |

---

## Architecture Rules

1. This project has exactly two packages: `ornn-skill` (backend) and `ornn-frontend` (web UI).
2. All Docker orchestration lives in `chrono-docker-compose` (separate repo). **Never** create or maintain docker-compose files in this repo.
3. There is exactly ONE `.gitignore` at the repo root. No nested `.gitignore` files.
4. All configurable values MUST be read from environment variables. Zero hardcoded config.
5. Each package has its own `Dockerfile`. Dockerfiles MUST NOT contain `ENV` definitions.

## External Services

| Service | How ornn-skill talks to it |
|---------|---------------------------|
| NyxID | JWT verification (JWKS), API key introspection, LLM Gateway (Responses API) |
| chrono-sandbox | `POST /execute` — script execution with env vars, dependencies, file retrieval |
| chrono-storage | Upload/download/delete skill packages (presigned URLs) |

## Skill Format

- Available runtimes: `node`, `python`
- Frontmatter field for dependencies: `runtime-dependency` (formerly `npmDependencies` in generation schema — now `dependencies`)
- Category types: `plain`, `tool-based`, `runtime-based`, `mixed`
- Output types: `text` (stdout), `file` (generated files retrieved via glob)

## Code Standards

6. TypeScript + Bun. Follow TypeScript and Bun conventions.
7. Use `Result` patterns and Zod validation. No bare `try/catch` in routes — use error middleware.
8. Keep code simple. Fewer lines > more abstractions.

## Security Rules

9. `.gitignore` MUST ignore: `.env`, `.env.*` (except committed dev configs), `*.pem`, `*.key`, `credentials.json`.
10. No hardcoded secrets, credentials, API keys, tokens in code — ever.
11. Logs MUST NOT contain plaintext secrets. Mask or redact sensitive values.

## Logging

12. All code MUST include sufficient logging (Pino).
13. `info` for lifecycle events, `debug` for detailed flow, `error` for failures with context.

## Testing Rules

14. Backend tests: Bun test (`bun test`). Frontend tests: Vitest (`vitest run`).
15. Unit tests colocated with source files. Integration tests in `tests/` directory.
16. Target test coverage > 80%.

## Git Rules

17. **Never** include `Co-Authored-By` lines in commit messages.
18. **Never** auto-push without explicit user approval.
19. **Never** force push.
20. Single `.gitignore` at repo root only.
