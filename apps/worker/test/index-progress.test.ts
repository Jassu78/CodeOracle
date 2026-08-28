import { describe, expect, it } from "vitest";
import Redis from "ioredis-mock";
import type IORedis from "ioredis";
import {
  beginIndexRun,
  getIndexRunStats,
  getPendingFileCount,
  recordFileFailure,
} from "../src/lib/index-progress.js";

describe("index-progress", () => {
  it("tracks pending, failures, and totals across a run", async () => {
    const redis = new Redis() as unknown as IORedis;
    const repoId = `test-${Date.now()}`;

    await beginIndexRun(redis, repoId, 3);
    expect(await getPendingFileCount(redis, repoId)).toBe(3);

    await recordFileFailure(redis, repoId);
    await recordFileFailure(redis, repoId);

    const stats = await getIndexRunStats(redis, repoId);
    expect(stats).toEqual({ pending: 1, failed: 2, total: 3 });
  });
});
