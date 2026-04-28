# CLAUDE.md — chrono-ornn

## Product Positioning

**Ornn is an agent-facing skill-lifecycle API, not a human marketplace.**

The primary customer is the AI agent developer / agentic-system builder. Agents call Ornn directly — over HTTP or MCP — to manage their own skill lifecycle: search → pull → install → execute → build → upload → share. Closest analog: **npm registry + npm CLI fused, model-agnostic** (works for Claude / GPT / Gemini / custom — not locked to one model runtime).

Implications when proposing or building features:

- Lead with the **agent-API contract** (REST / MCP ergonomics, stable schemas, model-agnostic guarantees) before any human-UX angle.
- `ornn-web` is a *secondary* surface for skill owners and platform admins — it is not the primary product. UI features that don't translate into agent-API value are deprioritized.
- Avoid feature framing that drifts toward "another skill marketplace" (social ranking, browse-style discovery, recommendation feeds, leaderboards) unless we deliberately decide to. When a feature looks marketplace-shaped, surface that tension before building.

## Tech Stack

TypeScript, Bun workspace monorepo

- **Runtime:** Bun (backend + tests), Vite (frontend dev/build)
- **Backend:** Hono
- **Frontend:** React 19, Zustand, TanStack Query, Tailwind CSS 4, Framer Motion, React Router 7
- **Database:** MongoDB 7
- **Validation:** Zod
- **Logging:** Pino
- **Testing:** Bun test (backend); Vitest + Testing Library + jsdom (frontend + TS SDK); pytest + respx (Python SDK). All run in CI — bun packages via `bun run test`, Python via a dedicated `python-sdk-test` job.

**Packages:**

| Package | Path | Description |
|---------|------|-------------|
| `ornn-api` | `ornn-api/` | Backend API (Bun + Hono + MongoDB) |
| `ornn-web` | `ornn-web/` | React SPA (Vite + React 19 + Zustand + TanStack Query) |
| `@chronoai/ornn-sdk` | `ornn-sdk/` | TypeScript client for `/api/v1/*` |
| `ornn-sdk` (Python) | `ornn-sdk-python/` | Python client for `/api/v1/*` (httpx) — separate release cadence |

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
- Tests: `bun run test` runs both (backend via Bun, frontend via Vitest).
- Unit tests colocated with source files. Integration tests in `tests/` directory.
- Always use Docker to run and test locally. Do not run services directly with `bun run dev`. CI builds both `ornn-api` and `ornn-web` images on every PR (`docker-build` job) so Dockerfile breakage surfaces immediately.

## Branching Strategy

- **`main`** — Production release branch. Protected: no direct push, no force push, PRs only from `develop`.
- **`develop`** — Default branch and active development branch. Contains the latest CI-passing code. Protected: no direct push, no force push, PRs from any feature branch.
- **Workflow:** `feature/xxx` → PR → `develop` → PR → `main`
- PR merge auto-deletes the source branch (protected branches excluded).
- **New work MUST branch from the latest `origin/develop`.** Every feature, bug fix, or any kind of change must start from a freshly fetched `develop` — either a new branch (`git fetch && git checkout develop && git pull && git checkout -b <name>`) or a new worktree created against `origin/develop`. Never branch off a stale local `develop` or another feature branch.

## Versioning & Releases

This project uses **Changesets** (`@changesets/cli`) for versioning.

