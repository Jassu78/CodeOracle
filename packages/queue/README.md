# @codeoracle/queue

Thin **BullMQ** helpers shared by `apps/api` (producer) and `apps/worker` (consumer).

| Export | Role |
|--------|------|
| `createQueue` | Queue named `codeoracle` |
| `createWorker` | Worker with shared connection + concurrency |

Job **names and Zod payloads** live in `@codeoracle/contracts` (`JOB_NAMES`, `*JobPayloadSchema`). Idempotency is recorded in Postgres `job_history`, not only in Redis.
