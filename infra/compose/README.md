# infra/compose

- `docker-compose.yml` — core stack (Postgres, Redis, Qdrant). Run with:

  ```bash
  cd infra/compose
  docker compose up -d
  docker compose ps   # all three should report "healthy"
  ```

- Later: `docker-compose.full.yml` (api + worker + mcp-server) and optional Ollama. Not scaffolded yet.
