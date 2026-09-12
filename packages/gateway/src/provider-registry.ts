import type IORedis from "ioredis";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { getOrderedEndpoints } from "@codeoracle/config";
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitBreakerPort } from "./circuit-breaker.js";
import { RedisCircuitBreaker } from "./redis-circuit-breaker.js";
import { OpenAiCompatAdapter, ProviderRequestError } from "./openai-compat-adapter.js";
import { TeiRerankAdapter } from "./tei-rerank-adapter.js";
import type {
  ChatProviderPort,
  ChatCompletionResult,
  EmbeddingProviderPort,
  EmbeddingResult,
  RerankCandidateInput,
  RerankOptions,
  RerankProviderPort,
  RerankResult,
} from "./ports.js";
import type { ProviderUsageLogger } from "@codeoracle/contracts";

/**
 * Process-local fallback breaker — only correct for a single worker process.
 * Kept for tests and for callers that don't have a Redis connection handy
 * (one-off CLI/MCP reads). Any multi-worker path (worker processors) MUST
 * pass `redis` so cool-downs are actually shared — see RedisCircuitBreaker.
 */
let sharedCircuitBreaker: CircuitBreakerPort = new CircuitBreaker();

/** Test helper — reset shared state between cases. */
export function resetSharedCircuitBreaker(opts?: CircuitBreakerOptions): CircuitBreakerPort {
  sharedCircuitBreaker = new CircuitBreaker(opts);
  return sharedCircuitBreaker;
}

export type ProviderRegistryOptions = {
  config: ProvidersConfig;
  env?: NodeJS.ProcessEnv;
  /** D3.6 — log every attempt for observability and quota tracking. */
  onUsage?: ProviderUsageLogger;
  /**
   * Redis connection to back the circuit breaker across worker processes.
   * Pass this from every multi-worker call site (worker processors) so a
   * 429 cool-down learned by one process is honored by all of them.
   * Ignored if `circuitBreaker` is also supplied.
   */
  redis?: IORedis;
  /**
   * Skip providers after repeated 429s (default: Redis-backed when `redis`
   * is supplied, else the shared in-process breaker — 2 failures → 5 min
   * cool-down). Pass an instance/options to isolate (tests).
   */
  circuitBreaker?: CircuitBreakerPort | CircuitBreakerOptions;
};

