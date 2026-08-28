import { eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { Env } from "@codeoracle/config";
import { JOB_NAMES } from "@codeoracle/contracts";
import { repos, type Database } from "@codeoracle/db";
import {
  finalizeIndexIfComplete,
  markRepoIndexError,
} from "../processors/full-index.js";
import { clearIndexRun, getIndexRunStats, getPendingFileCount } from "./index-progress.js";

export type RecoverResult = {
  repoId: string;
  action: "finalized" | "marked_error" | "unchanged";
  detail: string;
};

const PER_FILE_JOBS = new Set<string>([JOB_NAMES.CHUNK_FILE, JOB_NAMES.EMBED_CHUNKS]);

async function countActiveRepoJobs(queue: Queue, repoId: string): Promise<number> {
  const jobs = await queue.getJobs(["waiting", "delayed", "active"], 0, 500);
  return jobs.filter(
    (job) =>
      (job.data as { repoId?: string }).repoId === repoId && PER_FILE_JOBS.has(job.name),
  ).length;
}

export async function recoverStaleIndexRun(opts: {
  env: Env;
  redis: IORedis;
  db: Database;
  queue: Queue;
  repoId: string;
}): Promise<RecoverResult> {
  const [repo] = await opts.db.select().from(repos).where(eq(repos.id, opts.repoId)).limit(1);
  if (!repo) return { repoId: opts.repoId, action: "unchanged", detail: "repo not found" };
  if (repo.indexStatus !== "indexing") {
    return { repoId: opts.repoId, action: "unchanged", detail: `status is ${repo.indexStatus}` };
  }

  const pending = await getPendingFileCount(opts.redis, opts.repoId);
  const stats = await getIndexRunStats(opts.redis, opts.repoId);

  if (pending <= 0) {
    const finalized = await finalizeIndexIfComplete({
      env: opts.env,
      redis: opts.redis,
      db: opts.db,
      repoId: opts.repoId,
    });
    return {
      repoId: opts.repoId,
      action: finalized ? "finalized" : "marked_error",
      detail: finalized ? "pending was 0 — finalized run" : "pending was 0 — all files failed",
    };
  }

  if (stats.total === 0) {
    await markRepoIndexError(opts.env, opts.repoId, opts.redis, opts.db);
    return {
      repoId: opts.repoId,
      action: "marked_error",
      detail: "indexing with no run metadata — marked error",
    };
  }

  const activeJobs = await countActiveRepoJobs(opts.queue, opts.repoId);
  if (activeJobs === 0) {
    await markRepoIndexError(opts.env, opts.repoId, opts.redis, opts.db);
    await clearIndexRun(opts.redis, opts.repoId);
    return {
      repoId: opts.repoId,
      action: "marked_error",
      detail: `stale run pending=${pending} but queue empty — marked error`,
    };
  }

  return {
    repoId: opts.repoId,
    action: "unchanged",
    detail: `still running pending=${pending} activeJobs=${activeJobs}`,
  };
}

export async function recoverAllStaleIndexes(opts: {
  env: Env;
  redis: IORedis;
  db: Database;
  queue: Queue;
}): Promise<RecoverResult[]> {
  const indexing = await opts.db.select({ id: repos.id }).from(repos).where(eq(repos.indexStatus, "indexing"));
  const results: RecoverResult[] = [];
  for (const row of indexing) {
    results.push(
      await recoverStaleIndexRun({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        queue: opts.queue,
        repoId: row.id,
      }),
    );
  }
  return results;
}
