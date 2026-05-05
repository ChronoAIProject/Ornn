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

# AgentSeal trust scanner (#253) — installed via pip into an isolated
# venv at /opt/agentseal so we don't fight Debian 12's PEP-668 ban on
# global pip installs. Pin the version explicitly so trust scores are
# reproducible across a known rule set; bumping it is intentional and
# shows up in CHANGELOG.
ARG AGENTSEAL_VERSION=0.5.0
ENV AGENTSEAL_VERSION=${AGENTSEAL_VERSION}
ENV AGENTSEAL_VENV=/opt/agentseal
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && python3 -m venv "$AGENTSEAL_VENV" \
 && "$AGENTSEAL_VENV/bin/pip" install --no-cache-dir "agentseal==${AGENTSEAL_VERSION}" \
 && ln -sf "$AGENTSEAL_VENV/bin/agentseal" /usr/local/bin/agentseal \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Surface the canonical command path so ornn-api's config defaults work
# without operator overrides. AGENTSEAL_COMMAND can still be overridden
# at runtime by the deployment.
ENV AGENTSEAL_COMMAND=/usr/local/bin/agentseal

COPY --from=install /app /app

# Copy source code
COPY ornn-api/src/ /app/ornn-api/src/

WORKDIR /app/ornn-api

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3802

CMD ["bun", "run", "src/index.ts"]
