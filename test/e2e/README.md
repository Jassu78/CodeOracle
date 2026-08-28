# test/e2e

Cross-app integration tests for the Stage 2 ingestion pipeline.

## stage-2-index.integration.test.ts

Requires live Postgres, Redis, Qdrant, and Ollama (`nomic-embed-text` in `providers.yaml`).

```bash
cd infra/compose && docker compose up -d
pnpm db:migrate
pnpm test:integration   # sets INTEGRATION_TEST=1
```

Skipped in default `pnpm test` — enable explicitly for local/CI integration runs.
