import type { Env } from "@codeoracle/config";
import { JOB_NAMES, type EmbedChunksJobPayload, type ProvidersConfig } from "@codeoracle/contracts";
import { markChunksEmbeddingStatus, type Database } from "@codeoracle/db";
import type { Job } from "bullmq";
import type IORedis from "ioredis";
import { finalizeIndexIfComplete } from "../processors/full-index.js";
import { recordFileFailure } from "./index-progress.js";

const PER_FILE_JOBS = new Set<string>([JOB_NAMES.CHUNK_FILE, JOB_NAMES.EMBED_CHUNKS]);

export function isJobAttemptsExhausted(job: Job): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

/** G2.05 — per-file job failure must still advance the index run counter. */
export async function handleIndexJobFailure(opts: {
  env: Env;
  providers: ProvidersConfig;
  redis: IORedis;
  db: Database;
  queue: import("bullmq").Queue;
  job: Job | undefined;
  err: Error;
}): Promise<void> {
  const { job, err } = opts;
  if (!job || !PER_FILE_JOBS.has(job.name) || !isJobAttemptsExhausted(job)) return;

  const repoId = (job.data as { repoId?: string }).repoId;
  const filePath = (job.data as { filePath?: string }).filePath;
  if (!repoId) return;

  console.error(
    `Index job exhausted retries repo=${repoId} job=${job.name} file=${filePath ?? "?"}:`,
    err.message,
  );

  if (job.name === JOB_NAMES.EMBED_CHUNKS) {
    const chunkIds = (job.data as EmbedChunksJobPayload).chunkIds;
    if (chunkIds?.length) {
      await markChunksEmbeddingStatus(opts.db, chunkIds, "failed");
    }
  }

  await recordFileFailure(opts.redis, repoId);
  await finalizeIndexIfComplete({
    env: opts.env,
    providers: opts.providers,
    redis: opts.redis,
    db: opts.db,
    repoId,
    queue: opts.queue,
  });
}
