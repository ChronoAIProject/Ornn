FROM oven/bun:latest AS install

WORKDIR /app

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy this service
COPY ornn-skill/package.json ornn-skill/

# Stub frontend workspace (required by bun workspace resolution)
RUN mkdir -p ornn-frontend && echo '{"name":"ornn-frontend","version":"1.0.0","private":true}' > ornn-frontend/package.json

RUN bun install

# Runtime stage
FROM oven/bun:latest

WORKDIR /app

COPY --from=install /app /app

# Copy source code
COPY ornn-skill/src/ /app/ornn-skill/src/

# Copy docs for OpenAPI spec
COPY ornn-skill/docs/ /app/ornn-skill/docs/

WORKDIR /app/ornn-skill

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3802

CMD ["bun", "run", "src/index.ts"]
