<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="ornn-web/public/logo-dark.svg">
    <img src="ornn-web/public/logo-light.svg" width="320" alt="Ornn" />
  </picture>
</p>

<h1 align="center">Ornn</h1>

<p align="center">
  <a href="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml"><img src="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ChronoAIProject/Ornn/releases"><img src="https://img.shields.io/github/v/release/ChronoAIProject/Ornn" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChronoAIProject/Ornn" alt="License" /></a>
</p>

<p align="center">The agent-facing skill-lifecycle API for AI agents.</p>

---

## What is Ornn

Ornn is an **agent-facing skill-lifecycle API**, not a human marketplace.

The primary consumer is the AI agent developer / agentic-system builder. Agents call Ornn directly — over HTTP or MCP — to manage their own skill lifecycle:

```
search → pull → install → execute → build → upload → share
```

Closest analog: **npm registry + npm CLI fused, model-agnostic** — works for Claude, GPT, Gemini, or any custom runtime. Not locked to a single model.

`ornn-web` is a secondary surface for skill owners and platform admins; it is not the primary product.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `ornn-api` | [`ornn-api/`](ornn-api/) | Backend API (Bun + Hono + MongoDB) |
| `ornn-web` | [`ornn-web/`](ornn-web/) | React SPA (Vite + React 19 + Zustand + TanStack Query) |
| `@chronoai/ornn-sdk` | [`sdk/typescript/`](sdk/typescript/) | TypeScript client for `/api/v1/*` |
| `ornn-sdk` (Python) | [`sdk/python/`](sdk/python/) | Python client for `/api/v1/*` (httpx) — separate release cadence |

## Tech Stack

- **Language / runtime:** TypeScript on Bun (workspace monorepo); Vite for the frontend dev / build.
- **Backend:** Hono on Bun.
- **Frontend:** React 19, Zustand, TanStack Query, Tailwind CSS 4, Framer Motion, React Router 7.
- **Database:** MongoDB 7.
- **Validation:** Zod.
- **Logging:** Pino.
- **Tests:** Bun test (backend); Vitest + Testing Library + jsdom (frontend + TS SDK); pytest + respx (Python SDK).

## Architecture

Two packages — `ornn-api` (backend) and `ornn-web` (web UI). All configurable values come from environment variables; no hardcoded config.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for external services, skill format, and the observability pipeline.

## Documentation

Full documentation lives at [ornn.chrono-ai.fun/docs](https://ornn.chrono-ai.fun/docs).

## License

[Apache License 2.0](LICENSE)
