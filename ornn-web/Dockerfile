# Pin bun explicitly. `oven/bun:latest` floats and bun's workspace
# hoister behaviour has shifted between releases — earlier we saw
# `bun install` silently skip hoistable deps (e.g. `zustand`) when
# sibling workspaces were stubbed with empty `dependencies` blocks,
# then `bun run build` blew up at typecheck with "Cannot find module
# 'zustand'". Pinning here + copying the real sibling package.jsons
# below makes the install reproducible across CI / local / fresh dev
# machines.
FROM oven/bun:1.3.13 AS build
WORKDIR /app

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy every workspace package.json the lockfile references. We used to
# stub ornn-api / ornn-sdk to skip pulling their deps for the frontend
# build, but that's exactly what tripped the hoister: bun.lock was
# resolved against the real package.jsons, and the stubs (no deps) made
# bun think hoistable transitive deps weren't needed. Copying the real
# files keeps the lockfile + workspace graph consistent.
COPY ornn-web/package.json ornn-web/
COPY ornn-api/package.json ornn-api/
COPY ornn-sdk/package.json ornn-sdk/

RUN bun install

# Copy frontend source
COPY ornn-web/ ornn-web/

WORKDIR /app/ornn-web
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/ornn-web/dist /usr/share/nginx/html
# nginx:alpine envsubst's /etc/nginx/templates/*.template at startup
# (see /docker-entrypoint.d/20-envsubst-on-templates.sh). Substitution is
# scoped to NYXID_BACKEND_URL / ORNN_API_URL via NGINX_ENVSUBST_FILTER
# in the ConfigMap — $host / $scheme etc. stay literal.
COPY ornn-web/nginx.conf.template /etc/nginx/templates/default.conf.template
# Runtime frontend config: generate /config.js from its template and
# inject window.__ORNN_CONFIG__ at container startup.
COPY ornn-web/docker-entrypoint.d/40-envsubst-config-js.sh /docker-entrypoint.d/40-envsubst-config-js.sh
RUN chmod +x /docker-entrypoint.d/40-envsubst-config-js.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
