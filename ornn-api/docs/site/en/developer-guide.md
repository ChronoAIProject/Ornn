# Developer Guide

## Overview

Ornn exposes a REST API that AI agents can use to discover and execute skills. Agents connect to ornn-api's API endpoints using NyxID authentication (JWT or API key).

## Authentication

All API requests require a NyxID token:

```
Authorization: Bearer <nyxid-jwt-or-api-key>
```

Two authentication methods:
- **JWT** — Obtained through NyxID OAuth flow
- **API Key** — Generated in NyxID (format: `nyx_<64-hex>`), validated via NyxID introspection

## Core API Endpoints

### Search Skills

```
GET /api/skill-search?query=<text>&mode=keyword&scope=public&page=1&pageSize=9
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Search text (optional, max 2000 chars) |
| `mode` | `keyword` \| `similarity` | `keyword` | Search mode |
| `scope` | `public` \| `private` \| `mixed` | `private` | Which skills to search |
| `page` | number | 1 | Page number |
| `pageSize` | number | 9 | Results per page (max 100) |

Response:
```json
{
  "data": [
    {
      "guid": "uuid",
      "name": "skill-name",
      "description": "...",
      "metadata": { "category": "runtime-based", "outputType": "text" },
      "tags": ["tag1"],
      "presignedPackageUrl": "https://..."
    }
  ],
  "pagination": { "page": 1, "pageSize": 9, "total": 42 }
}
```

### Get Skill Details

```
GET /api/skills/:idOrName
```

Returns full skill metadata including a presigned URL to download the package.

### Get Skill Format Rules

```
GET /api/skill-format/rules
```

Returns the complete skill format specification as Markdown. Useful for agents that create skills programmatically.

### Create a Skill

```
POST /api/skills
Content-Type: application/zip
Body: <ZIP bytes>
```

Upload a skill package (ZIP). The package must contain a valid `SKILL.md` with correct frontmatter.

### Update a Skill

```
PUT /api/skills/:id
Content-Type: application/zip
Body: <ZIP bytes>
```

### Delete a Skill

```
DELETE /api/skills/:id
```

### Toggle Visibility

```
PATCH /api/skills/:id/visibility
Content-Type: application/json

{ "isPublic": true }
```

## Executing Skills

Agents don't call chrono-sandbox directly. Instead, use the **Playground Chat** endpoint which handles the full execution lifecycle:

```
POST /api/playground/chat
Content-Type: application/json

{
  "model": "gpt-4o",
  "input": [
    { "role": "user", "content": "Run the chart-generator skill with this data..." }
  ]
}
```

Response: SSE stream with events:
- `text-delta` — Streaming text chunks
- `tool-call` — Tool invocation (skill_search, execute_script)
- `tool-result` — Tool execution result
- `finish` — End of response

### Execution Flow

```mermaid
sequenceDiagram
    participant Agent
    participant ornn-api
    participant NyxProvider as Nyx Provider (LLM)
    participant Sandbox as chrono-sandbox

    Agent->>ornn-api: POST /api/playground/chat (SSE)
    ornn-api->>NyxProvider: Responses API (stream)
    NyxProvider-->>ornn-api: text-delta events
    ornn-api-->>Agent: SSE text-delta

    Note over NyxProvider,ornn-api: LLM returns tool call
    NyxProvider-->>ornn-api: function_call (execute_script)
    ornn-api->>ornn-api: Auto-execute tool (server-side loop)
    ornn-api->>Sandbox: POST /execute
    Sandbox-->>ornn-api: stdout / files
    ornn-api->>NyxProvider: Tool result → next LLM round
    NyxProvider-->>ornn-api: Final text response
    ornn-api-->>Agent: SSE text-delta + finish
