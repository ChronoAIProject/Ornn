FROM oven/bun:latest AS install

WORKDIR /app

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy this service
COPY ornn-api/package.json ornn-api/

# Stub frontend workspace (required by bun workspace resolution)
RUN mkdir -p ornn-web && echo '{"name":"ornn-web","version":"1.0.0","private":true}' > ornn-web/package.json

RUN bun install

# Runtime stage
FROM oven/bun:latest

WORKDIR /app

COPY --from=install /app /app

# Copy source code
COPY ornn-api/src/ /app/ornn-api/src/

WORKDIR /app/ornn-api

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3802

CMD ["bun", "run", "src/index.ts"]
