# Chrono-Ornn Guide

## Part 1: For Web Users

### What is Ornn?

Ornn is an AI skill platform where you can create, share, and test AI skills. A "skill" is a packaged set of instructions (and optionally scripts) that AI agents can discover and execute.

### Getting Started

1. **Sign in** — Log in via NyxID (OAuth). No separate account needed.
2. **Explore skills** — Browse the public skill library on the home page. Use keyword or semantic search to find skills.
3. **Create a skill** — Choose one of four creation methods:
   - **Guided** — Step-by-step wizard with form fields
   - **Free-form** — Write SKILL.md directly in a code editor
   - **AI Generate** — Describe what you want and let AI create the skill
   - **Upload** — Upload a pre-built ZIP package

### Creating a Skill

Every skill is a ZIP package containing a `SKILL.md` file. The SKILL.md has two parts:

1. **Frontmatter** (YAML header) — Metadata: name, description, category, runtime, dependencies, etc.
2. **Body** (Markdown) — Usage instructions that AI agents read to understand how to use the skill.

#### Skill Categories

| Category | What it is | Example |
|----------|-----------|---------|
| **plain** | Prompt-only skill, no code execution | "Translate text to French" |
| **runtime-based** | Includes executable scripts | "Generate a chart from CSV data" |
| **tool-based** | Requires specific AI tools (e.g., Bash, Read) | "Analyze a local codebase" |
| **mixed** | Combines scripts + AI tools | "Scrape a website and analyze it" |

#### Runtime-Based Skills

If your skill includes scripts, you must specify:
- **Runtime**: `node` (JavaScript) or `python`
- **Output type**: `text` (script prints results to stdout) or `file` (script generates files like images/PDFs)
- **Dependencies**: npm packages or pip packages your script needs
- **Environment variables**: API keys or secrets your script requires (e.g., `OPENAI_API_KEY`)

Example frontmatter for a runtime-based skill:

```yaml
---
name: "chart-generator"
description: "Generate charts from data using Python matplotlib"
metadata:
  category: "runtime-based"
  output-type: "file"
  runtime:
    - "python"
  runtime-dependency:
    - "matplotlib"
    - "pandas"
  runtime-env-var:
    - "DATA_SOURCE_URL"
  tag:
    - "data-visualization"
---
```

### Using the Playground

The Playground lets you test skills interactively through AI chat:

1. Go to **Playground** in the navigation
2. Select an AI model from the dropdown
3. Set up **Credentials** in the sidebar — add any API keys your skills need (stored encrypted, never exposed)
4. Chat with the AI — ask it to find and execute skills

The AI can:
- **Search** for skills matching your request
- **Execute** skill scripts in a secure sandbox
- Return **text results** or **generated files** (images, PDFs, etc.)

### Managing Your Skills

- **My Skills** — View all skills you've created
- **Edit** — Update skill content, metadata, or scripts
- **Visibility** — Skills are private by default. Toggle to public to share with everyone.
- **Delete** — Remove a skill permanently

---

## Part 2: For Agent Developers

### Overview

Ornn exposes a REST API that AI agents can use to discover and execute skills. Agents connect to ornn-skill's API endpoints using NyxID authentication (JWT or API key).

### Authentication

All API requests require a NyxID token:

```
Authorization: Bearer <nyxid-jwt-or-api-key>
```

Two authentication methods:
- **JWT** — Obtained through NyxID OAuth flow
- **API Key** — Generated in NyxID (format: `nyx_<64-hex>`), validated via NyxID introspection

### Core API Endpoints for Agents

#### Search Skills

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
      "metadata": { "category": "runtime-based", "outputType": "text", ... },
      "tags": ["tag1"],
      "presignedPackageUrl": "https://..."
    }
  ],
  "pagination": { "page": 1, "pageSize": 9, "total": 42 }
}
```

#### Get Skill Details

```
GET /api/skills/:idOrName
```

Returns full skill metadata including a presigned URL to download the package.

#### Get Skill Format Rules

```
GET /api/skill-format/rules
```

Returns the complete skill format specification as Markdown. Useful for agents that create skills programmatically.

#### Create a Skill

```
POST /api/skills
Content-Type: application/zip
Body: <ZIP bytes>
```

Upload a skill package (ZIP). The package must contain a valid `SKILL.md` with correct frontmatter.

### Executing Skills

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

The chat endpoint uses a server-side tool-use loop (max 5 rounds). When the LLM decides to execute a skill, it automatically:
1. Downloads the skill package from chrono-storage
2. Injects user credentials as environment variables
3. Installs dependencies (npm/pip)
4. Executes the script in chrono-sandbox
5. Returns stdout (text) or generated files (uploaded to chrono-storage with presigned URLs)

### NyxID MCP Integration

NyxID can auto-generate an MCP server that exposes ornn's API as MCP tools. This lets Claude Code and other MCP-compatible agents use ornn skills natively:

- `skill_search` — Search the skill library
- `skill_pull` — Download a skill package
- `skill_upload` — Upload a new skill
- `execute_script` — Run a skill's script in sandbox

To set this up, configure the NyxID-generated MCP server in your agent's MCP config and provide your NyxID API key.

### Skill Package Format Reference

```
skill-name/               # Root folder (kebab-case)
├── SKILL.md              # Required — exact casing
├── scripts/              # Optional — executable scripts
│   └── main.js           # .js/.mjs for node, .py for python
├── references/           # Optional — reference docs
└── assets/               # Optional — static files
```

Frontmatter fields:

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

### Rate Limits and Constraints

| Constraint | Value |
|------------|-------|
| Max package size | 50 MB |
| Max search query | 2000 chars |
| Max tags per skill | 10 |
| Sandbox execution timeout | 60s default, 600s max |
| Playground tool-use rounds | 5 max |
