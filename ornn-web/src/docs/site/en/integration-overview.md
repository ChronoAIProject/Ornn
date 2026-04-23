# Ornn Integration Overview

## Integration Points

Ornn integrates with several external services to provide its full functionality.

## NyxID Integration

### Authentication

- **OAuth 2.0** — web UI login flow
- **JWT verification** — API request authentication via JWKS
- **API key introspection** — machine-to-machine auth

### LLM Gateway

NyxID provides a unified LLM Gateway that Ornn uses for:

- Skill generation (Generative Mode)
- Playground chat (skill-mediated conversations)
- Semantic embedding generation (for vector search)

The Gateway follows the **Responses API** format.

## chrono-storage Integration

Ornn uses chrono-storage (S3-compatible) for skill package management:

- **Upload** — store skill ZIP packages
- **Download** — retrieve packages for execution or preview
- **Delete** — clean up when skills are removed
- **Presigned URLs** — secure, time-limited access

## chrono-sandbox Integration

The sandbox service executes skill scripts:

```
POST /execute
{
  "runtime": "node",
  "code": "...",
  "dependencies": ["axios@1.6.0"],
  "envVars": { "API_KEY": "..." },
  "timeout": 30000
}
```

Responses include stdout, stderr, exit code, and generated file artifacts.
