<p align="center">
  <img src="ornn-frontend/public/ornn.png" width="180" />
</p>

<h1 align="center">Ornn</h1>

<p align="center">The skill platform for AI agents</p>

---

Ornn is an AI skill platform where users create, publish, discover, and execute AI skills — packaged prompts and scripts that any agent can use. The ultimate vision is **Skill-as-a-Service**: plug-and-play skill integration for any AI agent.

## What is Ornn

A **skill** is a packaged AI capability — a combination of prompts, scripts, and metadata that an AI agent can discover and execute. Skills are versioned, validated, and stored in the Ornn skill library.

The skill library provides multiple discovery methods:

- **Semantic search** — find skills by meaning, not just keywords
- **Keyword search** — traditional text-based search
- **Category browsing** — explore skills by type (plain, tool-based, runtime-based, mixed)

The **sandbox playground** lets users test any skill interactively. When a skill involves code execution, the playground integrates with chrono-sandbox to run scripts in an isolated environment with Node.js and Python runtimes, dependency management, and file artifact retrieval.

## Target Users

| Audience | Use Case |
|----------|----------|
| **Web Users** | Browse, create, and test skills via the web UI |
| **AI Agent Developers** | Integrate skill discovery and execution into agents via the Ornn API or MCP tools |

## Ornn Core Skills

Ornn ships with three **core skills** that teach AI agents how to interact with the platform. They live in the [`ornn-core-skills/`](ornn-core-skills/) directory:

| Skill | Description |
|-------|-------------|
| `ornn-search-and-run` | Discover, pull, and execute skills from the Ornn library |
| `ornn-upload` | Package and upload skills to the Ornn registry |
| `ornn-build` | Generate new skills via AI from natural language descriptions |

### Installing Core Skills

Copy the installation prompt for your agent platform and paste it into your agent. It will fetch the skills from GitHub and set them up automatically.

| Platform | Skills directory | Prompt |
|----------|-----------------|--------|
| **Claude Code** | `.claude/skills/` | [See installation prompt](#claude-code) |
| **OpenAI Codex** | `codex/skills/` + `AGENTS.md` | [See installation prompt](#openai-codex) |
| **Cursor** | `.cursor/rules/` | [See installation prompt](#cursor) |
| **Antigravity** | `.antigravity/skills/` | [See installation prompt](#antigravity) |

See the [Developer Guide](https://ornn.chrono-ai.fun/docs) for platform-specific installation prompts and detailed usage examples.

### Prerequisites

Core skills require a **NyxID MCP server** connection. Add the NyxID MCP server to your agent's MCP configuration to enable Ornn tool access.

## Documentation

Full documentation is available at [ornn.chrono-ai.fun/docs](https://ornn.chrono-ai.fun/docs).

## License

[Apache License 2.0](LICENSE)
