# ornn-frontend

Web frontend for the Ornn skill platform. Provides the user interface for browsing, creating, managing, and testing AI skills.

## Tech Stack

- **Runtime:** Bun
- **Framework:** React 19 with React Router 7
- **Build Tool:** Vite 6
- **Language:** TypeScript 5.7
- **Styling:** Tailwind CSS 4 with custom neon theme
- **State Management:** Zustand 5 (auth, playground, search, import, toast stores)
- **Data Fetching:** React Query 5 (TanStack Query)
- **Forms:** React Hook Form + Zod validation
- **Animations:** Framer Motion
- **Markdown:** react-markdown with remark-gfm and rehype-highlight
- **Testing:** Vitest + Testing Library

## Port

`5847` (development server and production nginx)

## Getting Started

### Install dependencies

```bash
bun install
```

### Run locally (development)

```bash
bun run dev
```

The Vite dev server starts on `http://localhost:5847` and proxies API requests to the backend services automatically.

### Build for production

```bash
bun run build
```

Output is written to `dist/`.

### Run tests

```bash
bun test
```

### Type check

```bash
bun run lint
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_AUTH_URL` | No | `http://localhost:3801` | Auth service URL (dev proxy) |
| `VITE_SKILL_URL` | No | `http://localhost:3802` | Skill service URL (dev proxy) |
| `VITE_PLAYGROUND_URL` | No | `http://localhost:3803` | Playground service URL (dev proxy) |

In development, the Vite dev server proxy handles API routing so these variables are not strictly required. In production, nginx handles proxy routing using Docker service names.

## Docker

The production image is a multi-stage build: Bun installs dependencies and builds the SPA, then nginx serves the static files and proxies API requests to backend services.

```bash
docker build -f ornn-frontend/Dockerfile -t ornn-frontend .
docker run -p 5847:5847 ornn-frontend
```
