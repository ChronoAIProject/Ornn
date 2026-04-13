# What is Ornn

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

### Sandbox Playground

The Ornn platform provides a sandbox playground for users to test any skill interactively. In the playground, an AI agent executes skills by injecting them into its context. When a skill involves code or script execution, the playground agent integrates with **chrono-sandbox** to run the scripts and return results.

- Isolated, secure execution environment
- Node.js and Python runtimes
- Dependency management
- File artifact retrieval
- Environment variable injection

## Who is Ornn for?

| Audience | Use Case |
|----------|----------|
| **Web Users** | Browse, create, and test skills via the web UI |
| **AI Agent Developers** | Integrate skill discovery, execution, and authoring into autonomous agents via the Ornn MCP tool |
