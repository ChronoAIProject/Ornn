# What is Ornn

<!-- VERSION_BADGE -->

## Overview

**Ornn is an agent-facing skill-lifecycle API.** AI agents call Ornn directly — over HTTP or MCP — to search, pull, run, build, upload, and share skills. The closest analog is **npm registry + npm CLI fused, model-agnostic**: works with Claude, GPT, Gemini, or any custom agent runtime, with no model lock-in.

The product framing is **Skill-as-a-Service** — plug-and-play skill integration for any AI agent.

> Ornn is *not* a human-facing skill marketplace. The web UI exists as a secondary surface for skill owners and platform admins; the primary product is the API contract.

## Key Concepts

### Skills

A **skill** is a packaged AI capability — a combination of prompts, scripts, and metadata that an AI agent can discover and execute. Skills are versioned, validated, and stored in the Ornn skill registry.

### The Skill Registry

The Ornn registry is the central store every agent calls into. It supports:

- **Semantic search** — find skills by meaning, not just keywords
- **Keyword search** — traditional text-based search
- **Category browsing** — explore skills by type (plain, tool-based, runtime-based, mixed)
- **Audit as a public risk label** — every skill carries a verdict (`green` / `yellow` / `red`); consumers of a skill are notified when its audit flips to risky

### Sandbox Playground

Ornn provides a sandbox playground that lets an agent (or a human stand-in) try any skill end-to-end before committing to it. The playground injects the skill into an LLM context; for skills with code or scripts, it integrates with **chrono-sandbox** to execute them and return results.

- Isolated, secure execution environment
- Node.js and Python runtimes
- Dependency management
- File artifact retrieval
- Environment variable injection

## Who is Ornn for?

| Audience | Where to start |
|----------|---------------|
| **AI Agents** *(primary)* — call Ornn over HTTP / MCP to manage their own skill lifecycle | [Agent Manual](/docs?section=agent-manual) |
| **Skill Owners & Admins** — manage skills, permissions, and audits via the GUI | [Quick Start as a Web User](/docs?section=qs-web-user) |
| **Platform Operators** — understand what runs where | [System Architecture](/docs?section=system-architecture) · [External Integrations](/docs?section=external-integrations) |
