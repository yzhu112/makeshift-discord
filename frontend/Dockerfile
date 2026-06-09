FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
RUN NODE_ENV=production pnpm install --frozen-lockfile --filter frontend
COPY frontend ./frontend
RUN cd frontend && VITE_API_BASE_URL=/api pnpm build

FROM caddy:2-alpine
LABEL org.opencontainers.image.source=https://github.com/yzhu112/makeshift-discord
COPY --from=build /app/frontend/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
