import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One row per registered GitHub repo. MVP is single-repo; multi-repo workspaces
 * can add a `workspace_id` FK later without changing this table's core shape.
 */
export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    githubFullName: text("github_full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    webhookSecretHash: text("webhook_secret_hash").notNull(),
    lastFullIndexAt: timestamp("last_full_index_at", { withTimezone: true }),
    lastIncrementalAt: timestamp("last_incremental_at", { withTimezone: true }),
    // pending | indexing | ready | error — kept as text, not pg enum, so adding
    // a new status later is a migration-free application-level change.
    indexStatus: text("index_status").notNull().default("pending"),
    // Set for offline/local mirrors — never register company repos via personal PAT.
    localClonePath: text("local_clone_path"),
    // Locked per-repo at registration time so upgrading the embedding model
    // for new repos never flag-day-migrates existing indexes.
    embeddingModelId: text("embedding_model_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    githubFullNameUnique: uniqueIndex("repos_github_full_name_unique").on(table.githubFullName),
  }),
);
