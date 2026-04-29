---
version: 2.0.0
lastUpdated: 2026-04-29
---


# Why Ornn?

If you came here looking for a human-facing skill marketplace, you'll be disappointed. If you came here looking for the substrate your agent calls, this is it.

## What makes Ornn different

The product is consumed by **AI agents** — not by humans browsing a catalogue. That distinction shapes every decision:

- **API ergonomics over discovery UX.** A stable, well-typed schema beats a glossy hero image when the consumer is a Claude / GPT / Gemini call.
- **Model-agnostic.** Skills are portable artifacts. Any agent runtime that can pull files and inject context can consume an Ornn skill — no model lock-in.
- **Lifecycle, not directory.** Listing skills is the boring part. Letting an agent build a new skill, audit it, share it with another user / org, link it to a GitHub source, sync updates back, and watch its execution analytics over time — that's the lifecycle.

## What you actually get

| Layer | What it does |
|---|---|
| **Registry + CRUD** | Versioned, validated skills. Pull by GUID or name. Diff two versions. Deprecate or hard-delete a single non-latest version. |
| **Search + facets** | Keyword + semantic. Per-tab filters: tags, authors, services, grant orgs / users. Visibility-scoped to what the caller can actually see. |
| **AI generation (SSE)** | Generate a skill from a prompt, source code, or an OpenAPI spec — streamed, so the agent gets tokens as they're produced. |
| **GitHub linking + sync** | Link an Ornn skill to a folder in a public GitHub repo. Sync runs a dry-run diff against the current latest, asks the user to confirm, then bumps the version. |
| **Sandbox playground** | Execute a skill end-to-end before installing it: chrono-sandbox runs the code, your LLM sees the result. |
| **Audit as a risk label** | Every skill has a verdict (`green` / `yellow` / `red`). Audits run on demand, never block sharing. Consumers of a skill that flips risky get notified. |
| **NyxID identity + per-skill ACLs** | Real org / user identity at the API edge. ACLs are real ACLs, not honor-system. |
| **Analytics + notifications** | Pull counts (api / web / playground), execution telemetry, audit fan-out notifications. |

## Compared with what you might be using today

You probably already have *some* place where skill files live — a marketplace, a Vercel-style directory, a GitHub repo. Here's where Ornn pays for itself.

### vs. Vercel `skills.sh` and other browse-style directories

A polished directory is good at human-facing discovery. It is not built for an agent's runtime loop. Ornn fills the gap *after* the human has decided to use a skill:

- **Programmatic listing + install.** Keyword + semantic search via one HTTP call. `GET /skills/:idOrName/json` returns every file inline so an agent can inject the package into context immediately — no GitHub redirect, no raw-URL parsing, no per-file fetch.
- **Programmatic publish.** SSE-streamed AI generation lets an agent generate a skill, validate it, and publish it without leaving its loop.
- **Identity-aware sharing.** Real ACLs (private / shared-with-users / shared-with-orgs / public) backed by NyxID — not honor-system "private listings".
- **Audit verdict as structured data.** Not stars or 4.8/5 ratings — a `green` / `yellow` / `red` verdict per version with `audit.risky_for_consumer` notifications that fan out to consumers automatically.
- **Execution telemetry.** Per-skill pull counts (api / web / playground breakdown), latency, success rates.

### vs. SkillMP-style marketplaces

Marketplaces optimise for **discovery**, **monetisation**, **social proof**. Ornn optimises for **runtime operations**:

- Search → pull → execute is one HTTP call each. The agent stays in its loop.
- Per-skill ACLs resolve through NyxID — sharing a private skill with `org_xyz` means everyone in `org_xyz` can see it; nobody else can.
- Audit verdicts are produced by the audit pipeline, not voted on by users. Owners get `audit.completed`; consumers get `audit.risky_for_consumer` automatically.
- AI-native publishing — generate from a prompt, validate against the format spec, upload, all in code.

If you want to *sell* skills, a marketplace is the right shape. If you want your agent to *use* skills at runtime, Ornn is the right shape.

### vs. raw GitHub

GitHub is a code host. It stores files and gives you `gh search` + `curl raw.githubusercontent.com`. That's enough until any of these become true:

- **Multi-tenant.** Some skills should be visible to one org but not another. GitHub solves this by paying per private repo or running an org; Ornn does it with per-skill ACLs.
- **Mixed trust.** Some skills public, some private to the team, some shared with one external partner. GitHub forces separate repos / orgs; Ornn flips a switch on each skill.
- **Audit + notifications.** You want consumers told automatically when a skill goes risky. GitHub doesn't; Ornn does it as a first-class flow.
- **Programmatic agent loop.** With GitHub it's `gh api` + raw-URL parsing + your own caching. With Ornn it's one call per verb against a stable schema.
- **Sandbox before install.** Ornn's playground runs the skill in chrono-sandbox; GitHub doesn't.
- **Telemetry that matters for skills.** Ornn gives pull counts by source (api / web / playground), execution success rate; GitHub gives stars and clones.

**They aren't mutually exclusive.** `POST /skills/pull` imports a public GitHub folder as an Ornn skill. `PUT /skills/:id/source` links an existing Ornn skill to a GitHub folder. `POST /skills/:id/refresh` (with dry-run preview) syncs updates from GitHub back into Ornn — your team keeps git as the source-of-truth for the skill body, Ornn handles distribution + ACL + audit + telemetry.

## What Ornn is **not**

- Not a human-facing skill marketplace. There is no leaderboard, no social ranking, no "trending this week" feed.
- Not bound to one agent runtime. Skills are not Claude-specific or GPT-specific.
- Not a substitute for git. We don't try to be a code host — link your skill to a GitHub folder if you want git to remain the source-of-truth.
- Not a runtime guardrail. Audit is a passive label, not a runtime block. If you need runtime safety, layer Lakera / LLM Guard / NeMo on top of your agent.

## Where to go next

- **Skill owners / admins:** [Quick Start → Web Users](/docs?section=qs-web-user).
- **Agent developers:** [Quick Start → Agent Manual](/docs?section=qs-agent-manual). The full operational manual + per-endpoint API reference live as Ornn system skills (`ornn-agent-manual-cli` for the NyxID CLI transport, `ornn-agent-manual-http` for direct HTTPS) — pull whichever one fits your environment.
