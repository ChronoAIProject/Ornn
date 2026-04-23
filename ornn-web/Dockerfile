FROM oven/bun:latest AS build
WORKDIR /app

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy frontend package
COPY ornn-web/package.json ornn-web/

# Stub sibling workspaces (required by bun workspace resolution) —
# only ornn-web's dep graph is actually needed for the frontend build.
RUN mkdir -p ornn-api && echo '{"name":"ornn-api","version":"2.0.0","private":true}' > ornn-api/package.json
RUN mkdir -p ornn-sdk && echo '{"name":"@chronoai/ornn-sdk","version":"1.0.0","private":true}' > ornn-sdk/package.json

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
