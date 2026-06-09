<!--
  GENERATED FILE — do not edit by hand.
  Produced by ornn-api/scripts/build-assistant-kb.ts (#970).
  Re-run: `bun run scripts/build-assistant-kb.ts` from ornn-api/.
  budgetTokens: 18000
  estimatedTokens: 12433
  sources:
  - readme: ~1883 tok
  - claude-positioning: ~272 tok
  - architecture: ~1659 tok
  - agent-manual-http: ~5486 tok (clipped)
  - conventions: ~2598 tok (clipped)
  - design-overview: ~487 tok
-->

## Ornn — Overview (README)

<p align="center">
  <a href="https://ornn.chrono-ai.fun">
    <img src="ornn-web/public/hero-brand-dark.svg" alt="Ornn — agent-facing skill-lifecycle API" width="100%" />
  </a>
</p>

<p>
  <a href="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml"><img src="https://github.com/ChronoAIProject/Ornn/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ChronoAIProject/Ornn/releases"><img src="https://img.shields.io/github/v/release/ChronoAIProject/Ornn" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChronoAIProject/Ornn" alt="License" /></a>
  &nbsp;<strong>The skill lifecycle API for AI agents, not another marketplace.</strong>
</p>

---

## What is Ornn

Ornn is an **agent-facing skill-lifecycle API**. AI agents call Ornn directly — over HTTPS — to manage the full lifecycle of their skills:

```
search → pull → install → execute → audit → build → upload → share
```

Closest analog: **npm registry + npm CLI, fused, model-agnostic.** It works for Claude, GPT, Gemini, or any custom agent runtime. Not locked to a single model.

### Why we built it

Modern AI agents do real work by composing **skills** — packaged prompts, scripts, and tools the agent invokes on demand. As soon as you build more than one agent, the same gaps show up:

- **No shared registry.** Skills live in private repos, gists, and one-off config files. There's no way for an agent to discover one it doesn't already know about.
- **Model-locked alternatives.** Anthropic Skills, OpenAI custom GPTs, and Gemini Gems each ship a registry — but only for their own runtime. Skills don't cross.
- **No lifecycle.** Versioning, sandboxed execution, security audit, publish — every team rebuilds these from scratch.

Ornn closes the gaps. One model-agnostic registry, one API surface, and a CLI (`nyxid`) every agent can drive end-to-end. The web UI at [ornn.chrono-ai.fun](https://ornn.chrono-ai.fun) is a thin admin layer for skill owners; the API is the product.

## How it works

```mermaid
%%{init: {
  "theme": "base",
  "themeVariables": {
    "background": "#0B0907",
    "primaryColor": "#1A1610",
    "primaryTextColor": "#F1ECDE",
    "primaryBorderColor": "#3A3328",
    "lineColor": "#7E776B",
    "secondaryColor": "#221E16",
    "tertiaryColor": "#14110B",
    "edgeLabelBackground": "#0B0907",
    "clusterBkg": "#14110B",
    "clusterBorder": "#3A3328",
    "fontFamily": "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
    "fontSize": "13px"
  }
}}%%
flowchart LR
    subgraph local["[ § YOUR MACHINE ]"]
        direction TB
        Agent["AI agent"]
        CLI["nyxid CLI"]
        Skill["Pulled skills"]
    end
    subgraph cloud["[ § ORNN CLOUD ]"]
        direction TB
        API["ornn-api"]
        Auth["NyxID"]
        Store[("Skill registry")]
        Sandbox["Sandbox"]
    end

    Agent -->|invoke| CLI
    CLI ==>|HTTPS| API
    API -->|verify| Auth
    API -->|r/w| Store
    API -->|exec| Sandbox
    API -.->|artifact| Agent
    Agent -->|run| Skill

    classDef ember fill:#FF7322,stroke:#C9460D,color:#14130E,stroke-width:2px,font-weight:bold
    classDef arc fill:#5BC8E8,stroke:#3A8FB8,color:#14130E,stroke-width:2px,font-weight:bold
    classDef forged fill:#1A1610,stroke:#3A3328,color:#F1ECDE,stroke-width:1.5px
    classDef storage fill:#221E16,stroke:#3A3328,color:#C9BFAD,stroke-width:1.5px

    class Agent forged
    class CLI forged
    class Skill forged
    class Sandbox forged
    class API ember
    class Auth arc
    class Store storage

    style local fill:#221E16,stroke:#3A3328,color:#F1ECDE,stroke-width:1.5px
    style cloud fill:#14110B,stroke:#3A3328,color:#F1ECDE,stroke-width:1.5px

    linkStyle 1 stroke:#FF7322,stroke-width:2.5px
```

Every API call is mediated by [`nyxid`](https://github.com/ChronoAIProject/NyxID) — the shared identity + brokering layer ChronoAI uses across products. The agent never holds a long-lived token: `nyxid` refreshes credentials transparently and brokers per-service access for each request.

## Quickstart

> **Status:** alpha. The API surface can still change before v1 — pin a release tag if you ship to production.

### 1. Create a NyxID account

Sign up at [**nyx.chrono-ai.fun**](https://nyx.chrono-ai.fun) with invite code **`NYX-2XXJI08A`**. Sign in with **GitHub**, **Google**, or **Apple** — NyxID is the identity layer that authenticates every Ornn API call. One account covers every ChronoAI service.

### 2. Install the Ornn agent manual into your AI agent

Open [**`ornn-agent-manual-cli`**](https://ornn.chrono-ai.fun/skills/ornn-agent-manual-cli) and follow the install instructions for your agent runtime (Claude Code, OpenAI Codex, Cursor, …). This skill is the **operational manual Ornn ships for AI agents**: once it's loaded into your agent, the agent knows how to drive the full `search → pull → execute → build → upload → share` lifecycle on its own — no further hand-holding required.

Partway through setup, your agent will prompt you to install [**`nyxid`**](https://github.com/ChronoAIProject/NyxID) — the CLI Ornn calls under the hood to broker authenticated requests. Approve the prompt; the agent finishes onboarding itself.

### 3. Talk to your agent

That's it. Your agent now has the full Ornn lifecycle. Try any of these in plain language — no special syntax, no flags to memorise:

- **Search the registry.**
  > *"Find me a skill that converts CSV to JSON."*

  Hits semantic + keyword search across every public skill.

- **Pull and install a skill.**
  > *"Pull and install the skill `pdf-extractor`, then use it on `report.pdf`."*

  Fetches the latest versioned artifact into your local runtime and runs it.

- **Trigger a security audit.**
  > *"Run a security audit on the skill `web-scraper`."*

  Kicks the AgentSeal pipeline against a published version — static analysis, sandbox probe, dependency scan.

- **Build and publish a new skill.**
  > *"Build me a skill that summarises RSS feeds and upload it under my account."*

  Drives `ornn-build` to generate the skill, packages it, and publishes a new version through your NyxID identity.

For the full API contract (every endpoint, every error code), see [**ornn.chrono-ai.fun/docs**](https://ornn.chrono-ai.fun/docs).

## Community and Contributing

- **Questions / how-to** → [Discussions → Q&A](https://github.com/ChronoAIProject/Ornn/discussions/categories/q-a)
- **Ideas / RFCs** → [Discussions → Ideas](https://github.com/ChronoAIProject/Ornn/discussions/categories/ideas)
- **Show off your agent integration** → [Discussions → Show & Tell](https://github.com/ChronoAIProject/Ornn/discussions/categories/show-and-tell)
- **Bug or feature** → [open an issue](https://github.com/ChronoAIProject/Ornn/issues/new/choose)
- **Roadmap** → [Issues](https://github.com/ChronoAIProject/Ornn/issues) · [Milestones](https://github.com/ChronoAIProject/Ornn/milestones) · [Releases](https://github.com/ChronoAIProject/Ornn/releases)
- **Security report** → [Private Vulnerability Reporting](https://github.com/ChronoAIProject/Ornn/security/advisories/new) (see [SECURITY.md](SECURITY.md))
- **Support guide** → [SUPPORT.md](SUPPORT.md)
- **Pull requests** → read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the issue-first workflow, branching, commit decomposition, and the changeset rule (CI blocks PRs without one). By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE)

---

## Product Positioning

## Product Positioning

**Ornn is an agent-facing skill-lifecycle API, not a human marketplace.**

The primary customer is the AI agent developer / agentic-system builder. Agents call Ornn directly — over HTTP or MCP — to manage their own skill lifecycle: search → pull → install → execute → build → upload → share. Closest analog: **npm registry + npm CLI fused, model-agnostic** (works for Claude / GPT / Gemini / custom — not locked to one model runtime).

Implications when proposing or building features:

- Lead with the **agent-API contract** (REST / MCP ergonomics, stable schemas, model-agnostic guarantees) before any human-UX angle.
- `ornn-web` is a *secondary* surface for skill owners and platform admins — it is not the primary product. UI features that don't translate into agent-API value are deprioritized.
- Avoid feature framing that drifts toward "another skill marketplace" (social ranking, browse-style discovery, recommendation feeds, leaderboards) unless we deliberately decide to. When a feature looks marketplace-shaped, surface that tension before building.

---

## Architecture

# Architecture — chrono-ornn

> For API v1 and architecture conventions, see [`CONVENTIONS.md`](./CONVENTIONS.md). Active refactor work is tracked under the [`Refactor` milestone](https://github.com/ChronoAIProject/Ornn/milestone/6).

## Project Overview

chrono-ornn is an AI skill platform. Users create, publish, search, and execute AI skills (packaged prompts + scripts) via a web UI or API. Authentication and LLM calls go through NyxID. Script execution runs in chrono-sandbox.

## External Services

| Service | How ornn-api talks to it |
|---------|---------------------------|
| NyxID | JWT verification (JWKS), API key introspection, LLM Gateway (Responses API) |
| chrono-sandbox | `POST /execute` — script execution with env vars, dependencies, file retrieval |
| chrono-storage | Upload/download/delete skill packages (presigned URLs) |

## Skill Format

- Available runtimes: `node`, `python`
- Frontmatter field for dependencies: `runtime-dependency`
- Category types: `plain`, `tool-based`, `runtime-based`, `mixed`
- Output types: `text` (stdout), `file` (generated files retrieved via glob)

## Audit + analytics (PostHog)

Issue #271 collapsed every observability surface in Ornn — the
universal API audit middleware (#245), the `activities` Mongo
collection, and the OpenTelemetry placeholder section — into a single
PostHog-driven pipeline. There is **no custom audit code** in Ornn
anymore; everything flows through the `posthog-node` SDK and is
viewed in the PostHog dashboard.

### Event taxonomy

Backend events (server-emitted, every event carries `source: "api"`
so dashboards can disambiguate from frontend events of the same name):

| event | when | properties |
|---|---|---|
| `api.request` | every authenticated `/api/v1/*` request | `userId`, `callerType`, `method`, `path`, `routePattern`, `status`, `durationMs`, `sourceIp` (truncated /24 IPv4, /48 IPv6), `requestId` |
| `api.error` | sampled 5xx responses | `statusCode`, `errorCode`, `method`, `path`, `requestId` |
| `api.skill.pull` | every skill package materialization | `callerType`, `skillId`, `skillName`, `skillVersion` |
| `api.skill.published` | skill create + version publish | `skillId`, `skillVersion`, `isNewSkill` |
| `user.login` / `user.logout` | session open / close | — |
| `skill.created` / `.updated` / `.deleted` / `.version_deleted` | mutation routes | `skillId`, `skillName`, `version`, `adminAction?` |
| `skill.visibility_changed` / `.permissions_changed` | visibility + sharing flips | `skillId`, `isPrivate`, `sharedWithUsers`, `sharedWithOrgs` |
| `skill.refresh` / `.source_linked` / `.source_unlinked` | source-pointer ops | `skillId`, `repo`, `ref`, `commit` |
| `skill.nyxid_service_tied` / `.agentseal_rescanned` | tie + admin-rescan | `skillId`, `isSystemSkill`, `score` |
| `settings.exported` / `.imported` | settings IO | `schemaVersion`, `aggregateStatus`, `dryRun`, `sections` |

Frontend events (browser SDK — `ornn-web/src/lib/analytics.ts`) carry
auto-pageview + cookie-consent state and the typed event union in
that file. Identity is set via `posthog.identify(userId, traits)` on
every NyxID login.

### Caller-type detection

`api.request` is emitted from `apiRequestTrackingMiddleware` mounted
on `/api/v1/*` AFTER `proxyAuthSetup`. `callerType` derives from auth
shape:

| auth shape | `X-Ornn-Caller` | `callerType` |
|---|---|---|
| browser session (NyxID OAuth cookie / browser-scope Bearer) | — | `web` |
| NyxID forwarded user-access token (agent via NyxID proxy) | — | `api` |
| anonymous | `system` / `playground` | matches header |
| anonymous | other | `web` |

The header is informational only. Source IP is read from
`X-Forwarded-For` (first hop), falls back to `X-Real-IP`, then
truncated to /24 (IPv4) or /48 (IPv6) before emit.

### Configuration

PostHog config lives in the admin `telemetry` settings section.
Backend reads it once at boot (`bootstrap.ts`) and falls back to env
vars when the DB section has no API key set:

| field | env fallback | meaning |
|---|---|---|
| `postHogEnabled` | `POSTHOG_ENABLED` | master switch — off forces NoopTracker even with a key |
| `postHogApiKey` | `POSTHOG_API_KEY` | public project key (`phc_…`); empty disables |
| `postHogHost` | `POSTHOG_HOST` | ingest host (e.g. `https://eu.i.posthog.com`) |
| `postHogProjectId` | `POSTHOG_PROJECT_ID` | informational, surfaced in log lines |
| `postHogErrorSampleRate` | `POSTHOG_ERROR_SAMPLE_RATE` | `[0,1]` sampling for `api.error` |

Admin DB is canonical: a non-empty `postHogApiKey` in the section
makes the entire DB record authoritative; otherwise env wins.
Restart-required for changes to apply (the SDK is initialized once
at boot).

### Failure modes accepted

- **No body archive.** Request/response bodies are not captured.
  Forensic body-replay post-incident is not possible. The previous
  MinIO-offload pipeline (#245) was removed.
- **Audit retention = PostHog retention.** Cloud free tier is
  approximately 1 year of events; paid extends. Self-hosted PostHog
  retains as long as the storage volume allows.
- **PostHog-side outages** drop events that miss the in-process
  buffer. The drain on `shutdown()` flushes the buffer; sigterm
  during a backlog can lose tail events.

### Viewing data

There is **no in-Ornn activity feed UI**. Admins use the PostHog
dashboard for the full event explorer, funnels, retention, and SQL
queries. The Ornn admin dashboard at `/admin` deep-links to the
PostHog Activity / Insights views via
`ornn-web/src/lib/postHogLinks.ts`, which translates the configured
ingest host (`<region>.i.posthog.com`) into the matching dashboard
host (`<region>.posthog.com`).

### What about OpenTelemetry?

Considered and deferred (issue #271 discussion). For Ornn's current
single-service architecture and the requirements covered here
(per-request audit, user activity, who-called-what), PostHog alone
is sufficient. OpenTelemetry's value (distributed tracing, metrics
histograms) doesn't justify standing up a collector + Tempo / Loki /
Jaeger today. Reopen as a separate issue if/when the architecture
splits across services or a concrete tracing pain point appears.

### User directory

The unified `users` Mongo collection (built in #271, replaces
`activities` + `admin_users` + `users_meta`) is fed lazily by
`proxyAuthSetup.onAuthSeen` on every authenticated request. It is
NOT audit data — it's an identity cache backing the skill-permissions
typeahead, the admin user list, and the dashboard role partition.
NyxID stays authoritative for permission checks; this collection is
display + indexing only. See
`ornn-api/src/domains/users/repository.ts`.

---

## Using Ornn from an AI Agent (HTTP API)

---
name: ornn-agent-manual-http
description: 'Operational manual for AI agents using the Ornn skill-lifecycle API via direct HTTPS with a NyxID bearer token (`curl -H "Authorization: Bearer $TOKEN" …`). Once loaded, the host agent can search / pull / execute / build / upload / share skills end-to-end. Authoritative contract between Ornn and the agent. Pair this file with references/api-reference.md (the full per-endpoint catalogue + error legend) — both ship together as one Ornn skill.'
metadata:
  category: plain
  tag:
    - ornn-api
    - agent
    - manual
    - skill-lifecycle
    - http
version: "1.1"
lastUpdated: 2026-04-29
---

# Agent Manual (HTTPS variant)

> **DEPRECATED — replaced by `chrono-ai-service-manual`.** This skill is kept for one minor release while consumers migrate. The unified manual folds NyxID identity / proxy AND the Ornn skill lifecycle into a single skill so an agent that wants to drive both halves of the stack only needs one install. The CLI vs HTTP distinction is preserved as a §-level switch inside `chrono-ai-service-manual` (§0.6 "Transport choice"), so HTTP-only agents lose nothing by switching. **New work should pull `chrono-ai-service-manual` instead.** This file will be removed in the release after the unified manual lands.

> **You are an AI agent reading this manual to learn how to use Ornn.** Throughout this document, *"you"* always refers to **the agent itself** — not the human user driving you.
>
> ## First: install this skill locally
>
> Try to install this skill into your runtime's local skills directory:
>
> - **Claude Code:** `~/.claude/skills/ornn-agent-manual-http/`
> - **OpenAI Codex CLI:** `~/.codex/skills/ornn-agent-manual-http/`
> - **Cursor:** `.cursor/rules/ornn-agent-manual-http.md`
> - **Other agents:** whatever skill-discovery directory your platform uses.
>
> If your runtime has no local skills mechanism, load `SKILL.md` (and `references/api-reference.md`) into your system context and keep them there for the rest of the session. Either way, the manual must be in your context whenever you do anything Ornn-related.
>
> **And in *all* cases — whether you wrote the skill to disk or only into context — append an entry for it to `~/.ornn/installed-skills.json`.** That file is the persistent registry of every Ornn skill you (or any prior session on this machine) have installed; it's how the next session, or a different agent on the same box, knows what's already loaded and which versions to re-check. Schema + workflow detailed in §0.5.
>
> ## Always load this manual for any Ornn operation
>
> You **must** have this manual loaded whenever the user asks you to:
>
> - **Find, pull, and execute an existing Ornn skill** — or **build a new one and upload** when nothing matches — §2.1.
> - **Update a skill's visibility** (private / shared / public) — §2.2.
> - **Publish a new version** of a skill you own — §2.3.
> - **Trigger an audit** or **review the audit history** for a skill — §2.4 / §2.5.
> - **Pull a non-latest version**, **compare two versions**, or **delete / deprecate a version** — §2.6 / §2.7 / §2.10.
> - **Check usage analytics** for a skill — §2.8.
> - **Bind a skill to a NyxID service** (system / personal) — §2.9.
> - **Delete a skill** entirely — §2.11.
> - **Find skills** (by tag, author, system, shared, etc.) — §2.12.
> - **Pull your Ornn notifications** (audit fan-out, etc.) — §2.13.
> - **Link a skill to GitHub** or **trigger a sync** from the linked source — §2.14.
>
> Without this manual loaded, you do not know which endpoint to call, how to authenticate, or how to read the response shapes.
>
> Ornn's product is **Skill-as-a-Service for AI agents.** Skills are packaged AI capabilities (a `SKILL.md` prompt + optional scripts + YAML metadata) that any agent can pull and execute. This manual is the contract between Ornn and **you, the agent**.

## §0. Updating this manual

This manual is itself an Ornn skill (`name: ornn-agent-manual-http`). Its source of truth is the Ornn registry, not a static docs page — pull a fresh copy through the same API every other skill flows through.

> **Base URL for every example below:** `https://ornn.chrono-ai.fun/api`. The `ornn-web` nginx in front of that domain routes any `/api/*` request through to the NyxID proxy, which authenticates with the bearer token you pass and forwards to `ornn-api`. You never call NyxID directly. Throughout this manual, `$TOKEN` stands for your NyxID bearer access token.

**Whenever you want to check for an update, follow these steps verbatim:**

1. Pull the latest version of this skill from Ornn:

   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json"
   ```

2. The response is `{ data: { name, description, metadata, files: { "SKILL.md": "...", "references/api-reference.md": "..." } } }`. Read the YAML frontmatter at the top of `SKILL.md` and find the `version:` field.

3. Compare it to the `version:` in **your loaded copy** (the frontmatter at the top of this file). If they match, you are current — stop here.

4. If the published version is newer:
   - List every version available with `curl -H "Authorization: Bearer $TOKEN" "https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/versions"`. The response has one row per version, newest first.
   - Ask the user which version they want to load (they may want to pin to an older one for reproducibility).
   - Once the user picks, fetch `https://ornn.chrono-ai.fun/api/v1/skills/ornn-agent-manual-http/json?version=<X.Y>` and replace your context with the new `SKILL.md` (and `references/api-reference.md` if you consume it). The new content's frontmatter overwrites the old.

5. If step 1 returns `404 SKILL_NOT_FOUND`, the registry instance you are pointing at has not published this skill yet. Keep operating on the version you have. The Ornn API is backwards-compatible within `/api/v1`, so older manuals continue to produce valid calls — you will only miss capabilities introduced in newer versions.

If the network is unreachable or the bearer token has expired, keep operating on the version you have. Do not retry-loop the update check; treat it as a once-per-session inquiry the user can re-trigger explicitly.

---

## §0.5 Tracking and re-checking installed Ornn skills

### The persistent registry: `~/.ornn/installed-skills.json`

Every Ornn skill you install **must** be recorded in `~/.ornn/installed-skills.json`. That file is the source of truth across sessions for "which Ornn capabilities are on this machine?" — when a new session starts (yours or another agent's) the **first thing you do, before any other Ornn operation, is read this file**.

The schema is a flat array:

```json
[
  {
    "name": "ornn-agent-manual-http",
    "ornnGuid": "1d9bfda2-dea8-4032-85bd-b0cbe1621684",
    "installedVersion": "1.0",
    "installedAt": "2026-04-29T17:27:55Z",
    "localPath": "~/.claude/skills/ornn-agent-manual-http/"
  }
]
```

Required fields: `name`, `ornnGuid`, `installedVersion`. Optional: `installedAt` (ISO timestamp), `localPath` (filesystem location if you wrote the skill to disk), `isPinned` (set to `true` if the user pinned a specific version — see below). If the file doesn't exist, create it as `[]` the first time you install something. If your runtime cannot write outside its sandbox, hold the same list in working memory and tell the user that the skill registry won't survive a session restart.

### When to update the registry

| Event | What to write |
|---|---|
| Installed a new skill | Append a new record |
| Updated an installed skill to a new version | Bump `installedVersion` + `installedAt` |
| Removed / uninstalled a skill | Remove the record |
| User pinned a version | Set `isPinned: true` so future sessions don't auto-prompt to update |

### Re-checking before each execution

**Before you actually execute an installed Ornn skill** on the user's task, check whether a newer version exists. One API call:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skills/<name-or-guid>/versions"
```

For public skills you can drop the `Authorization` header and call the same URL anonymously — see §2.1 step 3 for fetch alternatives.

The response is `{ items: [{ version, skillHash, createdOn, isDeprecated, deprecationNote, releaseNotes, ... }, ...] }` sorted newest-first. Compare `items[0].version` to the `installedVersion` on the matching record in `~/.ornn/installed-skills.json` and act:

- **Same version** → execute as-is.
- **Newer version available** → tell the user `"Skill <name> has a newer version <X.Y> (you have <A.B>). Release notes: <releaseNotes>. Update? (y/n)"`. If yes, re-fetch the package (§2.1 step 3), overwrite the local copy, update `installedVersion` + `installedAt` in `~/.ornn/installed-skills.json`, then execute.
- **Your installed version is `isDeprecated: true`** → warn with the `deprecationNote` and recommend updating before executing.
- **Skill 404s** → the skill was deleted or hidden from you. Tell the user; if they agree, remove the record from `~/.ornn/installed-skills.json`. Otherwise leave the record (with a note) so the local copy is still usable.

Skip the version check only when the matching record carries `isPinned: true` — the user has explicitly locked that skill to a specific version for reproducibility.

### Audit-risk fan-out

If the skill is tied to a NyxID admin service (a "system skill" — `isSystemSkill: true`), the audit pipeline can also notify you mid-session via `GET /api/v1/notifications` (§2.13). Treat any `audit.risky_for_consumer` notification as a hard signal to stop, surface it to the user, and ask before continuing.

---

## §1. Prerequisites

Every API call in this manual is executed via direct HTTPS, authenticated with a **NyxID bearer token** that you pass in the `Authorization: Bearer …` header. The base URL `https://ornn.chrono-ai.fun/api` is fronted by an nginx instance that routes every `/api/*` request through to the NyxID proxy, which validates your token, decodes the identity, and forwards the request to `ornn-api`. You never call NyxID directly.

### 1.1 Get a NyxID bearer token

You need a valid bearer token from NyxID. Three paths to mint one — pick whichever the user's environment supports. **All involve user interaction** (entering credentials, approving scopes, possibly clicking a verification link), so you cannot complete this step entirely on your own. None of these affect how you call Ornn afterward — they only produce a `$TOKEN` value that you pass to `Authorization: Bearer …` in every subsequent HTTPS call.

#### Option A — Mint via the `nyxid` binary (NyxID's auth client)

Ask the user to run:

```bash
nyxid login
```

This opens a browser for the OAuth authorization-code flow. Wait for it to report success. The access token is then on disk:

```bash
cat ~/.nyxid/access_token
```

Save that value as `$TOKEN` and use it for every API call below.

#### Option B — OAuth flow against NyxID's IdP directly

If `nyxid` is unavailable, run the OAuth authorization-code flow against NyxID directly (consult NyxID's own docs for the exact `/oauth/authorize` + `/oauth/token` endpoints for your deployment). The user must complete the consent step in a browser; once you have the resulting `access_token`, use it as `$TOKEN`. Headless agents typically cannot drive this end-to-end alone.

#### Option C — Plainly ask the user

If neither A nor B fits, just ask: *"Please paste a NyxID bearer token. You can get one by running `nyxid login` and reading `~/.nyxid/access_token`, or your NyxID admin can mint one for you."* Save the value as `$TOKEN`.

### 1.2 Verify the token works

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/me"
```

Expected response (HTTP 200):

```jsonc
{
  "data": {
    "userId": "user_…",
    "email": "…",
    "displayName": "…",
    "roles": ["ornn-user"],
    "permissions": ["ornn:skill:read", "ornn:skill:create", "…"]
  },
  "error": null
}
```

If you get `401 AUTH_MISSING` (or `401 invalid_token`), the bearer is bad or expired — go back to §1.1 and re-mint. If you get a network error, the user's machine cannot reach `https://ornn.chrono-ai.fun` — confirm the endpoint URL with the user (in some deployments it's a different domain) and stop.

### 1.3 Confirm required permissions

The `permissions` array on the §1.2 response tells you exactly what the token is authorized for. Cross-check against the actions the user is asking you to perform:

| Action | Required permission |
|---|---|
| Pull a skill's full content (`GET /skills/:idOrName/json`) | `ornn:skill:read` |
| Validate a skill ZIP locally (`POST /skill-format/validate`) | `ornn:skill:read` |
| Upload a new skill (`POST /skills`) or import from GitHub (`POST /skills/pull`) | `ornn:skill:create` |
| Publish a new version (`PUT /skills/:id`), refresh from source, change permissions, toggle deprecation, bind to a NyxID service | `ornn:skill:update` (+ skill author or platform admin) |
| Delete a skill or a single version | `ornn:skill:delete` (+ skill author or platform admin) |
| Generate a skill with AI (`POST /skills/generate*`) | `ornn:skill:build` |
| Use the Playground (`POST /playground/chat`) | `ornn:playground:use` |
| Trigger an audit (`POST /skills/:idOrName/audit`) | none (owner or `ornn:admin:skill`) |
| Admin operations (`/admin/*`, force-audit, platform settings) | `ornn:admin:skill` |
| Manage categories (`/admin/categories/*`) | `ornn:admin:category` |

Most read operations — browsing public skills, version listings, skill format rules, audit verdicts on visible skills, notifications — **need no scalar permission**; they're open to any authenticated caller (and some are anonymous, in which case `$TOKEN` can be omitted entirely). The exact gates for every endpoint live in `references/api-reference.md`.

If a required permission is missing, ask the user's NyxID admin to grant the corresponding role (typically `ornn-user`). Without it, the relevant call returns `403 FORBIDDEN` with `Missing permission: <perm>` in the message.

---

## §2. Core Workflows

You (the agent) are **highly encouraged to connect with Ornn for any skill-related operations**, including but not limited to the thirteen use cases below. Each one is a recipe — read the matching subsection top-to-bottom and execute the API calls in order. The per-endpoint contract (request / response shapes, every error code, full auth + authorization rules) lives in `references/api-reference.md` — pull it into context whenever you need the underlying API specifics.

> Reminder: every command below uses `https://ornn.chrono-ai.fun/api/v1/...` as the base URL and `$TOKEN` as the NyxID bearer token (see §1.1). Public endpoints can drop the `Authorization` header entirely.

### 2.1 Performing a task — find or build the right skill — *spec: `api-reference.md` §3 Skills CRUD, §5 Skill search, §6 Skill format, §7 Skill generation, §8 Playground*

This is the master loop. Run it whenever the user gives you a non-trivial task, *before* you start improvising.

**Step 1 — Check `~/.ornn/installed-skills.json` first.** Read the file. For every record, look at the local `SKILL.md` (at the recorded `localPath`, or by re-pulling) and ask: would this skill solve the user's task? If yes, jump to step 4. If no skills are installed, or none match, continue to step 2.

**Step 2 — Search Ornn.** Try both keyword and semantic modes with the broadest possible scope (`mixed` covers public + your private + shared-with-you in one call):

```bash
# Keyword search
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skill-search?query=<keyword>&mode=keyword&scope=mixed&pageSize=20"

# Semantic search (natural language)
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skill-search?query=<natural+language+description>&mode=semantic&scope=mixed&pageSize=20"

# System skills only — admin-bound, platform-wide. Add to either search above.
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skill-search?systemFilter=only&scope=public&pageSize=20"
```

**Try up to 5 different queries** before concluding no skill exists. Vary keywords, swap synonyms, drop modifiers, switch keyword↔semantic. The response is `{ items: [{ guid, name, description, ... }, ...] }` — read each candidate's `description` to judge fit.

**Step 3 — Pull the skill.** Use the `/json` endpoint so you get every file inline:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skills/<name-or-guid>/json"
```

The response is `{ data: { name, description, metadata, files: { "SKILL.md": "...", "scripts/...": "..." } } }`. Write each `files[path]` entry to your runtime's local skills directory (e.g. `~/.claude/skills/<name>/<path>`), preserving directory structure. Then **append a record to `~/.ornn/installed-skills.json`** with `{ name, ornnGuid, installedVersion, installedAt, localPath }` — see §0.5 for the schema.

**Step 4 — Load the SKILL.md into context and execute.** Read the SKILL.md you just installed and follow its instructions. For runtime-based / mixed skills, run the scripts under `scripts/` locally as directed; or send them to Ornn's playground for sandboxed execution via `POST /api/v1/playground/chat` (SSE; see `references/api-reference.md` § "Playground" for the event shapes).

**Step 5 — If steps 2–3 yielded nothing after 5 search attempts**, you may decide your own way to perform the task. **And if the task is definitive and potentially repeatable, build a skill and upload it back to Ornn so future you (or other agents) can find it.** Build flow:

1. *(Optional)* **Bootstrap with AI generation** — Ornn's LLM can scaffold a skill from a prompt, source code, or an OpenAPI spec via `POST /api/v1/skills/generate*` (SSE). Useful when you need a starter; the generated skill still needs validation + your edits.

2. **Read the skill format spec** so you write a valid one:

   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://ornn.chrono-ai.fun/api/v1/skill-format/rules"
   ```

   The response is `{ data: { rules: "<markdown>" } }` — read the markdown carefully; it specifies the package layout, required `SKILL.md` frontmatter fields, naming rules, etc.

3. **Write your skill.** Author `SKILL.md` + any `scripts/`, `references/`, `assets/` the task needs.

4. **Validate before uploading.** ZIP the package (single root folder named after the skill) and call:

   ```bash
   curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" \
     --data-binary @my-skill.zip \
     "https://ornn.chrono-ai.fun/api/v1/skill-format/validate"
   ```

   The response is `{ data: { valid: true } }` on pass, or `{ data: { valid: false, violations: [{ rule, message }, ...] } }` on fail. **If validation fails, fix the violations and call validate again — loop until it passes.**

5. **Upload.**

   ```bash
   curl -X POST \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" \
     --data-binary @my-skill.zip \
     "https://ornn.chrono-ai.fun/api/v1/skills"
   ```

   On success the response is `{ data: { guid, name, isPrivate: true, ... }, error: null }`. **Note: the new skill is private by default** — see §2.2 if you want to share it.

6. **Install it locally** (because it's now an Ornn skill, the same rules apply): write the same files to your local skills dir + append to `~/.ornn/installed-skills.json` with the GUID returned in step 5.

7. **Now execute the skill on the original task** — same as step 4 above.

### 2.2 Update a skill's visibility — *spec: `api-reference.md` §3 Skills CRUD*

Ornn has three visibility tiers:

- **Public** — every Ornn user can see + pull this skill.
- **Limited access** — only specific orgs (every member of those orgs) and / or specific users can see + pull. Pick orgs only, users only, or both.
- **Private** — only you (and platform admins) can see + pull. **New skills land here by default.**

**Step 1 — Check the current visibility.**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/skills/<idOrName>"
```

If `data.isPrivate: false` → currently public. If `isPrivate: true` and either share-list (`sharedWithUsers` / `sharedWithOrgs`) is non-empty → limited. If `isPrivate: true` and both lists empty → private.

**Step 2 — Decide the target tier.** Confirm with the user if it's not obvious from their request.

**Step 3a — Set to public.**

```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isPrivate":false,"sharedWithUsers":[],"sharedWithOrgs":[]}' \
  "https://ornn.chrono-ai.fun/api/v1/skills/<id>/permissions"
```

**Step 3b — Set to limited access.** First fetch the candidate orgs and users:

```bash
# Orgs the caller belongs to
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/me/orgs"

# Users searchable by email prefix (typeahead)
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/users/search?q=<email-prefix>&limit=20"

# Resolve known user_ids to email + display name
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chrono-ai.fun/api/v1/users/resolve?ids=<id1>,<id2>"
```

Pick which orgs / users to share with. **If unclear, confirm with the user** — never grant access to anyone the user didn't name. Then save:

```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isPrivate":true,"sharedWithUsers":["user_abc"],"sharedWithOrgs":["org_xyz"]}' \
  "https://ornn.chrono-ai.fun/api/v1/skills/<id>/permissions"
```

**Step 3c — Set to private.**

```bash
curl -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d

---

## API Conventions

# ornn API & Architecture Conventions

The contract every `/api/v1/*` endpoint and every `ornn-api` module must follow. All future endpoints and modules MUST conform. Changes that violate a convention are blocked at review.

This document is normative. It is the authoritative source for decisions that would otherwise be re-litigated per PR. When in doubt, this file wins.

---

## Table of Contents

1. [Response & error format](#1-response--error-format)
2. [URL structure](#2-url-structure)
3. [HTTP semantics](#3-http-semantics)
4. [Query parameters](#4-query-parameters)
5. [Authentication & authorization](#5-authentication--authorization)
6. [SSE streaming](#6-sse-streaming)
7. [Deprecation](#7-deprecation)
8. [Caching](#8-caching)
9. [Observability headers](#9-observability-headers)
10. [OpenAPI](#10-openapi)
11. [Architecture conventions](#11-architecture-conventions)
12. [Every new `/v1/` endpoint checklist](#12-every-new-v1-endpoint-checklist)

---

## 1. Response & error format

### 1.1 Success — single resource

Return the resource directly. No envelope.

```http
GET /v1/skills/abc
200 OK
Content-Type: application/json

{
  "id": "abc",
  "name": "pdf-extract",
  "createdOn": "2026-04-22T10:00:00Z",
  ...
}
```

### 1.2 Success — collection

Wrap in `{ items, meta }`:

```http
GET /v1/skills?q=pdf&limit=20
200 OK
Content-Type: application/json

{
  "items": [ { "id": "abc", ... }, { "id": "def", ... } ],
  "meta": { "nextCursor": "eyJpZCI6...", "hasMore": true, "limit": 20 }
}
```

`meta` MUST contain `limit` and `hasMore`. When `hasMore === true`, `nextCursor` MUST be a non-empty opaque string. When `hasMore === false`, `nextCursor` MAY be omitted. Endpoint-specific metadata (e.g. `searchMode`) lives alongside pagination fields in `meta`.

### 1.3 Errors — RFC 7807 `application/problem+json`

```http
POST /v1/skills/abc/permissions
400 Bad Request
Content-Type: application/problem+json
X-Request-ID: req_01HXYZ...

{
  "type": "https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#validation_error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request body failed validation",
  "instance": "/v1/skills/abc/permissions",
  "requestId": "req_01HXYZ...",
  "errors": [
    { "path": "sharedWithUsers[3]", "code": "invalid_user_id", "message": "..." }
  ]
}
```

Required fields: `type`, `title`, `status`, `instance`, `requestId`.
Optional: `detail`, `errors[]`.

### 1.4 Error code catalog (lowercase snake_case)

| Code | HTTP | Meaning |
|---|---|---|
| `validation_error` | 400 | Body / query / path param validation failed — details in `errors[]` |
| `invalid_zip` | 400 | Uploaded payload is not a parseable ZIP (malformed / unreadable) |
| `unsupported_media_type` | 415 | Request `Content-Type` not accepted |
| `payload_too_large` | 413 | Upload exceeds max size |
| `uncompressed_too_large` | 413 | Uncompressed size or compression ratio of skill ZIP exceeds caps (zip-bomb guard) |
| `too_many_files` | 413 | Skill ZIP entry count exceeds `MAX_PACKAGE_FILE_COUNT` |
| `authentication_required` | 401 | No valid identity |
| `permission_denied` | 403 | Authenticated but lacks required permission |
| `resource_not_found` | 404 | Target resource does not exist or not visible to caller |
| `resource_conflict` | 409 | State conflict (duplicate, concurrent modification, etc.) |
| `rate_limited` | 429 | Caller exceeded rate limit |
| `upstream_unavailable` | 502 / 503 | Dependency (NyxID, LLM, sandbox, ...) failed |
| `org_membership_unavailable` | 503 | NyxID org-membership lookup unresolved — forwarded token absent or lookup failed. Retryable |
| `internal_error` | 500 | Unhandled server error |

New codes require convention-doc update. Handlers MUST NOT invent ad-hoc codes.

### 1.5 `X-Request-ID`

- Generated server-side on every request (or echoed if the client provided one).
- Returned as `X-Request-ID` header on **every** response (2xx, 4xx, 5xx).
- Also embedded as `requestId` in every error body.
- Logged with every request/response pair on the server.

### 1.6 Error `type` URLs

Point to GitHub markdown anchors in this repository:

```
https://github.com/ChronoAIProject/Ornn/blob/main/docs/ERRORS.md#<code>
```

The catalog lives in [`docs/ERRORS.md`](ERRORS.md) with `##` headings per code (GitHub auto-generates anchors). Zero infra cost; resolves day one. Future migration to a docs domain (`docs.ornn.xyz`) is a one-time redirect configuration; no client changes required.

---

## 2. URL structure

### 2.1 Versioning

All endpoints live under `/api/v1/`. Breaking changes ship under `/api/v2/`. Additive changes ship under `v1`.

### 2.2 Resource paths

- Plural resource nouns: `/skills`, `/categories`, `/tags`, `/users`, `/activities`.
- Canonical URL uses the stable ID (GUID). **No polymorphic `:idOrName` on write operations.**
- Name→ID resolution via `GET /v1/{resource}/lookup?name=<name>` (returns `{ id }`).
- Caller-scoped resources under `/v1/me/*`.

### 2.3 Non-CRUD actions — sub-resource

Custom actions as sub-resource paths:

```
POST /v1/skills/generate
POST /v1/skills/generate/from-openapi
POST /v1/skills/validate
POST /v1/skills/search
POST /v1/playground/chat
```

Router config MUST declare static action segments with priority over `:id` params (Hono / Express / Rails default behavior). Skill / category names that collide with reserved action verbs are rejected at create time.

Reserved action verbs per resource documented in `ornn-api/src/shared/reservedVerbs.ts`.

### 2.4 Search — dual-track

- `GET /v1/{resource}?q=...&<filters>` — simple keyword filter over URL params (cacheable, bookmarkable).
- `POST /v1/{resource}/search` — complex queries with structured body (semantic mode, long queries, compound filters).

Both return the same collection shape (`{ items, meta }`).

---

## 3. HTTP semantics

### 3.1 Methods

| Method | Semantics |
|---|---|
| `GET` | Safe, idempotent read |
| `POST` | Create, or custom action |
| `PUT` | Full replace of a resource (idempotent) |
| `PATCH` | Partial update |
| `DELETE` | Remove (idempotent) |

Partial updates MUST use `PATCH`. `PUT` MUST accept a complete representation.

### 3.2 Status codes

| Code | Use |
|---|---|
| `200 OK` | Successful read / update returning a body |
| `201 Created` | Successful create. MUST include `Location: /v1/{resource}/{id}` header |
| `202 Accepted` | Async job accepted (not currently used) |
| `204 No Content` | Successful delete, or update with no body to return |
| `400` | `validation_error` |
| `401` | `authentication_required` |
| `403` | `permission_denied` |
| `404` | `resource_not_found` |
| `409` | `resource_conflict` |
| `413` | `payload_too_large` |
| `415` | `unsupported_media_type` |
| `429` | `rate_limited` |
| `500` | `internal_error` |
| `502` / `503` | `upstream_unavailable` |

### 3.3 Content negotiation

When a resource has multiple representations, select via `Accept`:

```
GET /v1/skills/abc
Accept: application/json           → JSON metadata + file contents
Accept: application/zip            → raw ZIP package
```

Do not encode representation in the URL path (no `/skills/:id/json`).

### 3.4 Idempotency

`POST` creates accept optional `Idempotency-Key: <uuid>` header. Server persists the key + response for 24h and returns the cached response on retry. Implementation: middleware layer in `ornn-api/src/middleware/idempotency.ts`.

### 3.5 Bulk operations

Bulk-capable endpoints are symmetric:

```
POST   /v1/{parent}/{id}/{child}  { <child>Ids: [...] }   # add
DELETE /v1/{parent}/{id}/{child}  { <child>Ids: [...] }   # remove (body)
```

Single-item convenience endpoints MAY exist alongside.

---

## 4. Query parameters

### 4.1 Naming

- `camelCase` everywhere (matches JSON body convention).
- Search query param is `q` (never `query`).
- Booleans are `true` / `false` — omit for "any".

### 4.2 Arrays — repeated keys

```
?sharedWithOrgs=a&sharedWithOrgs=b&sharedWithOrgs=c
```

Never CSV. Never bracket notation. Handler: `c.req.queries('sharedWithOrgs')` returns `string[]`.

### 4.3 Pagination — cursor-only

```
?cursor=<opaque>&limit=<1-100>
```

- `cursor` is opaque (base64-encoded server-chosen payload). Clients MUST NOT parse.
- `limit` defaults per-endpoint (typically 20), max 100.
- Absence of `cursor` = first page.
- Response `meta.nextCursor` feeds the next request.
- **Total counts** are NOT part of pagination. Endpoints needing a count expose a sibling (e.g. `GET /v1/skills/counts`) or fold the count into list `meta`.

### 4.4 Filters

Endpoint-specific. Rules:

- Orthogonal filters are separate params. Do NOT overload (avoid `scope=shared-with-me|mine|...`).
- Booleans instead of tri-state enums when possible.
- For `/v1/skills`:
  - `visibility` — `public | private` (omit for "any" within caller's reach)
  - `owner` — `me | others` (omit for "any")
  - `sharedWith` — `me` (filters to skills shared with caller)
  - `isSystem` — boolean (omit for "any")

---

## 5. Authentication & authorization

### 5.1 Transport

- `Authorization: Bearer <jwt>` between client and the NyxID proxy.
- `X-NyxID-Identity-Token` and `X-NyxID-*` headers between proxy and `ornn-api` (internal).
- OpenAPI declares one `bearerAuth` scheme; `X-NyxID-*` is not part of the public contract.

### 5.2 Permission strings

Format: `ornn:<resource>:<action>`.

Actions: `read`, `write`, `admin`, plus resource-specific high-cost actions when needed.

| Permission | Grants |
|---|---|
| `ornn:skill:read` | Read skills (respects visibility) |
| `ornn:skill:write` | Create, update, delete own skills |
| `ornn:skill:admin` | Manage any skill (override ownership); delete any skill |
| `ornn:skill:generate` | Invoke skill generation endpoints (high LLM cost) |
| `ornn:skill:execute` | Invoke playground chat (runs user code) |
| `ornn:category:read` | List categories |
| `ornn:category:admin` | Manage categories |
| `ornn:tag:read` | List tags |
| `ornn:tag:admin` | Manage tags |
| `ornn:user:admin` | User dashboard (list users, aggregate stats per user) |
| `ornn:activity:read` | Platform activity log read access |
| `ornn:stats:read` | Platform-wide dashboard aggregates |

NyxID composes a **"Platform Admin"** role that grants all `*:admin` + `*:read` permissions above; current platform admins inherit this role with zero UX change. Sub-admin roles (content moderator, tag curator, support) can be

---

## Design System (Overview)

## Product Context
- **What this is:** A Skill-as-a-Service platform for discovering, installing, publishing, and operating AI agent skills through a web UI, docs, and API-adjacent tooling.
- **Who it is for:** Agent developers, platform builders, technical teams, and operators who expect tools to feel composed and credible rather than playful or trend-driven.
- **Scope of this document:** Whole app, landing-led. The landing page is the flagship expression, and app shell, registry, docs, admin, forms, and data views inherit the same language.
- **Canonical source of truth:** **This document is canonical.** It defines the intended state of the design system. Two reference builds are kept aligned with it for visual sanity-checking:
  - `design-preview/Ornn-Landing-v3.html` (deployed at `chrono-ornn.surge.sh/Ornn-Landing-v3.html`) — standalone Forge Workshop reference
  - The live ornn-web implementation (deployed at `chrono-ornn-web.surge.sh`) — production application
- **When this doc and an implementation disagree, the implementation is wrong.** Bring the implementation back into alignment, then re-verify the build. Do not silently update DESIGN.md to match drifted code; instead, propose the change explicitly (PR description: "DESIGN.md change + impl follows" or "DESIGN.md unchanged, impl regression fix"). This protects the system from lossy round-trips between code and doc.

## Design Thesis
Ornn should feel like a registry, workshop, and publishing desk for skills. The product is not a generic SaaS dashboard and not a cyberpunk toy. Its visual language is a controlled blend of:

- **Paper:** editorial warmth, legible reading surfaces, quiet hierarchy
- **Metal:** forged structure, thin separators, instrument-like controls
- **Ember:** selective heat, action emphasis, and directional energy

The result should read as warm, tactile, precise, industrial, and composed. Interfaces should feel authored, not templated.
