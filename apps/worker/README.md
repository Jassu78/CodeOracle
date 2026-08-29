# @codeoracle/worker

BullMQ consumers for `chunk_file`, `embed_chunks`, `extract_decisions`, and `incremental_reindex` (job contracts in `@codeoracle/contracts/src/jobs.ts`). Stage 3 wires `extract_decisions` after index finalization.

## Ops notes

- **Multiple workers per `REDIS_URL` are supported.** Run `pnpm worker` on N replicas against the same Redis/Postgres/Qdrant to scale extraction throughput horizontally. Correctness under multiple workers comes from three independent mechanisms, not a single mutex:
  - **Provider rate-limit cool-downs are shared via Redis** (`RedisCircuitBreaker` in `@codeoracle/gateway`) — every `ProviderRegistry` constructed in a worker processor passes `redis`, so a 429 learned by one replica is honored by all of them.
  - **Duplicate work is a DB/queue-level no-op**: `job_history` has a unique `(repo_id, job_type, after_sha)` index, and BullMQ job ids are deterministic (`bullJobId(...)`), so two replicas racing to enqueue/process the same unit of work collide safely instead of double-processing.
  - **BullMQ's own per-job lock** ensures two workers never execute the *same* job concurrently.
  - A Redis key (`codeoracle:worker:leader`) still exists as an **advisory** marker (first replica to start logs `isLeader: true`) reserved for any future singleton-only task — it does **not** block additional workers from starting.
- Cap dogfood extract volume with `EXTRACT_QUEUE_LIMIT` (full index) or `pnpm co decisions extract <repoId> --limit 10`.
- **Push while indexing:** `incremental_reindex` defers to Redis (`codeoracle:deferred-push:<repoId>`, tip coalesce). When the repo returns to `ready`, one catch-up incremental is flushed. Extract re-queue never removes **active** BullMQ jobs (lock-safe).
