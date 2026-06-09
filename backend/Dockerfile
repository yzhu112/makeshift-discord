FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
RUN NODE_ENV=production pnpm install --frozen-lockfile --filter backend
RUN NODE_ENV=production pnpm deploy --filter=backend --prod --legacy /app/deploy

FROM node:22-slim
LABEL org.opencontainers.image.source=https://github.com/yzhu112/makeshift-discord
WORKDIR /app
COPY --from=build /app/deploy/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY backend/migrations ./migrations
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
