import type IORedis from "ioredis";

const pendingKey = (repoId: string) => `codeoracle:index:${repoId}:pending-files`;
const failedKey = (repoId: string) => `codeoracle:index:${repoId}:failed-files`;
const totalKey = (repoId: string) => `codeoracle:index:${repoId}:total-files`;

export type IndexRunStats = {
  pending: number;
  failed: number;
  total: number;
};

export async function beginIndexRun(redis: IORedis, repoId: string, fileCount: number): Promise<void> {
  await redis
    .multi()
    .set(pendingKey(repoId), String(fileCount))
    .set(totalKey(repoId), String(fileCount))
    .set(failedKey(repoId), "0")
    .exec();
}

export async function markFileComplete(redis: IORedis, repoId: string): Promise<number> {
  const remaining = await redis.decr(pendingKey(repoId));
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
  return remaining;
}

export async function clearIndexRun(redis: IORedis, repoId: string): Promise<void> {
  await redis.del(pendingKey(repoId), failedKey(repoId), totalKey(repoId));
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
