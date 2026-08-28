import { z } from "zod";

/**
 * Queue registry pattern: each job type is declared once here and imported
 * by both the producer (apps/api) and consumer (apps/worker). Shared types
 * keep idempotency and webhook dedup enforceable at the type level.
 */

export const JobStatus = z.enum(["queued", "running", "done", "error"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const FullIndexJobPayloadSchema = z.object({
  repoId: z.string().uuid(),
  githubFullName: z.string(),
  branch: z.string(),
});
export type FullIndexJobPayload = z.infer<typeof FullIndexJobPayloadSchema>;

export const IncrementalReindexJobPayloadSchema = z.object({
  repoId: z.string().uuid(),
  beforeSha: z.string(),
  afterSha: z.string(),
  // Idempotency key MUST be (repoId, afterSha).
});
export type IncrementalReindexJobPayload = z.infer<typeof IncrementalReindexJobPayloadSchema>;

export const ChunkFileJobPayloadSchema = z.object({
  repoId: z.string().uuid(),
  repoRoot: z.string(),
  filePath: z.string(),
  sha: z.string(),
  indexRunId: z.string().uuid(),
  embeddingModelId: z.string(),
});
export type ChunkFileJobPayload = z.infer<typeof ChunkFileJobPayloadSchema>;

export const EmbedChunksJobPayloadSchema = z.object({
  repoId: z.string().uuid(),
  chunkIds: z.array(z.string().uuid()).min(1),
  embeddingModelId: z.string(),
  filePath: z.string(),
  sha: z.string(),
  indexRunId: z.string().uuid(),
});
export type EmbedChunksJobPayload = z.infer<typeof EmbedChunksJobPayloadSchema>;

export const ExtractDecisionsJobPayloadSchema = z.object({
  repoId: z.string().uuid(),
  /** One BullMQ job per row in `github_sources`. */
  githubSourceId: z.string().uuid(),
});
export type ExtractDecisionsJobPayload = z.infer<typeof ExtractDecisionsJobPayloadSchema>;

export const JobHistorySchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  jobType: z.enum(["full_index", "incremental_reindex", "chunk_file", "embed_chunks", "extract_decisions"]),
  afterSha: z.string().nullable(),
  status: JobStatus,
  tokensUsed: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type JobHistory = z.infer<typeof JobHistorySchema>;

/** Job name registry — the single source of truth for BullMQ queue/job names. */
export const JOB_NAMES = {
  FULL_INDEX: "full_index",
  INCREMENTAL_REINDEX: "incremental_reindex",
  CHUNK_FILE: "chunk_file",
  EMBED_CHUNKS: "embed_chunks",
  EXTRACT_DECISIONS: "extract_decisions",
} as const;
