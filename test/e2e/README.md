# test/e2e

Cross-app integration tests. Skipped in default `pnpm test` — enable explicitly
via `pnpm test:integration` (sets `INTEGRATION_TEST=1`), which is also what
CI's `integration-test` job runs on every PR (`.github/workflows/ci.yml`).

```bash
cd infra/compose && docker compose up -d
pnpm db:migrate
pnpm test:integration
```

Test files run **sequentially** (`fileParallelism: false` in `vitest.config.ts`)
— they share Qdrant `code_chunks`/`decisions` and one Redis-backed BullMQ queue
against real infra. Full index clears **per-repo** chunk vectors when the
collection is already hybrid (E8); legacy→hybrid still recreates the collection
once. Keep file parallelism off to avoid job/queue races.

## full-pipeline.integration.test.ts

The real product-path CI gate: index → embed → extract → retrieve
(`search_codebase` / `find_decision` / `explain_file`), exercised against a
scripted local git repo (`fixtures/build-sample-git-repo.ts`, built fresh in
a temp dir per run) and a fake OpenAI-compatible provider
(`fixtures/fake-provider-server.ts`, deterministic bag-of-words "embeddings"
+ a fixed decision JSON response). No Ollama/Gemini/Groq/OpenRouter/GitHub
PAT and no network egress — matches D5.1's requirement that CI never depend
on network access or a real repo's history staying stable.

Requires live Postgres, Redis, Qdrant only.

## stage-2-index.integration.test.ts

Lighter index-only check (crawl → chunk → embed → `ready`) against
`packages/chunker/fixtures`, also using the fake provider — no Ollama /
`providers.yaml`. Covered by the same CI job as full-pipeline.
