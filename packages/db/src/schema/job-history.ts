import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { repos } from "./repos";

/**
 * Job idempotency: every reindex job is keyed by (repo_id, after_sha).
 * The unique index on (repoId, jobType, afterSha) makes duplicate webhook
 * delivery a safe no-op at the database level.
 */
export const jobHistory = pgTable(
  "job_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    afterSha: text("after_sha"),
    status: text("status").notNull().default("queued"), // queued | running | done | error
    tokensUsed: integer("tokens_used").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("job_history_idempotency_unique").on(
      table.repoId,
      table.jobType,
      table.afterSha,
    ),
  }),
);
