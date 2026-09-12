import type IORedis from "ioredis";
import { touchIndexLease } from "./index-lease.js";

const pendingKey = (repoId: string) => `codeoracle:index:${repoId}:pending-files`;
const failedKey = (repoId: string) => `codeoracle:index:${repoId}:failed-files`;
const totalKey = (repoId: string) => `codeoracle:index:${repoId}:total-files`;
const kindKey = (repoId: string) => `codeoracle:index:${repoId}:kind`;

export type IndexRunKind = "full" | "incremental";

export type IndexRunStats = {
  pending: number;
  failed: number;
  total: number;
};

export async function beginIndexRun(
  redis: IORedis,
  repoId: string,
  fileCount: number,
  kind: IndexRunKind = "full",
): Promise<void> {
  await redis
    .multi()
    .set(pendingKey(repoId), String(fileCount))
    .set(totalKey(repoId), String(fileCount))
    .set(failedKey(repoId), "0")
    .set(kindKey(repoId), kind)
    .exec();
  await touchIndexLease(redis, repoId);
}

export async function getIndexRunKind(redis: IORedis, repoId: string): Promise<IndexRunKind> {
  const raw = await redis.get(kindKey(repoId));
  return raw === "incremental" ? "incremental" : "full";
}

export async function markFileComplete(redis: IORedis, repoId: string): Promise<number> {
  const remaining = await redis.decr(pendingKey(repoId));
  await touchIndexLease(redis, repoId);
  return remaining;
}

/** Decrement pending and increment failed — call when a per-file job exhausts retries. */
export async function recordFileFailure(redis: IORedis, repoId: string): Promise<number> {
  const remaining = await redis
    .multi()
    .decr(pendingKey(repoId))
    .incr(failedKey(repoId))
    .exec()
    .then((results) => Number(results?.[0]?.[1] ?? 0));
  await touchIndexLease(redis, repoId);
  return remaining;
}

export async function clearIndexRun(redis: IORedis, repoId: string): Promise<void> {
  await redis.del(pendingKey(repoId), failedKey(repoId), totalKey(repoId), kindKey(repoId));
}

export async function getPendingFileCount(redis: IORedis, repoId: string): Promise<number> {
  const raw = await redis.get(pendingKey(repoId));
  return raw ? Number(raw) : 0;
}

export async function getIndexRunStats(redis: IORedis, repoId: string): Promise<IndexRunStats> {
  const [pendingRaw, failedRaw, totalRaw] = await redis.mget(
    pendingKey(repoId),
    failedKey(repoId),
    totalKey(repoId),
  );
  return {
    pending: pendingRaw ? Number(pendingRaw) : 0,
    failed: failedRaw ? Number(failedRaw) : 0,
    total: totalRaw ? Number(totalRaw) : 0,
  };
}
