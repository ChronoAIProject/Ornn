# Contributing to Ornn

Thanks for your interest in Ornn. This guide covers everything an external contributor needs: how to set up the repo, how we branch, how we shape commits, how we wire PRs to issues, and how releases are cut.

If you only read one section, read **[Issue-first workflow](#issue-first-workflow)** — every PR must link a GitHub issue, no exceptions.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Getting set up](#getting-set-up)
- [Issue-first workflow](#issue-first-workflow)
- [Branching strategy](#branching-strategy)
- [Commit standards](#commit-standards)
- [Changesets (required on every PR)](#changesets-required-on-every-pr)
- [Pull requests](#pull-requests)
- [Code standards](#code-standards)
- [Tests](#tests)
- [Releases](#releases)
- [Where to ask questions](#where-to-ask-questions)

---

## Code of Conduct

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Getting set up

**For unit tests, lint, typecheck (most PRs):** [Bun](https://bun.sh) + Docker.

```bash
git clone https://github.com/ChronoAIProject/Ornn.git
cd Ornn
bun install
bun run test       # backend (Bun) + frontend (Vitest)
bun run lint
bun run typecheck
bun run build:web
```

**For running the services locally (`docker compose`):**

```bash
cp .env.compose.sample .env
docker compose up --build
```

Brings up MongoDB, MinIO, `ornn-api`, and `ornn-web`. Auth layer (NyxID) stays external — point at your own NyxID instance via env, or stick to the public endpoints (`/livez`, `/api/v1/skill-format/rules`, etc.) which work without auth. Issue #466.

**For full integration runs (incl. NyxID, chrono-storage, chrono-sandbox, opensandbox):** local Kubernetes cluster. Long-form setup is in `CLAUDE.md` under "Local Deployment". You do not need the full cluster to land most PRs — unit tests + the `docker compose` stack are sufficient for the vast majority.

## Issue-first workflow

**Every PR must link to at least one GitHub issue.** This is load-bearing — it lets us track work, attribute changes, and auto-close issues on merge.

1. **Before opening a PR, find or create a matching issue.**
2. If no issue exists, create one using an [issue template](https://github.com/ChronoAIProject/Ornn/issues/new/choose). The template prefills:
   - Title prefix — one of `[Bug]`, `[Feature]`, `[CI/CD]`, `[Docs]`, `[Misc]`
   - Default assignee
   - At least one topic label
3. Link the issue in your PR body using `Closes #N`, `Fixes #N`, or `Resolves #N` — these keywords auto-close the issue on merge. Prose like "this addresses #N" does **not** auto-close and will be rejected at review.

A PR without an issue link will be held until one is added.

### When to use Discussions instead

- Open-ended ideas, RFCs, brainstorming → [Discussions → Ideas](https://github.com/ChronoAIProject/Ornn/discussions/categories/ideas)
- Usage questions → [Discussions → Q&A](https://github.com/ChronoAIProject/Ornn/discussions/categories/q-a)

Question-shaped issues will be converted to discussions.

## Branching strategy

- **`main`** — production. Protected. PRs only from `develop`. No direct pushes, no force pushes.
- **`develop`** — default branch, active development. Protected. PRs accepted from any feature branch.
- **`feature/<short-name>`** — your branch. Must be created from the latest `origin/develop`.

```bash
git fetch origin
git checkout develop
git pull
git checkout -b feature/short-name
```

Never branch off a stale local `develop` or another feature branch.

## Commit standards

Multiple small, self-contained commits are always better than one big combined commit. This is non-negotiable.

Rules:

1. **Each commit is self-contained.** A reviewer reading just that commit's diff and message can understand what changed and why.
2. **Each commit is small.** One logical change per commit. Schema migration is one commit. New endpoint is another. Frontend drawer is another. Old-page deletion is another.
3. **Each commit's message is detailed.** Subject line ≤ 72 chars, in conventional-commit style (`feat(api):`, `fix(web):`, `chore(repo):`, `docs:`). Body explains *why*, the constraints, and any non-obvious decisions. Reference the linked issue.
4. **Order matters.** Stack commits in dependency order so each intermediate commit compiles and tests pass.
5. **Refactors go in their own commit.** Pure refactor first, behaviour change on top. Never bury a fix inside a "drive-by cleanup."
6. **No `Co-Authored-By` trailers.** Single-author commits only.

Example for a feature that touches schema + API + frontend:

```
feat(api): extend Foo schema with bar flag (#NNN)
feat(api): migration — populate Foo.bar from legacy table (#NNN)
feat(api): PATCH /admin/foo/:id/bar endpoint (#NNN)
feat(web): FooDrawer wires the new bar toggle (#NNN)
chore(web): drop deprecated foo-bar select (#NNN)
docs: changeset for #NNN
```

Six commits is fine. One commit covering all of the above is **not fine** — it forecloses bisection and forces the reviewer to re-do the decomposition.

## Changesets (required on every PR)

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions. `ornn-api` and `ornn-web` share a unified version (fixed-linked mode).

Every PR targeting `develop` must include a changeset. CI blocks PRs without one.

```bash
bun changeset
```

Select the affected package(s), pick a semver bump level (`patch`, `minor`, `major`), and write a short user-facing description. Commit the generated `.changeset/*.md` file with your PR.

For docs-only, CI-only, or config-only PRs that should not bump the version, use:

```bash
bun changeset --empty
```

## Pull requests

- Target branch: `develop` (or `main` only when promoting a release).
- PR title follows the same conventional-commit style as commits.
- PR body must use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) — it includes the `Closes #N` field and the commit-decomposition checklist.
- Required checks: CI (lint, typecheck, tests, Docker build), changeset presence, branch policy.
- A maintainer review is required before merge; CODEOWNERS gates trust-critical paths (workflows, Dockerfiles, deployment, package manifests).
- Branches auto-delete on merge.

## Code standards

- TypeScript + Bun on the backend; React 19 + Vite + Tailwind on the frontend.
- Use `Result` patterns and Zod validation. No bare `try/catch` in routes — use error middleware.
- Read all configurable values from environment variables. No hardcoded config.
- No hardcoded secrets, credentials, API keys, or tokens — ever.
- Include sufficient logging (Pino). `info` for lifecycle events, `debug` for detailed flow, `error` for failures with context. Never log plaintext secrets.
- Fewer lines > more abstractions. Keep code simple.
- Project domain knowledge: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).
- Visual / UI changes: see [`docs/DESIGN.md`](docs/DESIGN.md) before deviating from the design system.

### Supply-chain hygiene

- **Dependabot** (configured in [`.github/dependabot.yml`](.github/dependabot.yml)) opens grouped weekly PRs for npm/bun, pip, GitHub Actions, and Docker base images. Treat its PRs as first-class — review on the same cadence as feature work.
- **`bun audit`** is the local-and-CI vulnerability gate. The CI `audit` job blocks any PR that introduces a **high** or **critical** advisory; moderate+ advisories show up in the PR step summary but don't block. Before opening a PR, run `bun audit --audit-level=high` locally to catch regressions.
- **Security disclosure** never goes through public issues or PRs — use the Private Vulnerability Reporting flow in [`SECURITY.md`](SECURITY.md).

## Tests

- Unit tests are colocated with source files.
- Integration tests live in `tests/`.
- Run everything locally with `bun run test`.
- All checks run in CI on every PR.

## Releases

Releases are fully automated via Changesets. Maintainer-driven; contributors don't need to do anything beyond including a changeset on each PR. The flow is documented in [`CLAUDE.md`](CLAUDE.md#versioning--releases).

### Release notes — maintainer task per release

The auto-generated `CHANGELOG.md` is engineer-speak (PR refs, author thanks, paragraph-long rationales). The public **GitHub Releases page** uses a curated, user-facing summary instead.

The release-notes flow uses two files:

- **[`.github/release-notes-template.md`](.github/release-notes-template.md)** — the immutable template. Never edited; provides the format and instructions.
- **`.github/release-notes-<yyyymmdd>.md`** — one per release. Copied from the template, filled in by the maintainer (or their local Claude), and committed to develop before opening the `develop → main` release PR. After release it stays in the repo as a historical record.

Before opening a `develop → main` release PR:

```bash
cp .github/release-notes-template.md .github/release-notes-$(date -u +%Y%m%d).md
# edit the new dated file — see the template's comment block for rules
```

Each dated file has three sections:

- **Fixed** — bug fixes the user notices. Cluster technical-only fixes into a single trailing `Few technical bugs fixed` bullet.
- **New Feature** — new features the user notices. Cluster technical-only work into a single trailing `Technical enhancement` bullet.
- **Changed** — changes to existing features. Same `Technical enhancement` cluster for the technical-only bucket.

One bullet = 6–12 words. Plain prose. No PR / issue refs. The full per-PR detail is linked at the bottom of every release body automatically.

**CI gate**: [`.github/workflows/check-release-notes.yml`](.github/workflows/check-release-notes.yml) fails the `develop → main` PR if no dated file exists, if it's missing any of the three section headings, or if the `(write here)` placeholder is still present. The PR can't merge until the gate is green.

**Release workflow** (`changeset-release.yml`) reads the most recent dated file at release time and uses its prose as the GitHub Release body (HTML comment block stripped, CHANGELOG-link footer appended). If no dated file is present, the workflow falls back to a short body that links to the in-repo `CHANGELOG.md` files — release still publishes, just without curated prose.

## Where to ask questions

- Usage / how-to → [Discussions → Q&A](https://github.com/ChronoAIProject/Ornn/discussions/categories/q-a)
- Design / RFC discussion → [Discussions → Ideas](https://github.com/ChronoAIProject/Ornn/discussions/categories/ideas)
- Bug? Feature? → file an [issue](https://github.com/ChronoAIProject/Ornn/issues/new/choose)
- Security report → [Private Vulnerability Reporting](https://github.com/ChronoAIProject/Ornn/security/advisories/new) — see [SECURITY.md](SECURITY.md)

Thanks for contributing.