export class ProviderRegistry
  implements EmbeddingProviderPort, ChatProviderPort, RerankProviderPort
{
  private readonly config: ProvidersConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onUsage?: ProviderUsageLogger;
  private readonly circuits: CircuitBreakerPort;

  constructor(opts: ProviderRegistryOptions | ProvidersConfig, env: NodeJS.ProcessEnv = process.env) {
    if ("config" in opts) {
      this.config = opts.config;
      this.env = opts.env ?? process.env;
      this.onUsage = opts.onUsage;
      if (opts.circuitBreaker instanceof CircuitBreaker) {
        this.circuits = opts.circuitBreaker;
      } else if (
        opts.circuitBreaker &&
        typeof (opts.circuitBreaker as CircuitBreakerPort).isOpen === "function"
      ) {
        this.circuits = opts.circuitBreaker as CircuitBreakerPort;
      } else if (opts.circuitBreaker) {
        this.circuits = new CircuitBreaker(opts.circuitBreaker as CircuitBreakerOptions);
      } else if (opts.redis) {
        this.circuits = new RedisCircuitBreaker(opts.redis);
      } else {
        this.circuits = sharedCircuitBreaker;
      }
    } else {
      this.config = opts;
      this.env = env;
      this.circuits = sharedCircuitBreaker;
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const endpoints = getOrderedEndpoints(this.config, "embeddings");
    if (endpoints.length === 0) throw new Error("No enabled embedding providers configured");

    let lastError: unknown;
    let attempted = 0;
    for (const endpoint of endpoints) {
      if (await this.circuits.isOpen(endpoint.id)) continue;
      if (this.isMissingRequiredKey(endpoint.apiKeyEnv)) {
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "embeddings",
          latencyMs: 0,
          success: false,
          error: `apiKeyEnv "${endpoint.apiKeyEnv}" is set but empty at request time — skipping endpoint`,
        });
        continue;
      }
      attempted += 1;
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const vectors = await adapter.embed(texts);
        await this.circuits.recordSuccess(endpoint.id);
        const result: EmbeddingResult = {
          providerId: endpoint.id,
          model: endpoint.model,
          vectors,
          latencyMs: Date.now() - started,
        };
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "embeddings",
          latencyMs: result.latencyMs,
          success: true,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRequestError) {
          await this.circuits.recordFailure(endpoint.id, err.status);
        }
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "embeddings",
          latencyMs: Date.now() - started,
          success: false,
          error: formatProviderError(err),
        });
        if (err instanceof ProviderRequestError && !err.retryable) {
          // Provider-specific hard failure (bad key/model) — try next endpoint.
          continue;
        }
      }
    }
    if (attempted === 0) {
      throw lastError ?? new Error("All embedding providers were skipped (circuit-open or missing API key)");
    }
    throw lastError ?? new Error("All embedding providers failed");
  }

  async complete(system: string, user: string): Promise<ChatCompletionResult> {
    const endpoints = getOrderedEndpoints(this.config, "chat");
    if (endpoints.length === 0) throw new Error("No enabled chat providers configured");

    let lastError: unknown;
    let attempted = 0;
    for (const endpoint of endpoints) {
      if (await this.circuits.isOpen(endpoint.id)) continue;
      if (this.isMissingRequiredKey(endpoint.apiKeyEnv)) {
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "chat",
          latencyMs: 0,
          success: false,
          error: `apiKeyEnv "${endpoint.apiKeyEnv}" is set but empty at request time — skipping endpoint`,
        });
        continue;
      }
      attempted += 1;
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const { content, tokensUsed } = await adapter.chatComplete(system, user);
        await this.circuits.recordSuccess(endpoint.id);
        const result: ChatCompletionResult = {
          providerId: endpoint.id,
          model: endpoint.model,
          content,
          latencyMs: Date.now() - started,
          tokensUsed,
        };
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "chat",
          latencyMs: result.latencyMs,
          tokensUsed,
          success: true,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRequestError) {
          await this.circuits.recordFailure(endpoint.id, err.status);
        }
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "chat",
          latencyMs: Date.now() - started,
          success: false,
          error: formatProviderError(err),
        });
        if (err instanceof ProviderRequestError && !err.retryable) {
          // Provider-specific hard failure (bad key/model) — try next endpoint.
          continue;
        }
      }
    }
    if (attempted === 0) {
      throw lastError ?? new Error("All chat providers were skipped (circuit-open or missing API key)");
    }
    throw lastError ?? new Error("All chat providers failed");
  }

  /**
   * E2.1 TEI cross-encoder. Dogfood is typically one local endpoint — multi-
   * endpoint failover is best-effort within `opts.timeoutMs`, not multi-hop
   * under a 150ms budget.
   */
  async rerank(
    query: string,
    candidates: RerankCandidateInput[],
    opts: RerankOptions,
  ): Promise<RerankResult> {
    if (candidates.length === 0) {
      const endpoints = getOrderedEndpoints(this.config, "rerank");
      const first = endpoints[0];
      return {
        providerId: first?.id ?? "none",
        model: first?.model ?? "none",
        results: [],
        latencyMs: 0,
      };
    }

    const endpoints = getOrderedEndpoints(this.config, "rerank");
    if (endpoints.length === 0) throw new Error("No enabled rerank providers configured");

    const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs));
    const deadline = Date.now() + timeoutMs;

    let lastError: unknown;
    let attempted = 0;
    for (const endpoint of endpoints) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        lastError = new ProviderRequestError(
          `Rerank budget exhausted after ${timeoutMs}ms`,
          408,
          true,
        );
        break;
      }
      if (await this.circuits.isOpen(endpoint.id)) continue;
      if (this.isMissingRequiredKey(endpoint.apiKeyEnv)) {
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "rerank",
          latencyMs: 0,
          success: false,
          error: `apiKeyEnv "${endpoint.apiKeyEnv}" is set but empty at request time — skipping endpoint`,
        });
        continue;
      }
      attempted += 1;
      const started = Date.now();
      const signal = AbortSignal.timeout(remaining);
      try {
        const adapter = new TeiRerankAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const results = await adapter.rerank(query, candidates, signal);
        await this.circuits.recordSuccess(endpoint.id);
        const result: RerankResult = {
          providerId: endpoint.id,
          model: endpoint.model,
          results,
          latencyMs: Date.now() - started,
        };
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "rerank",
          latencyMs: result.latencyMs,
          success: true,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRequestError) {
          await this.circuits.recordFailure(endpoint.id, err.status);
        }
        this.emitUsage({
          providerId: endpoint.id,
          model: endpoint.model,
          kind: "rerank",
          latencyMs: Date.now() - started,
          success: false,
          // formatProviderError never includes candidate/query bodies for TEI.
          error: formatProviderError(err),
        });
        if (err instanceof ProviderRequestError && !err.retryable) {
          continue;
        }
      }
    }
    if (attempted === 0) {
      throw lastError ?? new Error("All rerank providers were skipped (circuit-open or missing API key)");
    }
    throw lastError ?? new Error("All rerank providers failed");
  }

  primaryEmbeddingModelId(): string {
    return modelIdForKind(this.config, "embeddings");
  }

  primaryChatModelId(): string {
    return modelIdForKind(this.config, "chat");
  }

  private resolveKey(apiKeyEnv: string | null): string | null {
    if (!apiKeyEnv) return null;
    const key = this.env[apiKeyEnv];
    if (!key?.trim()) return null;
    return key;
  }

  /**
   * `loadProvidersConfig` fails loudly at process start if an enabled
   * endpoint's `apiKeyEnv` is missing/empty (see packages/config). This is
   * the same check applied again at request time, so a `ProviderRegistry`
   * constructed directly from an in-memory config (tests, or a future
   * caller that bypasses the loader) can't silently send an unauthenticated
   * request to a provider that expects one — it skips to the next endpoint
   * instead, consistent with "fail loud, never silently default anything
   * security-relevant" (see packages/config/src/env.ts).
   */
  private isMissingRequiredKey(apiKeyEnv: string | null): boolean {
    if (!apiKeyEnv) return false;
    return !this.env[apiKeyEnv]?.trim();
  }

  private emitUsage(event: Parameters<NonNullable<ProviderUsageLogger>>[0]): void {
    this.onUsage?.(event);
  }
}

function modelIdForKind(config: ProvidersConfig, kind: "chat" | "embeddings"): string {
  const [first] = getOrderedEndpoints(config, kind);
  if (!first) throw new Error(`No enabled ${kind} provider`);
  return `${first.id}:${first.model}`;
}

function formatProviderError(err: unknown): string {
  if (err instanceof ProviderRequestError) return `HTTP ${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
