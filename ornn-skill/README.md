# ornn-skill

Skill CRUD, search, format validation, and AI generation service for the Ornn platform.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Database:** MongoDB
- **Vector Search:** Milvus (384-dim SBERT embeddings)
- **AI Generation:** OpenAI

## Service Info

| Property         | Value          |
|------------------|----------------|
| Port             | 3802           |
| Health endpoint  | `GET /health`  |

## Key Environment Variables

| Variable                   | Description                              |
|----------------------------|------------------------------------------|
| `JWT_SECRET`               | Secret key for verifying JWTs            |
| `MONGODB_URI`              | MongoDB connection string                |
| `MILVUS_URI`               | Milvus vector database connection string |
| `SKILL_CREATE_LLM_API_KEY` | OpenAI API key for skill generation      |
| `INTERNAL_SERVICE_SECRET`  | Shared secret for service-to-service auth|

See `.env.example` for the full list of environment variables.

## Dependencies

- **ornn-auth** — API key validation for external consumers
- **ornn-storage** — skill package (ZIP) storage and retrieval
- **ornn-shared** — shared middleware, types, DB connectors, and utilities

## Domains

| Domain          | Description                                                      |
|-----------------|------------------------------------------------------------------|
| skillCrud       | CRUD operations, format rules endpoint, ZIP validation           |
| skillSearch     | Unified search: keyword + similarity via SBERT embeddings/Milvus |
| skillGeneration | AI-powered skill generation via OpenAI (SSE streaming)           |

## Running Locally

```bash
bun install
bun run dev
```

## Running Tests

```bash
bun test
```
