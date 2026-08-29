import Redis from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { acquireWorkerLeaderLock } from "../src/lib/worker-leader-lock.js";

describe("acquireWorkerLeaderLock", () => {
  it("first caller becomes leader", async () => {
    const redis = new Redis();
    const lock = await acquireWorkerLeaderLock(redis as never);
    expect(lock.isLeader).toBe(true);
    await lock.release();
  });

  it("second caller does NOT throw and is not leader — multi-worker must not crash", async () => {
    const redis = new Redis();
    const first = await acquireWorkerLeaderLock(redis as never);
    expect(first.isLeader).toBe(true);

    const second = await acquireWorkerLeaderLock(redis as never);
    expect(second.isLeader).toBe(false);

    await first.release();
    await second.release();
  });

  it("release by a non-leader is a no-op (does not delete the real leader's key)", async () => {
    const redis = new Redis();
    const first = await acquireWorkerLeaderLock(redis as never);
    const second = await acquireWorkerLeaderLock(redis as never);

    await second.release();
    expect(await redis.get("codeoracle:worker:leader")).not.toBeNull();

    await first.release();
    expect(await redis.get("codeoracle:worker:leader")).toBeNull();
  });
});
