# @codeoracle/worker

BullMQ consumers for `chunk_file`, `embed_chunks`, `extract_decisions`, and `incremental_reindex` (job contracts in `@codeoracle/contracts/src/jobs.ts`). Stage 3 wires `extract_decisions` after index finalization.

## Ops notes

- **One worker per `REDIS_URL`.** Startup takes a Redis leader lock (`codeoracle:worker:leader`). A second process exits with an error — this avoids duplicate extracts and racing providers.
- Cap dogfood extract volume with `EXTRACT_QUEUE_LIMIT` (full index) or `pnpm co decisions extract <repoId> --limit 10`.
