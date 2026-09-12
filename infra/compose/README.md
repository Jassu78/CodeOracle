# infra/compose

**Launch path (D5.6):** run data services here; run `pnpm worker` / `pnpm api` / `pnpm mcp` on the host (see root README). That is the supported ₹0 ship setup.

## Core stack (required)

Postgres 16 + Redis 7 + Qdrant v1.12.4 — healthchecked.

```bash
cd infra/compose
docker compose up -d
docker compose ps   # all three should report "healthy"
```

Defaults match `.env.example` (`DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`).

Port conflicts with native Postgres/Redis/Qdrant:

```bash
POSTGRES_HOST_PORT=5433 REDIS_HOST_PORT=6380 docker compose up -d
# then point DATABASE_URL / REDIS_URL in .env at those host ports
```

Tear down (wipes volumes):

```bash
docker compose down -v
```

## Optional `full` profile (dev parity)

Mounts the monorepo into Node containers and runs worker + API via `pnpm` (install on start — slow first boot). **Not** production images; default **one** worker replica (scale only with matching rebuilt `dist` — see E9 / `apps/worker/README.md`).

```bash
# from infra/compose, with a filled-in repo-root .env
docker compose -f docker-compose.yml -f docker-compose.full.yml --profile full up -d
```

## Optional `images` profile (built apps)

Multi-stage images from `infra/docker/Dockerfile`:

```bash
docker compose -f docker-compose.yml -f docker-compose.images.yml --profile images up -d --build
```

Prefer host processes for day-to-day dogfood (`pnpm worker`, `pnpm api`).

## RAM note

Core services idle ≈ 0.5–1GB. Adding host worker/api/mcp + Ollama embed is the Stage-0 budget (~2–3.5GB). Do not load a large local chat model alongside the full stack on a 12GB box by default.
