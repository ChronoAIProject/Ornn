FROM oven/bun:latest AS build
WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_NYXID_AUTHORIZE_URL
ARG VITE_NYXID_TOKEN_URL
ARG VITE_NYXID_CLIENT_ID
ARG VITE_NYXID_REDIRECT_URI
ARG VITE_NYXID_LOGOUT_URL

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_NYXID_AUTHORIZE_URL=$VITE_NYXID_AUTHORIZE_URL
ENV VITE_NYXID_TOKEN_URL=$VITE_NYXID_TOKEN_URL
ENV VITE_NYXID_CLIENT_ID=$VITE_NYXID_CLIENT_ID
ENV VITE_NYXID_REDIRECT_URI=$VITE_NYXID_REDIRECT_URI
ENV VITE_NYXID_LOGOUT_URL=$VITE_NYXID_LOGOUT_URL

# Copy workspace root package files
COPY package.json bun.lock ./

# Copy frontend package
COPY ornn-frontend/package.json ornn-frontend/

# Stub backend workspace (required by bun workspace resolution)
RUN mkdir -p ornn-skill && echo '{"name":"ornn-skill","version":"2.0.0","private":true}' > ornn-skill/package.json

RUN bun install

# Copy frontend source
COPY ornn-frontend/ ornn-frontend/

WORKDIR /app/ornn-frontend
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/ornn-frontend/dist /usr/share/nginx/html
COPY ornn-frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5847
CMD ["nginx", "-g", "daemon off;"]
