import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { repos } from "./repos";

/**
 * Job idempotency: every job is keyed by (repo_id, job_type, dedupe_key).
 * The unique index makes duplicate webhook delivery / retry a safe no-op at
 * the database level.
 *
 * `dedupeKey` is a generic dedupe token, not always a git SHA despite the
 * column's original name (`after_sha`, renamed here) — callers pass a real
 * `afterSha` for `incremental_reindex` (where it IS one), but
 * `chunk_file`/`embed_chunks` pass `${indexRunId}/${filePath}` and
 * `extract_decisions` passes a `github_sources` row id. The column name now
 * matches every job type's actual usage instead of only the one that
 * happens to be a SHA.
 */
export const jobHistory = pgTable(
  "job_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    dedupeKey: text("dedupe_key"),
    status: text("status").notNull().default("queued"), // queued | running | done | error
    tokensUsed: integer("tokens_used").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Last error message for failed jobs (G3.21 extract DLQ visibility). */
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("job_history_idempotency_unique").on(
      table.repoId,
      table.jobType,
      table.dedupeKey,
    ),
  }),
);
