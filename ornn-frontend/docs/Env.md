# ornn-frontend Environment Variables

## Client-Side Variables (Vite)

All client-side environment variables must be prefixed with `VITE_` to be exposed to the browser bundle by Vite.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_AUTH_URL` | No | `http://localhost:3801` | Auth service URL (used by Vite dev proxy) |
| `VITE_SKILL_URL` | No | `http://localhost:3802` | Skill service URL (used by Vite dev proxy) |
| `VITE_PLAYGROUND_URL` | No | `http://localhost:3803` | Playground service URL (used by Vite dev proxy) |

These variables are defined in `.env.development` for local development. In production, the nginx reverse proxy handles API routing using Docker service names, so these variables are not needed in the production build.

## Docker Compose Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ORNN_FRONTEND_PORT` | No | `5847` | Host port mapping for the frontend container |

## Notes

- The frontend is a static SPA. No server-side environment variables are needed at runtime.
- API routing in development is handled by Vite's proxy configuration in `vite.config.ts`.
- API routing in production is handled by the nginx config (`nginx.conf`), which proxies to backend Docker services by name.
- Secrets and credentials are never stored in the frontend. All sensitive operations go through the backend APIs.
