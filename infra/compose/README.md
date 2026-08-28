# infra/compose

- `docker-compose.yml` — core stack (Postgres, Redis, Qdrant). Run with:

```bash
cd infra/compose
docker compose up -d
docker compose ps   # all three should report "healthy"
```

- `docker-compose.full.yml` — optional `--profile full` adds **one** worker + API container (dev parity). See file header for usage.