```

The chat endpoint uses a server-side tool-use loop (max 5 rounds). When the LLM decides to execute a skill, it automatically:
1. Downloads the skill package from chrono-storage
2. Injects user credentials as environment variables
3. Installs dependencies (npm/pip)
4. Executes the script in chrono-sandbox
5. Returns stdout (text) or generated files (uploaded to chrono-storage with presigned URLs)

## NyxID MCP Integration

NyxID can auto-generate an MCP server that exposes ornn's API as MCP tools. This lets Claude Code and other MCP-compatible agents use ornn skills natively:

- `skill_search` — Search the skill library
- `skill_pull` — Download a skill package
- `skill_upload` — Upload a new skill
- `execute_script` — Run a skill's script in sandbox

To set this up, configure the NyxID-generated MCP server in your agent's MCP config and provide your NyxID API key.

## Ornn Core Skills

Ornn provides three **core skills** that teach AI agents how to interact with the platform. They live in the [`.ornn-apis/`](https://github.com/ChronoAIProject/Ornn/tree/main/.ornn-apis) directory of the chrono-ornn repository.

### Installation

Pick the prompt for your agent platform, copy it, and paste it into your agent. It will fetch the skills from GitHub and set them up automatically.

> **Prerequisite:** Your agent must be connected to a **NyxID MCP server** to use these skills. NyxID provides the meta tools (`nyx__discover_services`, `nyx__connect_service`, `nyx__call_tool`) that the skills use to interact with Ornn.

#### Claude Code

Skills are stored in `.claude/skills/` and available as slash commands (`/ornn-search-and-run`, etc.).

```
Fetch the three Ornn core skill directories from https://github.com/ChronoAIProject/Ornn/tree/main/.ornn-apis — each directory (ornn-search-and-run, ornn-upload, ornn-build) contains a SKILL.md file. Download each SKILL.md and create the corresponding skill folder in my project's .claude/skills/ directory. The final structure should be:

.claude/skills/ornn-search-and-run/SKILL.md
.claude/skills/ornn-upload/SKILL.md
.claude/skills/ornn-build/SKILL.md
```

#### OpenAI Codex

Skills are stored as agent instructions in the `AGENTS.md` file or as separate files in a `codex/` directory.

```
Fetch the three Ornn core skill files from https://github.com/ChronoAIProject/Ornn/tree/main/.ornn-apis — each directory (ornn-search-and-run, ornn-upload, ornn-build) contains a SKILL.md file. Download each SKILL.md and save them into my project's codex/skills/ directory. The final structure should be:

codex/skills/ornn-search-and-run/SKILL.md
codex/skills/ornn-upload/SKILL.md
codex/skills/ornn-build/SKILL.md

