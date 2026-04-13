# NyxID

## Overview

NyxID is the identity and AI gateway service that Ornn relies on for authentication and LLM access.

## Authentication

### OAuth 2.0

The web UI uses NyxID's OAuth flow:

1. User clicks "Login with NyxID"
2. Redirect to NyxID authorization endpoint
3. User authenticates and consents
4. Redirect back with authorization code
5. Exchange code for JWT tokens

### JWT Verification

API requests include a JWT in the Authorization header. The backend verifies tokens using NyxID's JWKS endpoint.

### API Keys

For machine-to-machine access, NyxID issues API keys that can be used in place of JWTs.

## LLM Gateway

NyxID provides a unified LLM Gateway that abstracts multiple LLM providers:

### Supported Operations

- **Chat completions** — multi-turn conversations
- **Text embeddings** — vector representations for semantic search
- **Streaming** — real-time token streaming via SSE

### API Format

The Gateway uses the **Responses API** format:

```bash
POST /v1/responses
Content-Type: application/json
Authorization: Bearer <token>

{
  "model": "...",
  "input": [
    { "role": "user", "content": "Hello" }
  ]
}
```

## User Management

NyxID manages:

- User profiles and display names
- LLM credentials and quotas
- Security settings (2FA, sessions)
- API key lifecycle
