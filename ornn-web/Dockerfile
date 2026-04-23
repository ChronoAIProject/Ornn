FROM oven/bun:latest AS build
WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_NYXID_AUTHORIZE_URL
ARG VITE_NYXID_TOKEN_URL
ARG VITE_NYXID_CLIENT_ID
ARG VITE_NYXID_REDIRECT_URI
ARG VITE_NYXID_LOGOUT_URL

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy frontend package
COPY ornn-web/package.json ornn-web/

# Stub backend workspace (required by bun workspace resolution)
RUN mkdir -p ornn-api && echo '{"name":"ornn-api","version":"2.0.0","private":true}' > ornn-api/package.json

RUN bun install

# Copy frontend source
COPY ornn-web/ ornn-web/

WORKDIR /app/ornn-web
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/ornn-web/dist /usr/share/nginx/html
COPY ornn-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
