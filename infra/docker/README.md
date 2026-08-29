# infra/docker

**Status (D5.6):** No multi-stage production images yet — intentional.

**Supported launch:** Compose for Postgres/Redis/Qdrant (`infra/compose`) + host `pnpm` for `api` / `worker` / `mcp-server` / `cli`. See root README.

The optional Compose `full` profile (`docker-compose.full.yml`) mounts the repo into `node:22-bookworm-slim` and runs `pnpm worker` / `pnpm api` for local parity only — not OCI/production packaging.

Per-app Dockerfiles (`api`, `worker`, `mcp-server`) can land later when a fixed runtime image is needed; they are **not** a Stage 5 MVP ship blocker.
