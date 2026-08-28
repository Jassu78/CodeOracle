import { z } from "zod";

/**
 * A tree-sitter-derived code chunk. `symbolName`/`parentSymbol` are null only
 * for sliding-window fallback chunks (no grammar available for that file).
 */
export const CodeChunkSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  filePath: z.string().min(1),
  symbolName: z.string().nullable(),
  parentSymbol: z.string().nullable(),
  language: z.string().min(1),
  byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().nonnegative(),
  content: z.string(),
  contentHash: z.string().min(1),
  embeddingModelId: z.string().min(1).nullable().default(null),
  qdrantPointId: z.string().nullable().default(null),
  lastIndexedSha: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type CodeChunk = z.infer<typeof CodeChunkSchema>;

/** Output of the chunker CLI/library before persistence — no DB-assigned fields yet. */
export const RawChunkSchema = z.object({
  filePath: z.string().min(1),
  symbolName: z.string().nullable(),
  parentSymbol: z.string().nullable(),
  language: z.string().min(1),
  byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().nonnegative(),
  content: z.string(),
  contentHash: z.string().min(1),
});
export type RawChunk = z.infer<typeof RawChunkSchema>;
