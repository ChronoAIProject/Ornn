# Quick Start

## For Web Users

### 1. Sign In

Log in via **NyxID** (OAuth). No separate account needed — your NyxID credentials work directly.

### 2. Explore Skills

Browse the public skill library on the home page. Use the search bar with **keyword** or **semantic** search to find skills by name, description, or tags.

### 3. Create a Skill

Click **Build** in the navigation bar and choose a creation method:

| Method | Best For |
|--------|----------|
| **Guided** | First-time creators — step-by-step wizard |
| **Free-form** | Experienced users — write SKILL.md directly |
| **AI Generate** | Anyone — describe what you want, AI builds it |
| **Upload** | Pre-built packages — upload a ZIP file |

### 4. Test in Playground

Open any skill's detail page and click **Try in Playground**. The playground provides:

- Interactive AI chat interface
- File preview of the skill's package
- Environment variable configuration for runtime skills
- Real-time streaming responses

---

## For Agent Developers

### 1. Get an API Key

Generate a NyxID API key (format: `nyx_<64-hex>`) from your NyxID account settings.

### 2. Authenticate

Include your token in all API requests:

```
Authorization: Bearer <nyxid-jwt-or-api-key>
```

### 3. Search Skills

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://ornn.chronoai.dev/api/skill-search?query=web+scraper&mode=keyword"
```

### 4. Execute Skills

Use the Playground Chat endpoint for full skill execution:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input":[{"role":"user","content":"Run the chart-generator skill"}]}' \
  "https://ornn.chronoai.dev/api/playground/chat"
```

The server handles the entire execution lifecycle — downloading packages, installing dependencies, running scripts in the sandbox, and returning results.

### 5. MCP Integration

NyxID can auto-generate an MCP server that exposes ornn's API as MCP tools, enabling Claude Code and other MCP-compatible agents to use ornn skills natively.
