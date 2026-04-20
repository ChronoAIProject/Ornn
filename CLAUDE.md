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

## Local Deployment

All services run in a local Kubernetes cluster (namespace: `ornn-cluster`). K8s manifests are in `deployment/`, split into:

- `deployment/ornn-api/` and `deployment/ornn-web/` — ornn services (built from this repo)
- `deployment/dependencies/` — dependency services (pre-built images)

### Directory structure

```
deployment/
├── .env.sample.ornn              → copy to .env.ornn
├── ornn-api/                     (configmap, secret, deployment, service)
├── ornn-web/                     (deployment, service)
└── dependencies/
    ├── .env.sample.dependencies  → copy to .env.dependencies
    ├── mongodb/
    ├── minio/
    ├── opensandbox/              (Helm chart — see README.md)
    ├── nyxid-backend/
    ├── nyxid-frontend/
    ├── chrono-storage/
    └── chrono-sandbox/
```

### Service dependency order

```
Layer 1 (no dependencies):    mongodb, minio, opensandbox
Layer 2:                      nyxid-backend       → mongodb
                              chrono-storage      → minio
                              chrono-sandbox      → opensandbox
Layer 3:                      nyxid-frontend      → nyxid-backend
                              ornn-api            → mongodb, nyxid-backend
Layer 4:                      ornn-web             → ornn-api
```

### Step 1: Create namespace

```bash
kubectl create namespace ornn-cluster
```

### Step 2: Build dependency images

Clone and build the dependency services (only needed on first setup or when updating):

| Service | Repo | Build command |
|---------|------|---------------|
| nyxid-backend | `https://github.com/ChronoAIProject/NyxID.git` | `docker build -t nyxid-backend -f backend/Dockerfile .` |
| nyxid-frontend | `https://github.com/ChronoAIProject/NyxID.git` | `docker build -t nyxid-frontend -f frontend/Dockerfile frontend/` |
| chrono-storage | `https://github.com/aevatarAI/chrono-storage.git` | `docker build -t chrono-storage .` |
| chrono-sandbox | `https://github.com/aevatarAI/chrono-sandbox.git` | `docker build -t chrono-sandbox .` |

MongoDB, MinIO, and OpenSandbox use public images — no build needed.

### Step 3: Install OpenSandbox (Helm)

```bash
helm upgrade --install opensandbox \
  https://github.com/alibaba/OpenSandbox/releases/download/helm/opensandbox/0.1.0/opensandbox-0.1.0.tgz \
  --namespace opensandbox-system --create-namespace \
  -f deployment/dependencies/opensandbox/values.yaml
```

### Step 4: Create NyxID JWT keys secret

NyxID backend needs RSA keys for JWT signing. Create the secret from local PEM files:

```bash
set -a; source deployment/dependencies/.env.dependencies; set +a
kubectl create secret generic nyxid-jwt-keys \
  --from-file=private.pem="${NYXID_KEYS_DIR}/private.pem" \
  --from-file=public.pem="${NYXID_KEYS_DIR}/public.pem" \
  -n "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
```

### Step 5: Deploy dependencies

```bash
set -a; source deployment/dependencies/.env.dependencies; set +a
VARS=$(grep -v '^#' deployment/dependencies/.env.dependencies | grep '=' | cut -d= -f1 | sed 's/^/$/g' | tr '\n' ',')
for dir in mongodb minio nyxid-backend nyxid-frontend chrono-storage chrono-sandbox; do
  for f in deployment/dependencies/$dir/*.yaml; do
    envsubst "$VARS" < "$f" | kubectl apply -f -
  done
done
```

### Step 6: Build ornn images (run from repo root)

