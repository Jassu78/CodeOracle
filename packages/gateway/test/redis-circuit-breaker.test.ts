import Redis from "ioredis-mock";
import { describe, expect, it } from "vitest";
import { RedisCircuitBreaker } from "../src/redis-circuit-breaker.js";

// ioredis-mock shares one in-memory keyspace across `new Redis()` instances
// within a process — use a unique provider id per test to avoid cross-test
// bleed (mirrors how real provider ids are unique in production anyway).
describe("RedisCircuitBreaker", () => {
  it("stays closed below the failure threshold", async () => {
    const redis = new Redis();
    const breaker = new RedisCircuitBreaker(redis as never, { failureThreshold: 2 });

    await breaker.recordFailure("below-threshold", 429);
    expect(await breaker.isOpen("below-threshold")).toBe(false);
  });

  it("opens after reaching the failure threshold and honors cooldown TTL", async () => {
    const redis = new Redis();
    const breaker = new RedisCircuitBreaker(redis as never, {
      failureThreshold: 2,
      cooldownMs: 60_000,
    });

    await breaker.recordFailure("at-threshold", 429);
    await breaker.recordFailure("at-threshold", 429);
    expect(await breaker.isOpen("at-threshold")).toBe(true);

    // TTL-based half-open: simulate expiry by deleting the key directly
    // (ioredis-mock EX support is time-based; assert the open key exists first).
    const ttl = await redis.ttl("codeoracle:breaker:at-threshold:open");
    expect(ttl).toBeGreaterThan(0);
  });

  it("ignores non-429 failures", async () => {
    const redis = new Redis();
    const breaker = new RedisCircuitBreaker(redis as never, { failureThreshold: 1 });

    await breaker.recordFailure("non-429", 500);
    expect(await breaker.isOpen("non-429")).toBe(false);
  });

  it("recordSuccess clears failure count and open state", async () => {
    const redis = new Redis();
    const breaker = new RedisCircuitBreaker(redis as never, { failureThreshold: 2 });

    await breaker.recordFailure("clears-on-success", 429);
    await breaker.recordFailure("clears-on-success", 429);
    expect(await breaker.isOpen("clears-on-success")).toBe(true);

    await breaker.recordSuccess("clears-on-success");
    expect(await breaker.isOpen("clears-on-success")).toBe(false);
  });

  it("shares state across two breaker instances on the same Redis (multi-worker simulation)", async () => {
    const redis = new Redis();
    const workerA = new RedisCircuitBreaker(redis as never, { failureThreshold: 2 });
    const workerB = new RedisCircuitBreaker(redis as never, { failureThreshold: 2 });

    await workerA.recordFailure("shared-provider", 429);
    await workerB.recordFailure("shared-provider", 429);

    // Worker B's failure pushed the shared counter to threshold — both must see it open.
    expect(await workerA.isOpen("shared-provider")).toBe(true);
    expect(await workerB.isOpen("shared-provider")).toBe(true);
  });
});
