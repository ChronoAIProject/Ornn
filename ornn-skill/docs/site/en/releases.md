# Ornn Releases

## v0.1.3 — Core Skills & Multi-Platform Agent Support (Current)

This release introduces Ornn Core Skills — three foundational skills that teach AI agents how to discover, create, and upload skills on the Ornn platform. It also adds prompt-based installation support for multiple agent platforms.

### What's New

1. **Ornn Core Skills** — Three skills shipped in the `.ornn-skills/` directory:
   - `ornn-search-and-run` — Discover, pull, and execute skills from the Ornn library via NyxID MCP
   - `ornn-upload` — Package and upload skills to the Ornn registry (with proper root folder ZIP structure and base64 body encoding)
   - `ornn-build` — Generate complete skill packages from natural language descriptions using AI (single-turn and multi-turn refinement)

2. **Prompt-Based Installation** — Users can install core skills by pasting a single prompt into their AI agent. No scripts or manual setup required. Replaces the previous `setup.sh` script approach.

3. **Multi-Platform Support** — Installation prompts for four agent platforms:
   - **Claude Code** — Skills in `.claude/skills/`, available as slash commands
   - **OpenAI Codex** — Skills in `codex/skills/` with `AGENTS.md` references
   - **Cursor** — Skills as rule files in `.cursor/rules/`
   - **Antigravity** — Skills in `.antigravity/skills/`

4. **Documentation Overhaul** — Developer guide (EN + ZH) rewritten with:
   - Platform-specific installation prompts
   - Detailed skill reference with real-world usage examples
   - Workflow diagrams showing how the three core skills work together
   - Upload guide clarified: ZIP must contain a root folder, body is base64-encoded

### Changes Since v0.1.2

| Area | Change |
|------|--------|
| `.ornn-skills/` | New directory with three core skills |
| `.ornn-skills/setup.sh` | Removed — replaced by prompt-based installation |
| `.ornn-skills/ornn-upload/SKILL.md` | Fixed ZIP packaging instructions (root folder required) and added base64 body encoding guide |
| `README.md` | Added core skills section with multi-platform installation table |
| `CLAUDE.md` | Added core skills section with editing guidelines |
| `developer-guide.md` (EN + ZH) | Added core skills installation, skill reference, and examples |
| `qs-agent-dev.md` (EN + ZH) | Expanded with NyxID MCP integration walkthrough |
| `ornn-skill/package.json` | Version bump 0.1.2 → 0.1.3 |
| `ornn-frontend/package.json` | Version bump 0.1.2 → 0.1.3 |

---

## v0.1.0-alpha — First Alpha

The first public alpha release of the Ornn skill platform. This release delivers the core user-facing features for skill authoring, discovery, testing, and management.

### Core Features

1. **Authentication & User Management** — Full integration with NyxID for OAuth login, JWT-based authorization, and role-based access control.

2. **Three Skill Creation Modes**
   - **Guided** — Step-by-step wizard for structured skill authoring
   - **Free** — Upload a pre-built skill package (ZIP)
   - **Generative** — Describe what you need and let AI generate the skill

3. **Skill Read, Update & Sandbox Playground** — View and update skill packages. Interactive sandbox playground for testing any skill with an AI agent that executes skills via context injection, with chrono-sandbox integration for script execution.

4. **Two Search Modes**
   - **Keyword search** — Traditional text-based search
   - **Semantic search** — Find skills by meaning, powered by vector embeddings

5. **Admin System** — Administrator dashboard for user activity monitoring and platform-wide skill management.

6. **Multi-language Support** — Full English and Chinese localization.

7. **Theme** — Dark mode and light mode.

8. **Agent-facing Services** — API endpoints for AI agents to search, fetch, upload, and author skills programmatically.

> For technical implementation details, refer to the **Technical Reference** section.
