---
version: 2.0.0
lastUpdated: 2026-04-29
---


# What is Ornn

<!-- VERSION_BADGE -->

## In one line

**Ornn is the agent-facing skill-lifecycle API.** Your AI agent calls Ornn over HTTP or MCP to search, pull, execute, build, upload, share, audit, version, link to GitHub, and sync skills — every step it might take with a skill is one API call away.

The closest analog: **npm registry + npm CLI fused together, model-agnostic.**

> The customer is the agent developer. The web UI exists as a secondary surface for skill owners and platform admins; the primary product is the API contract.

## What an Ornn skill is

A skill is a portable, versioned package of AI capability:

- **`SKILL.md`** — the prompt body + YAML frontmatter (name, description, category, runtime, tags, version, etc.).
- Optional **`scripts/`** — executable code the agent runs in chrono-sandbox.
- Optional **`references/`**, **`assets/`** — supporting context the agent loads alongside `SKILL.md`.

Skills are runtime-agnostic — Claude, GPT, Gemini, or a custom agent loop can all consume them. The format is text + scripts the runtime injects into context and (optionally) executes.

## What you get

| Capability | What it does |
|---|---|
| **Registry + CRUD** | Versioned skills with immutable per-version storage. Pull by GUID or kebab-case name. Diff two versions client-side. Deprecate or hard-delete a single version. |
| **Search** | Keyword + semantic search across the public + caller-visible slice. Per-tab filters: tags, authors, services, grant-orgs / grant-users. Three facet endpoints back the filter chips. |
| **AI generation** | Generate a brand-new skill from a prompt, from inline source, or from an OpenAPI spec — all SSE-streamed so the agent gets tokens as they're produced. |
| **GitHub linking + sync** | Attach an Ornn skill to a folder in a public GitHub repo. Sync flows from GitHub to Ornn with a dry-run-then-confirm preview that surfaces a per-file diff before bumping the version. |
| **Sandbox playground** | Try a skill end-to-end before installing. chrono-sandbox runs scripts; the LLM sees the result. Server-side tool-use loop so the playground call is one chunked SSE response. |
| **Audit as a passive risk label** | Every skill carries a verdict (`green` / `yellow` / `red`). Audits are owner-triggered; verdicts decorate the skill but never block sharing. Consumers of a skill that flips to `yellow` / `red` get notified automatically. |
| **NyxID identity + ACLs** | Real per-user / per-org identity at the API edge. Per-skill ACLs: private / shared-with-users / shared-with-orgs / public. Skills can also be tied to a NyxID service — admin-tier ties mark the skill as a *system skill* (forced public). |
| **Analytics** | Pull counts (api / web / playground source breakdown) and execution telemetry per skill version. |
| **Notifications** | `audit.completed` for owners; `audit.risky_for_consumer` fanned out to consumers when a verdict goes `yellow` / `red`. |

## Who is Ornn for?

| Audience | Where to start |
|---|---|
| **AI agents** *(primary customer)* — call Ornn over HTTP or MCP | [Quick Start → Agent Manual](/docs?section=qs-agent-manual) |
| **Skill owners & platform admins** — manage skills, permissions, audits via the GUI | [Quick Start → Web Users](/docs?section=qs-web-user) |
