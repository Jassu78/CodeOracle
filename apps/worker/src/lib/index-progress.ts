import type IORedis from "ioredis";

const pendingKey = (repoId: string) => `codeoracle:index:${repoId}:pending-files`;

export async function beginIndexRun(redis: IORedis, repoId: string, fileCount: number): Promise<void> {
  await redis.set(pendingKey(repoId), String(fileCount));
}

export async function markFileComplete(redis: IORedis, repoId: string): Promise<number> {
  const remaining = await redis.decr(pendingKey(repoId));
  return remaining;
}

export async function clearIndexRun(redis: IORedis, repoId: string): Promise<void> {
  await redis.del(pendingKey(repoId));
}

export async function getPendingFileCount(redis: IORedis, repoId: string): Promise<number> {
  const raw = await redis.get(pendingKey(repoId));
  return raw ? Number(raw) : 0;
}
