import type IORedis from "ioredis";

const LOCK_KEY = "codeoracle:worker:leader";
const LOCK_TTL_SEC = 60;
const REFRESH_MS = 30_000;

export type WorkerLeaderLock = {
  /**
   * True if this process holds the leader marker. Advisory only — no code
   * path gates correctness on it. Multi-worker safety now comes from:
   *   - Redis-backed circuit breaker (provider 429 cool-downs are shared)
   *   - job_history unique (repo_id, job_type, after_sha) + BullMQ jobId
   *     (duplicate work is a DB/queue-level no-op, not a mutex problem)
   *   - BullMQ's own per-job lock (two workers never run the same job)
   */
  isLeader: boolean;
  release: () => Promise<void>;
};

/**
 * Best-effort "leader" marker for future singleton-only tasks (e.g. a cron
 * that should run once, not once per replica). Does NOT block a second
 * worker from starting — horizontal scaling (`pnpm worker` × N against the
 * same REDIS_URL) is supported. See RedisCircuitBreaker for why this is
 * safe now (it previously wasn't, when the breaker was in-memory).
 */
export async function acquireWorkerLeaderLock(redis: IORedis): Promise<WorkerLeaderLock> {
  const token = `${process.pid}:${Date.now()}`;
  const acquired = await redis.set(LOCK_KEY, token, "EX", LOCK_TTL_SEC, "NX");
  const isLeader = acquired === "OK";

  let refresh: NodeJS.Timeout | undefined;
  if (isLeader) {
    refresh = setInterval(() => {
      void (async () => {
        // Only renew if we still own the lock (avoid extending a stolen/expired key).
        const current = await redis.get(LOCK_KEY);
        if (current === token) await redis.expire(LOCK_KEY, LOCK_TTL_SEC);
      })();
    }, REFRESH_MS);
    refresh.unref();
  }

  return {
    isLeader,
    release: async () => {
      if (refresh) clearInterval(refresh);
      if (!isLeader) return;
      const current = await redis.get(LOCK_KEY);
      if (current === token) await redis.del(LOCK_KEY);
    },
  };
}