Then add a reference to these skills in my AGENTS.md file (create it if it doesn't exist) so that Codex can discover and invoke them.
```

#### Cursor

Skills are stored as rule files in `.cursor/rules/`.

```
Fetch the three Ornn core skill files from https://github.com/ChronoAIProject/Ornn/tree/main/.ornn-apis — each directory (ornn-search-and-run, ornn-upload, ornn-build) contains a SKILL.md file. Download each SKILL.md and save them as rule files in my project's .cursor/rules/ directory. The final structure should be:

.cursor/rules/ornn-search-and-run.md
.cursor/rules/ornn-upload.md
.cursor/rules/ornn-build.md
```

#### Antigravity

Skills are stored in `.antigravity/skills/`.

```
Fetch the three Ornn core skill directories from https://github.com/ChronoAIProject/Ornn/tree/main/.ornn-apis — each directory (ornn-search-and-run, ornn-upload, ornn-build) contains a SKILL.md file. Download each SKILL.md and create the corresponding skill folder in my project's .antigravity/skills/ directory. The final structure should be:

.antigravity/skills/ornn-search-and-run/SKILL.md
.antigravity/skills/ornn-upload/SKILL.md
.antigravity/skills/ornn-build/SKILL.md
```

### Skill Reference

#### `/ornn-search-and-run` — Discover and Execute Skills

Search the Ornn skill library, pull a skill's content, and execute it — all in one command.

The skill guides your agent through: service discovery → Ornn connection → skill search (keyword or semantic) → pull skill JSON → read `SKILL.md` instructions → execute.

**Examples:**

```
/ornn-search-and-run Find a Korean translation skill and translate: Hello, I am a robot

/ornn-search-and-run Search for an image generation skill and generate a logo for my startup

/ornn-search-and-run Find a skill that can summarize web pages, then summarize https://example.com
```

**Example session output:**

| Step | What the agent does |
|------|-------------------|
| Search | Calls `ornn__searchskills` with `mode: "semantic"` → finds `any-language-to-korean-translation` |
| Pull | Calls `ornn__getskilljson` → receives `SKILL.md` with translation instructions |
| Execute | Follows the `plain` skill instructions → outputs the Korean translation |

#### `/ornn-build` — Generate New Skills with AI

Describe what you want in natural language, and Ornn's AI generates a complete skill package (`SKILL.md` + scripts if needed).

**Examples:**

```
/ornn-build Create a plain skill that detects sensitive information (API keys, passwords, PII) in text

/ornn-build Build a Node.js skill that converts CSV files to JSON using the csv-parse library

/ornn-build Generate a skill that reviews pull request descriptions for completeness
```

**How it works:**

1. Your agent calls `ornn__generateskill` with your description
2. Ornn streams back the generated skill (SSE: `generation_start` → `token` → `generation_complete`)
3. The agent reconstructs the skill content from the stream
4. You review the output and optionally upload it with `/ornn-upload`

Supports **multi-turn refinement** — if the first generation isn't quite right, the agent can call `ornn__generateskill` again with the conversation history to iterate.

#### `/ornn-upload` — Package and Upload Skills

Package a skill directory into a ZIP and upload it to the Ornn registry.

**Examples:**

```
/ornn-upload Upload the skill we just generated

/ornn-upload Package and upload my-custom-skill/ to Ornn
```

**Key details:**

- ZIP must contain a **root folder** with the skill name (e.g., `my-skill/SKILL.md`), not flat files
- The `body` parameter is the base64-encoded ZIP, sent via `ornn__uploadskill`
- If a skill with the same name exists, it creates a new version
- Validation checks `SKILL.md` frontmatter unless `skip_validation: true`

### Workflow Overview

The three skills cover the complete Ornn lifecycle:

```mermaid
graph LR
    A["/ornn-search-and-run"] -->|discover & execute| B["Ornn Skill Library"]
    C["/ornn-build"] -->|AI-generate| D["New Skill"]
    D -->|package & upload| E["/ornn-upload"]
    E --> B
```

## Skill Package Format Reference

```
skill-name/               # Root folder (kebab-case)
├── SKILL.md              # Required — exact casing
├── scripts/              # Optional — executable scripts
│   └── main.js           # .js/.mjs for node, .py for python
├── references/           # Optional — reference docs
└── assets/               # Optional — static files
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | kebab-case, 1-64 chars |
| `description` | Yes | 1-1024 chars |
| `version` | No | Semver string |
| `license` | No | SPDX identifier |
| `compatibility` | No | Target AI model |
| `metadata.category` | Yes | `plain`, `tool-based`, `runtime-based`, or `mixed` |
| `metadata.output-type` | Conditional | Required for `runtime-based`/`mixed`: `text` or `file` |
| `metadata.runtime` | Conditional | Required for `runtime-based`/`mixed`: `["node"]` or `["python"]` |
| `metadata.runtime-dependency` | No | npm packages or pip packages |
| `metadata.runtime-env-var` | No | Required env vars (UPPER_SNAKE_CASE) |
| `metadata.tool-list` | Conditional | Required for `tool-based`/`mixed` |
| `metadata.tag` | No | Up to 10 tags |

## Rate Limits and Constraints

| Constraint | Value |
|------------|-------|
| Max package size | 50 MB |
| Max search query | 2000 chars |
| Max tags per skill | 10 |
| Sandbox execution timeout | 60s default, 600s max |
| Playground tool-use rounds | 5 max |
