import { z } from "zod";

/**
 * Golden-query eval contracts (PRD D5.1 / D5.2, NFR-5).
 * Expected answers are structural — file paths, topic predicates, citation
 * requirements — never free-form "LLM said something vaguely related."
 */

export const GoldenToolSchema = z.enum(["search_codebase", "find_decision", "explain_file"]);
export type GoldenTool = z.infer<typeof GoldenToolSchema>;

export const GoldenSearchExpectationSchema = z.object({
  /** At least one of these file paths must appear in top-K hits (hit@K). */
  anyOfFilePaths: z.array(z.string().min(1)).min(1),
  /** K for hit@K — PRD gate uses 3. */
  hitAt: z.number().int().positive().max(50).default(3),
});

export const GoldenFindDecisionExpectationSchema = z.object({
  /** Substring(s) that must appear in returned decision topic or summary (case-insensitive). */
  topicOrSummaryIncludes: z.array(z.string().min(1)).min(1),
  /**
   * Citation must be an http(s) URL (schema already requires url).
   * Optionally require a path fragment (e.g. `/commit/`).
   */
  sourceUrlIncludes: z.array(z.string().min(1)).default(["/commit/"]),
});

export const GoldenExplainFileExpectationSchema = z.object({
  /** Path passed to explain_file — must match a file in the fixture. */
  path: z.string().min(1),
  /** At least one chunk summary or related decision must be non-empty when indexed. */
  requireNonEmpty: z.boolean().default(true),
});

export const GoldenQuerySchema = z.discriminatedUnion("tool", [
  z.object({
    id: z.string().min(1),
    tool: z.literal("search_codebase"),
    query: z.string().min(1),
    expect: GoldenSearchExpectationSchema,
  }),
  z.object({
    id: z.string().min(1),
    tool: z.literal("find_decision"),
    query: z.string().min(1),
    expect: GoldenFindDecisionExpectationSchema,
  }),
  z.object({
    id: z.string().min(1),
    tool: z.literal("explain_file"),
    query: z.string().min(1).optional(),
    expect: GoldenExplainFileExpectationSchema,
  }),
]);
export type GoldenQuery = z.infer<typeof GoldenQuerySchema>;

export const GoldenQuerySetSchema = z.object({
  version: z.literal(1),
  /** Human-readable fixture this set targets (relative to repo root). */
  fixture: z.string().min(1),
  description: z.string().min(1),
  queries: z.array(GoldenQuerySchema).min(10).max(15),
});
export type GoldenQuerySet = z.infer<typeof GoldenQuerySetSchema>;
