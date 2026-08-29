# Multi-stage images for api | worker | mcp-server.
# Build from repo root:
#   docker build -f infra/docker/Dockerfile --build-arg APP=api -t codeoracle-api .
#   docker build -f infra/docker/Dockerfile --build-arg APP=worker -t codeoracle-worker .
#   docker build -f infra/docker/Dockerfile --build-arg APP=mcp -t codeoracle-mcp .
#
# APP=mcp → @codeoracle/mcp-server
# Runtime still needs DATABASE_URL / REDIS_URL / QDRANT_URL (+ CODEORACLE_REPO_ID for mcp).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# tree-sitter native bindings + git (worker clone / history)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/cli/package.json apps/cli/
COPY packages/chunker/package.json packages/chunker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core-domain/package.json packages/core-domain/
COPY packages/db/package.json packages/db/
COPY packages/extraction/package.json packages/extraction/
COPY packages/gateway/package.json packages/gateway/
COPY packages/observability/package.json packages/observability/
COPY packages/queue/package.json packages/queue/
COPY packages/retrieval/package.json packages/retrieval/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/turbo.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
# Keep drizzle SQL for migrate jobs if needed from the api image.
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle

ARG APP=api
ENV CODEORACLE_APP=${APP}

# Default commands — override in compose if needed.
CMD ["sh", "-c", "case \"$CODEORACLE_APP\" in api) node apps/api/dist/main.js ;; worker) node apps/worker/dist/main.js ;; mcp) node apps/mcp-server/dist/main.js ;; *) echo \"Unknown APP=$CODEORACLE_APP\" >&2; exit 1 ;; esac"]
