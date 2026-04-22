# Architecture — chrono-ornn

> For API v1 and architecture conventions, see [`conventions.md`](./conventions.md). Active refactor work is tracked under the [`Refactor` milestone](https://github.com/ChronoAIProject/Ornn/milestone/6).

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

## Ornn Core Skills

The `.ornn-apis/` directory contains three plain skills that teach AI agents how to use Ornn:

| Skill | Purpose |
|-------|---------|
| `ornn-search-and-run` | Discover, pull, and execute skills via NyxID MCP |
| `ornn-upload` | Package and upload skills to the registry |
| `ornn-build` | Generate new skills from natural language via AI |

### Editing Core Skills

When editing skills in `.ornn-apis/`:
- Each skill is a single directory containing at minimum a `SKILL.md` file
- `SKILL.md` must have valid YAML frontmatter with `name`, `description`, and `metadata.category`
- Skills guide AI agents through multi-step MCP workflows — keep instructions precise and include example JSON payloads
- The upload skill must instruct agents to create ZIPs **with a root folder** (e.g., `skill-name/SKILL.md`), not flat files
