-- L2: job_history.after_sha renamed to dedupe_key — the column is a
-- generic idempotency token for every job type (chunk_file/embed_chunks
-- use "<indexRunId>/<filePath>", extract_decisions uses a github_sources
-- row id), not always a git SHA. Only incremental_reindex's dedupe_key is
-- actually a SHA. Index is dropped/recreated under the same name since
-- Postgres does not support renaming a column referenced by a composite
-- unique index in place without also touching the index definition.
ALTER TABLE "job_history" DROP CONSTRAINT IF EXISTS "job_history_idempotency_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "job_history_idempotency_unique";--> statement-breakpoint
ALTER TABLE "job_history" RENAME COLUMN "after_sha" TO "dedupe_key";--> statement-breakpoint
CREATE UNIQUE INDEX "job_history_idempotency_unique" ON "job_history" USING btree ("repo_id","job_type","dedupe_key");
