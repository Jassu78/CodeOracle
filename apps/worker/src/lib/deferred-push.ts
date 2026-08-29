import { JOB_NAMES, type IncrementalReindexJobPayload } from "@codeoracle/contracts";
import { findJobHistoryByKey, type Database } from "@codeoracle/db";
import { bullJobId } from "@codeoracle/queue";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { safeReplaceJob } from "./safe-replace-job.js";

const DEFERRED_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

export type DeferredPush = {
  /** Earliest beforeSha across coalesced pushes — compare base. */
  baseSha: string;
  /** Latest afterSha — compare tip. */
  tipSha: string;
  updatedAt: string;
};

function deferredKey(repoId: string): string {
  return `codeoracle:deferred-push:${repoId}`;
}

function parseDeferred(raw: string): DeferredPush | null {
  try {
    const v = JSON.parse(raw) as Partial<DeferredPush>;
    if (typeof v.baseSha !== "string" || typeof v.tipSha !== "string") return null;
    return {
      baseSha: v.baseSha,
      tipSha: v.tipSha,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Coalesce push SHAs while an index is running.
 * Keeps the first `beforeSha` as base and advances tip to the latest `afterSha`
 * so one catch-up incremental covers the full window (A→B then B→C ⇒ A→C).
 */
export async function recordDeferredPush(
  redis: IORedis,
  repoId: string,
  push: { beforeSha: string; afterSha: string },
): Promise<DeferredPush> {
  const key = deferredKey(repoId);
  const existing = parseDeferred((await redis.get(key)) ?? "");
  const next: DeferredPush = existing
    ? {
        baseSha: existing.baseSha,
        tipSha: push.afterSha,
        updatedAt: new Date().toISOString(),
      }
    : {
        baseSha: push.beforeSha,
        tipSha: push.afterSha,
        updatedAt: new Date().toISOString(),
      };
  await redis.set(key, JSON.stringify(next), "EX", DEFERRED_TTL_SEC);
  return next;
}

export async function peekDeferredPush(
  redis: IORedis,
  repoId: string,
): Promise<DeferredPush | null> {
  return parseDeferred((await redis.get(deferredKey(repoId))) ?? "");
}

/** Atomically read + clear deferred tip (best-effort get/del). */
export async function takeDeferredPush(
  redis: IORedis,
  repoId: string,
): Promise<DeferredPush | null> {
  const key = deferredKey(repoId);
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key);
  return parseDeferred(raw);
}

/**
 * After index → ready: enqueue one catch-up `incremental_reindex` for the coalesced tip.
 * Clears Redis only after a successful add/replace (or when tip is already done / active).
 */
export async function flushDeferredPushToQueue(opts: {
  redis: IORedis;
  queue: Queue;
  db: Database;
  repoId: string;
}): Promise<{ flushed: boolean; tipSha?: string; reason?: string }> {
  const deferred = await peekDeferredPush(opts.redis, opts.repoId);
  if (!deferred) return { flushed: false, reason: "none" };

  const prior = await findJobHistoryByKey(opts.db, {
    repoId: opts.repoId,
    jobType: JOB_NAMES.INCREMENTAL_REINDEX,
    afterSha: deferred.tipSha,
  });
  if (prior?.status === "done") {
    await takeDeferredPush(opts.redis, opts.repoId);
    return { flushed: false, tipSha: deferred.tipSha, reason: "tip already done" };
  }

  const payload: IncrementalReindexJobPayload = {
    repoId: opts.repoId,
    beforeSha: deferred.baseSha,
    afterSha: deferred.tipSha,
  };
  const jobId = bullJobId("incremental_reindex", opts.repoId, deferred.tipSha);
  const result = await safeReplaceJob({
    queue: opts.queue,
    name: JOB_NAMES.INCREMENTAL_REINDEX,
    jobId,
    data: payload,
    jobOpts: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });

  if (result === "skipped_active") {
    // Same tip already running — drop deferred marker to avoid a loop.
    await takeDeferredPush(opts.redis, opts.repoId);
    return { flushed: false, tipSha: deferred.tipSha, reason: "job already active" };
  }

  await takeDeferredPush(opts.redis, opts.repoId);
  return { flushed: true, tipSha: deferred.tipSha };
}