- Both packages (`ornn-api`, `ornn-web`) share a unified version number (fixed mode).
- Each package has its own `CHANGELOG.md`, auto-generated with GitHub PR links.
- Release notes are published on [GitHub Releases](https://github.com/ChronoAIProject/Ornn/releases).

### During development

Every feature PR targeting `develop` MUST include a changeset:

```bash
bun changeset
```

Select affected package(s), semver bump level (`patch` / `minor` / `major`), write a short description. Commit the generated `.changeset/*.md` file with the PR. CI (`check-changeset.yml`) blocks PRs that don't include one — use `bun changeset --empty` for docs-only / CI-only PRs.

### Cutting a release

Fully automated on the `main` side. No local script to run — developer action is "open a PR, review a PR". `.github/workflows/changeset-release.yml` is a state machine driven by `push: main`.

**Step 1 — Promote `develop` → `main`.** Open a PR `develop → main` and merge it. Regular PR; it carries whatever features + unconsumed `.changeset/*.md` files have piled up on `develop` since the last release.

**Step 2 — Review the bot's release-bump PR.** On the `main` push from Step 1, the workflow sees pending `.changeset/*.md` files, so it:

1. Creates branch `release/v<next>` off `main`.
2. Runs `bun run version-packages` — consumes `.changeset/*.md`, bumps both `package.json` files, appends to each `CHANGELOG.md`.
3. Commits `chore: version packages → v<next>`, force-pushes the branch.
4. Opens PR `release/v<next> → main`.

Review that PR. Merge with **Squash and merge** (keeps history linear; `main` ends up with exactly one `chore: version packages → v<next>` commit).

**Step 3 — Tag + GitHub Release + sync back to `develop`.** On the `main` push from Step 2, the workflow sees no pending changesets + `ornn-api/package.json`'s version has no matching `v<version>` tag, so it:

1. Creates an annotated `v<version>` tag and pushes it.
2. Extracts the `## <version>` section from each package's `CHANGELOG.md`, builds a combined body, and calls `gh release create`.
3. Creates branch `sync/post-release-v<version>` from `main`.
4. Opens PR `sync/post-release-v<version> → develop` — **auto-approved + auto-merged** by the same workflow via a direct `PUT /repos/.../pulls/:n/merge` API call with `merge_method: merge`. No human action for the sync step; the PR is a deterministic replay of a commit that already passed CI on `main`.

**Load-bearing:** the sync PR **must** land as a merge commit, not a squash. A squash-merge creates an orphan commit on `develop` whose parent is the pre-bump `develop` tip, not `main`'s bump commit. Subsequent `develop → main` PRs then show a phantom version bump because `git merge-base` walks back past the orphan. A merge commit gives `develop` two parents (previous `develop` HEAD + `main`'s bump), making `merge-base(main, develop)` = `main`'s HEAD after the sync. The workflow calls the API directly so it doesn't fall back to the repo-default merge strategy (often squash).

If branch protection blocks the auto-merge (e.g. stricter required-reviewer rules added later), the PR stays open with a warning log entry — **merge it manually via "Create a merge commit", never "Squash and merge"**.

### State summary (what the workflow does on every `main` push)

| pending `.changeset/*.md` | `v<version>` tag exists | action |
|---|---|---|
| > 0 | — | open `release/v<next> → main` |
| 0 | no | tag, create GH Release, open `sync/post-release-v<version> → develop` |
| 0 | yes | no-op (hotfix / docs / CI push without changeset) |

### Permissions

The workflow needs `contents: write` + `pull-requests: write`. At the org level, "Allow GitHub Actions to create and approve pull requests" must be enabled (set April 2026).

### Hotfixes directly to main

If something lands on `main` without a changeset (emergency patch), state is "0 pending + tag exists" → no-op. No version bump. When you're back on the normal flow, add a proper changeset-carrying PR through `develop` to stamp the next version.

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
# Backend
docker build -t "${ORNN_API_IMAGE}" -f ornn-api/Dockerfile .

# Frontend — no build args. All config (nginx upstreams + Vite env)
# is injected at container startup via the `ornn-web-config` ConfigMap.
docker build -t "${ORNN_WEB_IMAGE}" -f ornn-web/Dockerfile .
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

## GitHub Issue Rules

Issue tracker: https://github.com/ChronoAIProject/Ornn/issues

1. **All ornn work lives as GitHub issues.** Every feature, bug, and proposal MUST be created as an issue on the tracker above. Do NOT write proposals, task specs, or tracking docs under `docs/` — use issues.
2. **Default assignee:** every issue MUST be assigned to `chronoai-shining`.
3. **Title prefix:** every issue title MUST start with a category tag — one of `[Bug]`, `[Feature]`, `[CI/CD]`, `[Docs]`, `[Misc]`. Example: `[Feature] Skill composition & chaining`.
4. **No duplicates.** Before creating a new issue, search the existing issue list. If duplicates are found, keep one and close the others with a comment `Duplicate of #N`.
5. **PR ↔ issue linkage:**
   - Every PR MUST tag the issue(s) it resolves in the PR body (use `Closes #123` / `Fixes #123`).
   - When the PR merges, all tagged issues MUST be closed.
   - If a PR solves something with no existing issue, create the issue first, then tag it in the PR.
6. **Cross-references:** when issues are related or have an execution order, add explicit references in the issue body (`Depends on #X`, `Blocks #Y`, `Related to #Z`).
7. **Milestones for large work:** any large feature or code change MUST have a milestone, and all related issues MUST be attached to it.
8. **Milestone deadlines:** every milestone MUST have a `due_on` date.
9. **Labels:** every issue MUST carry at least one topic label (e.g., `api`, `dx`, `security`, `infra`, `phase:N`) so the issue's domain is visible at a glance.

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
