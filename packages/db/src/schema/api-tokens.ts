import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { repos } from "./repos";

/**
 * Per-repo bearer token auth for `apps/api` (and, later, HTTP/SSE MCP
 * transport — D5.3). Only the hash is ever stored — the raw token is shown
 * once at creation time (see `createApiToken`) and never persisted.
 * Verification is a hash lookup, not a string compare of the secret.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash),
    repoIdx: index("api_tokens_repo_idx").on(table.repoId),
  }),
);
