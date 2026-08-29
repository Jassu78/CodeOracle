import Redis from "ioredis-mock";
import { describe, expect, it, vi } from "vitest";
import {
  peekDeferredPush,
  recordDeferredPush,
  takeDeferredPush,
  flushDeferredPushToQueue,
} from "../src/lib/deferred-push.js";

describe("deferred-push coalesce", () => {
  it("stores first push as base..tip", async () => {
    const redis = new Redis();
    const d = await recordDeferredPush(redis, "repo-store", {
      beforeSha: "aaa111",
      afterSha: "bbb222",
    });
    expect(d.baseSha).toBe("aaa111");
    expect(d.tipSha).toBe("bbb222");
    expect(await peekDeferredPush(redis, "repo-store")).toEqual(
      expect.objectContaining({ baseSha: "aaa111", tipSha: "bbb222" }),
    );
  });

  it("coalesces A→B then B→C into A→C", async () => {
    const redis = new Redis();
    await recordDeferredPush(redis, "repo-coalesce", { beforeSha: "aaa", afterSha: "bbb" });
    const d = await recordDeferredPush(redis, "repo-coalesce", { beforeSha: "bbb", afterSha: "ccc" });
    expect(d.baseSha).toBe("aaa");
    expect(d.tipSha).toBe("ccc");
  });

  it("take clears the key", async () => {
    const redis = new Redis();
    await recordDeferredPush(redis, "repo-take", { beforeSha: "a", afterSha: "b" });
    const taken = await takeDeferredPush(redis, "repo-take");
    expect(taken?.tipSha).toBe("b");
    expect(await peekDeferredPush(redis, "repo-take")).toBeNull();
    expect(await takeDeferredPush(redis, "repo-take")).toBeNull();
  });
});

describe("flushDeferredPushToQueue", () => {
  it("enqueues coalesced incremental job", async () => {
    const redis = new Redis();
    await recordDeferredPush(redis, "repo-flush", { beforeSha: "base", afterSha: "tip" });

    const add = vi.fn(async () => undefined);
    const queue = { getJob: vi.fn(async () => undefined), add };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };

    const result = await flushDeferredPushToQueue({
      redis,
      queue: queue as never,
      db: db as never,
      repoId: "repo-flush",
    });

    expect(result.flushed).toBe(true);
    expect(result.tipSha).toBe("tip");
    expect(add).toHaveBeenCalledOnce();
    const [, data] = add.mock.calls[0]!;
    expect(data).toEqual({
      repoId: "repo-flush",
      beforeSha: "base",
      afterSha: "tip",
    });
    expect(await peekDeferredPush(redis, "repo-flush")).toBeNull();
  });

  it("does not enqueue when tip already done in job_history", async () => {
    const redis = new Redis();
    await recordDeferredPush(redis, "repo-done", { beforeSha: "base", afterSha: "tip" });

    const add = vi.fn(async () => undefined);
    const queue = { getJob: vi.fn(async () => undefined), add };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "h1", status: "done" }],
          }),
        }),
      }),
    };

    const result = await flushDeferredPushToQueue({
      redis,
      queue: queue as never,
      db: db as never,
      repoId: "repo-done",
    });

    expect(result.flushed).toBe(false);
    expect(result.reason).toBe("tip already done");
    expect(add).not.toHaveBeenCalled();
  });
});
