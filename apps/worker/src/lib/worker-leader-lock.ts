import type IORedis from "ioredis";

const LOCK_KEY = "codeoracle:worker:leader";
const LOCK_TTL_SEC = 60;
const REFRESH_MS = 30_000;

export type WorkerLeaderLock = {
  release: () => Promise<void>;
};

export async function acquireWorkerLeaderLock(redis: IORedis): Promise<WorkerLeaderLock> {
  const token = `${process.pid}:${Date.now()}`;
  const acquired = await redis.set(LOCK_KEY, token, "EX", LOCK_TTL_SEC, "NX");
  if (acquired !== "OK") {
    const holder = await redis.get(LOCK_KEY);
    throw new Error(
      `Another CodeOracle worker holds the leader lock (${holder ?? "unknown"}). ` +
        "Run only one worker per REDIS_URL.",
    );
  }

  const refresh = setInterval(() => {
    void redis.expire(LOCK_KEY, LOCK_TTL_SEC);
  }, REFRESH_MS);
  refresh.unref();

  return {
    release: async () => {
      clearInterval(refresh);
      const current = await redis.get(LOCK_KEY);
      if (current === token) await redis.del(LOCK_KEY);
    },
  };
}
