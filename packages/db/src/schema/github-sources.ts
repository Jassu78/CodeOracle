import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { repos } from "./repos";

/** Raw PR/commit payloads fetched during indexing — input for Stage 3 extraction. */
export const githubSources = pgTable(
  "github_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(), // pr | commit
    externalId: text("external_id").notNull(),
    title: text("title"),
    body: text("body"),
    sourceUrl: text("source_url"),
    sourceSha: text("source_sha").notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    rawJson: jsonb("raw_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    repoTypeIdx: index("github_sources_repo_type_idx").on(table.repoId, table.sourceType),
    repoShaUnique: uniqueIndex("github_sources_repo_sha_unique").on(table.repoId, table.sourceSha),
  }),
);
