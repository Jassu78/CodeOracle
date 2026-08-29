import type IORedis from "ioredis";
import type { CircuitBreakerOptions, CircuitBreakerPort } from "./circuit-breaker.js";

const KEY_PREFIX = "codeoracle:breaker";

/**
 * Redis-backed circuit breaker — the state every worker process must share
 * for provider rate-limit cooldowns to actually work once more than one
 * worker consumes the queue (fixes the root cause behind the single-worker
 * leader lock: an in-memory breaker previously made multi-worker unsafe).
 *
 * Design:
 *  - `open:{id}` key existence == circuit open. TTL == cooldown, so the
 *    cooldown *and* half-open reopen-on-expiry behavior both fall out of
 *    Redis key expiry for free — no manual "openUntil" bookkeeping needed.
 *  - `fails:{id}` is an atomic INCR counter with its own TTL so a burst of
 *    429s outside the failure window doesn't accumulate forever.
 */
export class RedisCircuitBreaker implements CircuitBreakerPort {
  private readonly failureThreshold: number;
  private readonly cooldownSec: number;

  constructor(
    private readonly redis: IORedis,
    opts: Pick<CircuitBreakerOptions, "failureThreshold" | "cooldownMs"> = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 2;
    this.cooldownSec = Math.max(1, Math.ceil((opts.cooldownMs ?? 5 * 60_000) / 1000));
  }

  async isOpen(providerId: string): Promise<boolean> {
    const val = await this.redis.get(this.openKey(providerId));
    return val !== null;
  }

  async recordSuccess(providerId: string): Promise<void> {
    await this.redis.del(this.failsKey(providerId), this.openKey(providerId));
  }

  async recordFailure(providerId: string, status: number): Promise<void> {
    if (status !== 429) return;

    const fails = await this.redis.incr(this.failsKey(providerId));
    if (fails === 1) {
      // Bound how long a failure streak can accumulate before it resets on its own.
      await this.redis.expire(this.failsKey(providerId), this.cooldownSec * 2);
    }

    if (fails >= this.failureThreshold) {
      await this.redis.set(this.openKey(providerId), "1", "EX", this.cooldownSec);
      await this.redis.del(this.failsKey(providerId));
    }
  }

  private openKey(providerId: string): string {
    return `${KEY_PREFIX}:${providerId}:open`;
  }

  private failsKey(providerId: string): string {
    return `${KEY_PREFIX}:${providerId}:fails`;
  }
}