```bash
# Source env for build args
set -a; source deployment/.env.ornn; set +a

# Backend
docker build -t "${ORNN_API_IMAGE}" -f ornn-api/Dockerfile .

# Frontend (build args baked into static bundle)
docker build -t "${ORNN_WEB_IMAGE}" \
  --build-arg VITE_API_BASE_URL="${VITE_API_BASE_URL}" \
  --build-arg VITE_NYXID_AUTHORIZE_URL="${VITE_NYXID_AUTHORIZE_URL}" \
  --build-arg VITE_NYXID_TOKEN_URL="${VITE_NYXID_TOKEN_URL}" \
  --build-arg VITE_NYXID_CLIENT_ID="${VITE_NYXID_CLIENT_ID}" \
  --build-arg VITE_NYXID_REDIRECT_URI="${VITE_NYXID_REDIRECT_URI}" \
  --build-arg VITE_NYXID_LOGOUT_URL="${VITE_NYXID_LOGOUT_URL}" \
  -f ornn-web/Dockerfile .
```

### Step 7: Deploy ornn

```bash
set -a; source deployment/.env.ornn; set +a
VARS=$(grep -v '^#' deployment/.env.ornn | grep '=' | cut -d= -f1 | sed 's/^/$/g' | tr '\n' ',')
for dir in ornn-api ornn-web; do
  for f in deployment/$dir/*.yaml; do
    envsubst "$VARS" < "$f" | kubectl apply -f -
  done
done
```

### Verify

```bash
kubectl get pods -n ornn-cluster
```

### Environment variables

- `deployment/.env.sample.ornn` — ornn-api and ornn-web config. Copy to `deployment/.env.ornn`.
- `deployment/dependencies/.env.sample.dependencies` — all dependency service config. Copy to `deployment/dependencies/.env.dependencies`.

### Using the NyxID CLI against local cluster

The NyxID CLI (`nyxid`) cannot verify the local ingress TLS cert (mkcert-signed) — the binary is built without `rustls-native-certs` and has no flag to trust custom CAs. Workaround: bypass TLS via `kubectl port-forward` and use `--password` login to skip browser OAuth.

```bash
# Run in a dedicated terminal and keep alive
kubectl port-forward -n ornn-cluster svc/nyxid-backend 3001:3001

# In another terminal
nyxid login --base-url http://localhost:3001 --password --email <your-email>
```

Notes:

- `kubectl port-forward` opens a TCP tunnel from `localhost:3001` to the `nyxid-backend` service inside the cluster; closing the command closes the tunnel.
- Tokens are written to `~/.nyxid/` and persist across CLI invocations, but the port-forward must be running for any CLI call that hits the backend.
- To switch back to staging: `nyxid logout && nyxid login --base-url https://nyx-api.chrono-ai.fun`.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available skills

- `/office-hours` - YC Office Hours (startup diagnostic + builder brainstorm)
- `/plan-ceo-review` - CEO review plan
- `/plan-eng-review` - Engineering review plan
- `/plan-design-review` - Design review plan
- `/design-consultation` - Design system from scratch
- `/design-shotgun` - Visual design exploration
- `/design-html` - Design to HTML
- `/review` - PR review
- `/ship` - Ship workflow
- `/land-and-deploy` - Merge, deploy, canary verify
- `/canary` - Post-deploy monitoring loop
- `/benchmark` - Performance regression detection
- `/browse` - Headless browser for QA, testing, and web browsing
- `/connect-chrome` - Launch GStack Browser
- `/qa` - QA testing with fixes
- `/qa-only` - Report-only QA (no fixes)
- `/design-review` - Design audit + fix loop
- `/setup-browser-cookies` - Browser cookie setup
- `/setup-deploy` - One-time deploy config
- `/retro` - Retrospective (includes global cross-project mode)
- `/investigate` - Systematic root-cause debugging
- `/document-release` - Post-ship doc updates
- `/codex` - Multi-AI second opinion via OpenAI Codex CLI
- `/cso` - OWASP Top 10 + STRIDE security audit
- `/autoplan` - Auto-review pipeline (CEO, design, eng)
- `/plan-devex-review` - DevEx review plan
- `/devex-review` - DevEx review
- `/careful` - Careful mode
- `/freeze` - Freeze changes
- `/guard` - Guard mode
- `/unfreeze` - Unfreeze changes
- `/gstack-upgrade` - Upgrade gstack
- `/learn` - Learn from context

## Git Rules

- **Never** include `Co-Authored-By` lines in commit messages.
- **Never** auto-push without explicit user approval.
- **Never** force push.
- Single `.gitignore` at repo root only. Must ignore `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
