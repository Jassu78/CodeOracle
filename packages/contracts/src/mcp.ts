import { z } from "zod";

/**
 * MCP tool I/O contracts. Rule enforced here, not just by prompt: every result item that represents an
 * answer must carry a citation. `SearchCodebaseResultItemSchema` requires
 * `filePath`; `FindDecisionResultSchema` requires `sourceUrl` — these are
 * non-optional in the schema, so a handler that omits them fails validation
 * before ever reaching the MCP client.
 */

export const SearchCodebaseInputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(50).default(10),
});
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;

export const SearchCodebaseResultItemSchema = z.object({
  chunkId: z.string().uuid(),
  filePath: z.string().min(1), // citation — never optional
  symbolName: z.string().nullable(),
  content: z.string(),
  score: z.number(),
  repoId: z.string().uuid(),
});
export type SearchCodebaseResultItem = z.infer<typeof SearchCodebaseResultItemSchema>;

export const SearchCodebaseOutputSchema = z.object({
  results: z.array(SearchCodebaseResultItemSchema),
});
export type SearchCodebaseOutput = z.infer<typeof SearchCodebaseOutputSchema>;

export const ExplainFileInputSchema = z.object({
  path: z.string().min(1),
});
export type ExplainFileInput = z.infer<typeof ExplainFileInputSchema>;

export const ExplainFileOutputSchema = z.object({
  path: z.string().min(1),
  chunkSummaries: z.array(z.string()),
  relatedDecisions: z.array(
    z.object({
      topic: z.string(),
      summary: z.string(),
      sourceUrl: z.string().url(), // citation — never optional
      decidedAt: z.string().datetime(),
      superseded: z.boolean(),
    }),
  ),
});
export type ExplainFileOutput = z.infer<typeof ExplainFileOutputSchema>;

export const FindDecisionInputSchema = z.object({
  topic: z.string().min(1),
  includeHistory: z.boolean().default(false),
});
export type FindDecisionInput = z.infer<typeof FindDecisionInputSchema>;

export const FindDecisionResultSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  alternativesConsidered: z.array(z.string()),
  sourceUrl: z.string().url(), // citation — never optional; "no citation = bug"
  confidence: z.number().min(0).max(1),
  /**
   * Fused hybrid RRF display score (E4). Floors use dense evidence separately;
   * this is the rank score clients see after survivors are ordered.
   */
  retrievalScore: z.number(),
  superseded: z.boolean(),
});
export type FindDecisionResult = z.infer<typeof FindDecisionResultSchema>;

export const FindDecisionOutputSchema = z.object({
  results: z.array(FindDecisionResultSchema),
});
export type FindDecisionOutput = z.infer<typeof FindDecisionOutputSchema>;
