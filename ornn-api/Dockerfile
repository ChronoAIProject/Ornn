# Pin bun explicitly. `oven/bun:latest` floats and bun's workspace
# hoister behaviour has shifted between releases (see the comment in
# ornn-web/Dockerfile for the failure mode). Same pinning + same
# copy-the-real-package.jsons treatment here so the install stage stays
# reproducible.
FROM oven/bun:1.3.13 AS install

WORKDIR /app

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy every workspace package.json the lockfile references. Stubs used
# to live here too (see git history) and they hit the same bun-hoister
# issue documented in ornn-web/Dockerfile — the lockfile and stubbed
# package.jsons drifted apart and `bun install` skipped hoistable deps.
COPY ornn-api/package.json ornn-api/
COPY ornn-web/package.json ornn-web/
COPY ornn-sdk/package.json ornn-sdk/

RUN bun install

# Runtime stage
FROM oven/bun:1.3.13

WORKDIR /app

COPY --from=install /app /app

# Copy source code
COPY ornn-api/src/ /app/ornn-api/src/

WORKDIR /app/ornn-api

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3802

CMD ["bun", "run", "src/index.ts"]
