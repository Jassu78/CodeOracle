import { describe, expect, it } from "vitest";
import IORedis from "ioredis";
import {
  beginIndexRun,
  getIndexRunStats,
  getPendingFileCount,
  recordFileFailure,
} from "../src/lib/index-progress.js";

describe("index-progress", () => {
  const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6380", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  const repoId = `test-${Date.now()}`;

  it("tracks pending, failures, and totals across a run", async () => {
    await redis.connect();
    try {
      await beginIndexRun(redis, repoId, 3);
      expect(await getPendingFileCount(redis, repoId)).toBe(3);

      await recordFileFailure(redis, repoId);
      await recordFileFailure(redis, repoId);

      const stats = await getIndexRunStats(redis, repoId);
      expect(stats).toEqual({ pending: 1, failed: 2, total: 3 });
    } finally {
      await redis.del(
        `codeoracle:index:${repoId}:pending-files`,
        `codeoracle:index:${repoId}:failed-files`,
        `codeoracle:index:${repoId}:total-files`,
      );
      await redis.quit();
    }
  });
});
