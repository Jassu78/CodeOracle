import { describe, expect, it, beforeEach } from "vitest";
import Redis from "ioredis-mock";
import {
  decisionCacheKey,
  hashCachePayload,
  indexEpochFromRepo,
  queryCacheGet,
  queryCacheSet,
  searchCacheKey,
} from "../src/query-result-cache.js";

describe("query-result-cache keys", () => {
  it("hashCachePayload is stable under key reorder", () => {
    expect(hashCachePayload({ b: 1, a: 2 })).toBe(hashCachePayload({ a: 2, b: 1 }));
  });

  it("searchCacheKey changes when rerankEnabled flips", () => {
    const base = {
      repoId: "r1",
      indexEpoch: 10,
      query: "auth",
      topK: 10,
      scoreThreshold: 0.35,
      absoluteMinScore: 0.35,
      rerankMaxCandidates: 20,
      rerankTimeoutMs: 150,
    };
    const off = searchCacheKey({ ...base, rerankEnabled: false });
    const on = searchCacheKey({ ...base, rerankEnabled: true });
    expect(off).not.toBe(on);
    expect(off).toContain("codeoracle:qcache:v1:search:r1:10:");
  });

  it("decisionCacheKey changes with includeHistory", () => {
    const base = {
      repoId: "r1",
      indexEpoch: 1,
      topic: "hmac",
      limit: 3,
      scoreThreshold: 0.45,
      relativeFloor: 0.85,
      absoluteMinScore: 0.58,
    };
    expect(decisionCacheKey({ ...base, includeHistory: false })).not.toBe(
      decisionCacheKey({ ...base, includeHistory: true }),
    );
  });

  it("indexEpochFromRepo takes max of full/incremental", () => {
    expect(
      indexEpochFromRepo({
        lastFullIndexAt: new Date("2026-01-01T00:00:00Z"),
        lastIncrementalAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(indexEpochFromRepo({ lastFullIndexAt: null, lastIncrementalAt: null })).toBe(0);
  });
});

describe("queryCacheGet/Set fail-open", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  it("round-trips a value with TTL", async () => {
    const key = "codeoracle:qcache:v1:test";
    expect(await queryCacheSet(redis as never, key, '{"results":[]}', 60)).toBe(true);
    const got = await queryCacheGet(redis as never, key);
    expect(got).toEqual({ ok: true, value: '{"results":[]}' });
  });

  it("returns miss when absent", async () => {
    expect(await queryCacheGet(redis as never, "missing")).toEqual({
      ok: false,
      reason: "miss",
    });
  });

  it("fail-open get/set on redis throw", async () => {
    const bad = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {
        throw new Error("down");
      },
    };
    expect(await queryCacheGet(bad as never, "k")).toEqual({ ok: false, reason: "error" });
    expect(await queryCacheSet(bad as never, "k", "{}", 10)).toBe(false);
  });
});
