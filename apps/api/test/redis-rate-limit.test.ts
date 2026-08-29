import Redis from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../src/lib/redis-rate-limit.js";

describe("checkRateLimit (Redis-backed)", () => {
  it("allows requests under the limit", async () => {
    const redis = new Redis();
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit(redis as never, "under-limit", 5, 60_000)).toBe(true);
    }
  });

  it("rejects once the limit is exceeded within the window", async () => {
    const redis = new Redis();
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit(redis as never, "at-limit", 3, 60_000)).toBe(true);
    }
    expect(await checkRateLimit(redis as never, "at-limit", 3, 60_000)).toBe(false);
  });

  it("uses a TTL on the counter key — does not grow the keyspace forever", async () => {
    const redis = new Redis();
    await checkRateLimit(redis as never, "has-ttl", 5, 30_000);
    const ttl = await redis.ttl("codeoracle:ratelimit:has-ttl");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it("tracks distinct keys independently", async () => {
    const redis = new Redis();
    for (let i = 0; i < 2; i++) {
      expect(await checkRateLimit(redis as never, "client-a", 2, 60_000)).toBe(true);
    }
    expect(await checkRateLimit(redis as never, "client-a", 2, 60_000)).toBe(false);
    // A different key must not be affected by client-a's counter.
    expect(await checkRateLimit(redis as never, "client-b", 2, 60_000)).toBe(true);
  });
});
