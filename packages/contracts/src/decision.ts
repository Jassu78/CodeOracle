import { z } from "zod";

/**
 * Decision source types. `review_comment` is schema-ready but explicitly
 * out of MVP scope — no extraction
 * pipeline may claim to produce it until PR review comment crawling exists.
 */
export const DecisionSourceType = z.enum(["pr", "commit", "review_comment"]);
export type DecisionSourceType = z.infer<typeof DecisionSourceType>;

/**
 * The core artifact of CodeOracle. Every field that answers "why" must be
 * present — an MCP answer with a null source_url is a bug, not an edge
 * case — MCP answers must always include a source URL.
 */
export const DecisionSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  topic: z.string().min(1).max(500),
  summary: z.string().min(1),
  alternativesConsidered: z.array(z.string()).default([]),
  decidedAt: z.string().datetime(),
  sourceType: DecisionSourceType,
  sourceUrl: z.string().url(),
  sourceSha: z.string().min(1),
  touchedPaths: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  supersededBy: z.string().uuid().nullable().default(null),
  embeddingModelId: z.string().min(1).nullable().default(null),
  extractionModelId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** Shape produced directly by the extraction LLM call, before IDs/timestamps are assigned. */
export const DecisionExtractionResultSchema = z.object({
  topic: z.string().min(1).max(500),
  summary: z.string().min(1),
  alternativesConsidered: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  touchedPaths: z.array(z.string()).default([]),
});
export type DecisionExtractionResult = z.infer<typeof DecisionExtractionResultSchema>;

/** Batch result: zero or more decisions extracted from one PR/commit. */
export const DecisionExtractionBatchSchema = z.object({
  decisions: z.array(DecisionExtractionResultSchema),
});
export type DecisionExtractionBatch = z.infer<typeof DecisionExtractionBatchSchema>;
