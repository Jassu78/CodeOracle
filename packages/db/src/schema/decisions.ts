import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { repos } from "./repos";

/**
 * The core artifact of CodeOracle. `sourceUrl` is NOT NULL by design — the "no citation = bug" rule is enforced at the schema
 * level, not just in the zod contract or the prompt.
 *
 * `supersededBy` self-references this table, making it a living memory
 * instead of an append-only log: `find_decision` prefers the non-superseded
 * chain tip but can walk history on request.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    summary: text("summary").notNull(),
    // Stored as a Postgres text[] rather than a joined table — alternatives
    // are display-only content, never independently queried in v1.
    alternativesConsidered: text("alternatives_considered").array().notNull().default(sql`'{}'::text[]`),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    // 'pr' | 'commit' | 'review_comment' — review_comment is schema-ready but
    // not extracted yet. Kept as text, not pg enum, for forward compatibility.
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceSha: text("source_sha").notNull(),
    touchedPaths: text("touched_paths").array().notNull().default(sql`'{}'::text[]`),
    confidence: real("confidence").notNull(),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => decisions.id),
    embeddingModelId: text("embedding_model_id"),
    extractionModelId: text("extraction_model_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    repoIdx: index("decisions_repo_idx").on(table.repoId),
    sourceUrlIdx: index("decisions_source_url_idx").on(table.sourceUrl),
  }),
);
