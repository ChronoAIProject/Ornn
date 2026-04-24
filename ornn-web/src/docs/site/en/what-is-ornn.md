# What is Ornn

<!-- VERSION_BADGE -->

## Overview

Ornn is the industry-standard skill platform for AI agents. It provides a standardized way to create, publish, discover, verify, and test AI capabilities (skills) across any environment.

The ultimate goal of Ornn is **Skill-as-a-Service** — providing plug-and-play skill integration for any AI agent.

## Key Concepts

### Skills

A **skill** is a packaged AI capability — a combination of prompts, scripts, and metadata that an AI agent can discover and execute. Skills are versioned, validated, and stored in the Ornn skill library.

### The Skill Library

The Ornn skill library is a centralized hub where skills are published and discovered. It supports:

- **Semantic search** — find skills by meaning, not just keywords
- **Keyword search** — traditional text-based search
- **Category browsing** — explore skills by type (plain, tool-based, runtime-based, mixed)
- **Audit-gated sharing** — skills are reviewed before crossing org or public boundaries

### Sandbox Playground

The Ornn platform provides a sandbox playground for users to test any skill interactively. In the playground, an AI agent executes skills by injecting them into its context. When a skill involves code or script execution, the playground integrates with **chrono-sandbox** to run the scripts and return results.

- Isolated, secure execution environment
- Node.js and Python runtimes
- Dependency management
- File artifact retrieval
- Environment variable injection

## Who is Ornn for?

| Audience | Where to start |
|----------|---------------|
| **Web Users** — browse, create, and test skills via the web UI | [Quick Start as a Web User](/docs?section=qs-web-user) |
| **AI Agents** — operate every Ornn capability via the `nyxid` CLI | [Agent Manual](/docs?section=agent-manual) |
| **Developers & Operators** — understand what runs where | [System Architecture](/docs?section=system-architecture) · [External Integrations](/docs?section=external-integrations) |
