import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { repos } from "./repos";

/**
 * Chunk metadata lives here; the vector itself lives in Qdrant, tagged with
 * this row's id as qdrant_point_id. Qdrant stores vectors + minimal payload
 * only — Postgres remains the source of truth for chunk metadata.
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    // null only for sliding-window fallback chunks (no tree-sitter grammar available).
    symbolName: text("symbol_name"),
    parentSymbol: text("parent_symbol"),
    language: text("language").notNull(),
    byteStart: integer("byte_start").notNull(),
    byteEnd: integer("byte_end").notNull(),
    content: text("content").notNull(),
    // Change detection without re-diffing content on incremental reindex.
    contentHash: text("content_hash").notNull(),
    embeddingModelId: text("embedding_model_id"),
    qdrantPointId: text("qdrant_point_id"),
    lastIndexedSha: text("last_indexed_sha").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    repoFileIdx: index("chunks_repo_file_idx").on(table.repoId, table.filePath),
    contentHashIdx: index("chunks_content_hash_idx").on(table.contentHash),
    qdrantPointUnique: uniqueIndex("chunks_qdrant_point_unique").on(table.qdrantPointId),
  }),
);
