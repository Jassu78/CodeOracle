/** Skip a provider for a cool-down window after repeated rate limits. */
export type CircuitBreakerOptions = {
  /** Consecutive 429s before opening the circuit. Default 2. */
  failureThreshold?: number;
  /** How long to skip the provider after opening. Default 5 minutes. */
  cooldownMs?: number;
  now?: () => number;
};

/**
 * Shared contract so `ProviderRegistry` doesn't care whether breaker state
 * lives in-process (single-instance / tests) or in Redis (multi-worker).
 * Methods are declared `Promise`-returning so callers can always `await`
 * regardless of which implementation is wired in.
 */
export interface CircuitBreakerPort {
  isOpen(providerId: string): Promise<boolean>;
  recordSuccess(providerId: string): Promise<void>;
  recordFailure(providerId: string, status: number): Promise<void>;
}

/**
 * In-memory breaker — correct only within a single process. Used as the
 * default when no Redis connection is supplied (tests, one-off CLI/MCP
 * reads) and as the reference implementation `RedisCircuitBreaker` mirrors.
 */
export class CircuitBreaker implements CircuitBreakerPort {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly state = new Map<
    string,
    { consecutiveFailures: number; openUntil: number }
  >();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 2;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** True when this provider should be skipped. */
  async isOpen(providerId: string): Promise<boolean> {
    const entry = this.state.get(providerId);
    if (!entry) return false;
    if (entry.openUntil <= 0) return false;
    if (this.now() >= entry.openUntil) {
      // Half-open: allow one probe; next success clears, next 429 re-opens.
      entry.openUntil = 0;
      return false;
    }
    return true;
  }

  async recordSuccess(providerId: string): Promise<void> {
    this.state.delete(providerId);
  }

  /** Only 429 (and optional status) trips the breaker. */
  async recordFailure(providerId: string, status: number): Promise<void> {
    if (status !== 429) return;
    const prev = this.state.get(providerId) ?? { consecutiveFailures: 0, openUntil: 0 };
    const consecutiveFailures = prev.consecutiveFailures + 1;
    if (consecutiveFailures >= this.failureThreshold) {
      this.state.set(providerId, {
        consecutiveFailures,
        openUntil: this.now() + this.cooldownMs,
      });
      return;
    }
    this.state.set(providerId, { consecutiveFailures, openUntil: 0 });
  }

  /** Test helper */
  openUntil(providerId: string): number {
    return this.state.get(providerId)?.openUntil ?? 0;
  }
}
