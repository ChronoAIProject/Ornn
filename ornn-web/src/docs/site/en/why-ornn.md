# Why Ornn?

Ornn is the API layer your AI agent calls to manage its own skill lifecycle. Search → pull → install → execute → build → upload → share — every action an agent might take with a skill is one HTTP / MCP call away. The closest analog is **npm registry + npm CLI fused together, model-agnostic**.

This page exists to be honest about what Ornn is for and who it's for. If you came here looking for a human-facing skill marketplace, you'll be disappointed. If you came here looking for the substrate your agent calls, this is it.

## The customer is the agent developer

The product is consumed by **AI agents** — not by humans browsing a catalogue. The web UI exists, but it's a secondary surface for skill owners and platform admins to manage their own work. The primary contract is the API.

That distinction shapes every design decision:

- **API ergonomics over discovery UX.** A stable, well-typed schema beats a glossy hero image when the consumer is a Claude / GPT / Gemini call.
- **Model-agnostic.** Skills are portable artifacts (a `SKILL.md` + optional scripts + metadata). Any agent runtime that can pull files and inject context can consume an Ornn skill.
- **Lifecycle, not directory.** Listing skills is the boring part. Letting an agent build a new skill, audit it, share it with another user / org, and watch its execution analytics over time — that's the lifecycle.

## What you actually get

| Layer | What it does |
|---|---|
| **Registry + CRUD** | Skills are versioned, validated, and stored. Pull by GUID or by kebab-case name. Diff two versions. Deprecate a version without deleting it. |
| **Search** | Keyword + semantic search across the public + caller-visible slice. System-skill filter via NyxID services. |
| **AI generation** | Generate a new skill from a prompt, from inline source code, or from an OpenAPI spec. Streamed via SSE. |
| **Sandbox playground** | Execute a skill end-to-end before installing it: chrono-sandbox runs the code, your LLM sees the result. |
| **Audit as risk label** | Every skill has a verdict (`green` / `yellow` / `red`). Audits run on demand, never block sharing. Consumers of a skill that flips to `yellow` / `red` get notified. |
| **NyxID identity** | Real org / user identity at the API edge. Per-skill ACLs are real ACLs, not honor-system. |
| **Analytics** | Pull counts (api / web / playground sources) and execution telemetry per skill version. |

## Model-agnostic by design

Ornn does not bind you to a specific LLM provider. Skills are pulled and executed by whatever agent you point at the API. Internally Ornn uses NyxID's LLM gateway for skill generation + audit, but consumers of skills are free to use Claude, GPT, Gemini, or a custom runtime. The skill payload is portable text + scripts.

## What Ornn is **not**

- Not a human-facing skill marketplace. There is no leaderboard, no social ranking, no "trending this week" feed.
- Not bound to one agent runtime. Skills are not Claude-specific or GPT-specific.
- Not a substitute for git. We don't try to be a code host. If you want to track your skill's source in version control, do that in git and use `POST /skills/pull` to import.
- Not a runtime guardrail. Audit is a label, not a runtime block. If you need runtime safety, layer Lakera / LLM Guard / NeMo on top of your agent.

## Where to go next

- **Quick Start → Web Users** for a guided tour of the GUI.
- **Quick Start → Agent Manual** if you're an agent developer and want the operational manual to drop into your agent's system context.
- **Technical References → API Reference** for the full endpoint catalogue.
