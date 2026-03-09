# Environment Variables — ornn-skill

## Service

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILL_PORT` / `PORT` | No | `3802` | HTTP port the service listens on |

## MongoDB

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | No | `mongodb://localhost:27017` | MongoDB connection URI |
| `MONGODB_DB_NAME` | No | `skill_platform` | MongoDB database name |
| `MONGODB_USER` | No | — | MongoDB authentication username |
| `MONGODB_PASSWORD` | No | — | MongoDB authentication password |
| `MONGO_MAX_RETRIES` | No | `5` | Max connection retry attempts |
| `MONGO_RETRY_BASE_DELAY_MS` | No | `1000` | Base delay between retries (ms) |

## Milvus (Vector Search)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MILVUS_URI` | No | — | Milvus server URI. If unset, vector search is disabled (NullEmbeddingRepository) |
| `MILVUS_TOKEN` | No | — | Milvus authentication token |
| `MILVUS_DB_NAME` | No | `default` | Milvus database name |
| `MILVUS_COLLECTION_NAME` | No | `skill_embeddings` | Milvus collection for skill embeddings |
| `MILVUS_EMBEDDING_DIM` | No | `384` | Embedding vector dimension (matches SBERT model) |

## JWT

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | `change-me-in-production` | Secret key for verifying JWTs (must match ornn-auth) |

## Search

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILL_SEARCH_SIMILARITY_THRESHOLD` | No | `0.5` | Minimum cosine similarity score for vector search results |
| `EMBEDDING_MAX_CHARS` | No | `8192` | Max characters to embed per skill |

## LLM / AI Generation

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILL_CREATE_LLM_API_KEY` | No | — | OpenAI API key for AI skill generation. If unset, generation endpoint is disabled |
| `SKILL_CREATE_LLM_MODEL` | No | `gpt-4o` | OpenAI model for skill generation |
| `LLM_MAX_TOKENS` | No | `8192` | Max tokens for LLM generation response |
| `LLM_STREAM_TIMEOUT_MS` | No | `30000` | Timeout for SSE stream inactivity (ms) |
| `LLM_REQUEST_TIMEOUT_MS` | No | `60000` | Total request timeout for LLM calls (ms) |

## SSE

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SSE_KEEP_ALIVE_INTERVAL_MS` | No | `15000` | Keep-alive ping interval for SSE streams (ms) |

## File Upload

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKILL_UPLOAD_MAX_SIZE_BYTES` | No | `52428800` | Max skill ZIP upload size in bytes (default 50 MB) |

## Internal Service Communication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INTERNAL_SERVICE_SECRET` | **Yes** | — | Shared secret for service-to-service authentication |
| `STORAGE_SERVICE_URL` | No | `http://localhost:3805` | URL of the ornn-storage service |
| `S3_BUCKET` | No | `skill-platform` | S3 bucket name used for storage API calls |
| `AUTH_SERVICE_URL` | No | `http://localhost:3801` | URL of the ornn-auth service |
| `PLAYGROUND_INTERNAL_URL` | No | `http://localhost:3803` | URL of the ornn-playground service (for fetching user LLM configs) |

## Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `LOG_PRETTY` | No | `true` | Enable pretty-printed logs (set to `false` for JSON in production) |
