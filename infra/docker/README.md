# infra/docker

Multi-stage images for `api`, `worker`, and `mcp-server`. Host `pnpm` + Compose data services remains the default dogfood path (root README).

## Build

From the **repo root**:

```bash
docker build -f infra/docker/Dockerfile --build-arg APP=api -t codeoracle-api:local .
docker build -f infra/docker/Dockerfile --build-arg APP=worker -t codeoracle-worker:local .
docker build -f infra/docker/Dockerfile --build-arg APP=mcp -t codeoracle-mcp:local .
```

`APP=mcp` runs `@codeoracle/mcp-server`. Runtime needs the same env as host processes (see `.env.example`).

## Run with Compose

```bash
cd infra/compose
docker compose -f docker-compose.yml -f docker-compose.images.yml --profile images up -d --build
```

- Data plane: Postgres / Redis / Qdrant (core compose).
- App plane: built images (profile `images`).
- Dev bind-mount alternative: `--profile full` via `docker-compose.full.yml` (installs on start — slower).

MCP **stdio** for editors still works best as host `pnpm mcp`. The `mcp` image defaults to Streamable HTTP (`CODEORACLE_MCP_TRANSPORT=http`) and requires a configured bearer.
