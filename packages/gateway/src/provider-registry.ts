import type { ProvidersConfig } from "@codeoracle/contracts";
import { getOrderedEndpoints } from "@codeoracle/config";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import { OpenAiCompatAdapter, ProviderRequestError } from "./openai-compat-adapter.js";
import type {
  ChatProviderPort,
  ChatCompletionResult,
  EmbeddingProviderPort,
  EmbeddingResult,
} from "./ports.js";
import type { ProviderUsageLogger } from "@codeoracle/contracts";

/** Process-wide breaker so extract jobs share 429 cool-downs. */
let sharedCircuitBreaker = new CircuitBreaker();

/** Test helper — reset shared state between cases. */
export function resetSharedCircuitBreaker(opts?: CircuitBreakerOptions): CircuitBreaker {
  sharedCircuitBreaker = new CircuitBreaker(opts);
  return sharedCircuitBreaker;
}

export type ProviderRegistryOptions = {
  config: ProvidersConfig;
  env?: NodeJS.ProcessEnv;
  /** D3.6 — log every attempt for observability and quota tracking. */
  onUsage?: ProviderUsageLogger;
  /**
   * Skip providers after repeated 429s (default: shared process breaker,
   * 2 failures → 5 min cool-down). Pass an instance/options to isolate.
   */
  circuitBreaker?: CircuitBreaker | CircuitBreakerOptions;
};

export class ProviderRegistry implements EmbeddingProviderPort, ChatProviderPort {
  private readonly config: ProvidersConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onUsage?: ProviderUsageLogger;
  private readonly circuits: CircuitBreaker;

  constructor(opts: ProviderRegistryOptions | ProvidersConfig, env: NodeJS.ProcessEnv = process.env) {
    if ("config" in opts) {
      this.config = opts.config;
      this.env = opts.env ?? process.env;
      this.onUsage = opts.onUsage;
      if (opts.circuitBreaker instanceof CircuitBreaker) {
        this.circuits = opts.circuitBreaker;
      } else if (opts.circuitBreaker) {
        this.circuits = new CircuitBreaker(opts.circuitBreaker);
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
      if (this.circuits.isOpen(endpoint.id)) continue;
      attempted += 1;
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const vectors = await adapter.embed(texts);
        this.circuits.recordSuccess(endpoint.id);
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
          this.circuits.recordFailure(endpoint.id, err.status);
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
      throw lastError ?? new Error("All embedding providers are circuit-open (rate limited)");
    }
    throw lastError ?? new Error("All embedding providers failed");
  }

  async complete(system: string, user: string): Promise<ChatCompletionResult> {
    const endpoints = getOrderedEndpoints(this.config, "chat");
    if (endpoints.length === 0) throw new Error("No enabled chat providers configured");

    let lastError: unknown;
    let attempted = 0;
    for (const endpoint of endpoints) {
      if (this.circuits.isOpen(endpoint.id)) continue;
      attempted += 1;
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const { content, tokensUsed } = await adapter.chatComplete(system, user);
        this.circuits.recordSuccess(endpoint.id);
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
          this.circuits.recordFailure(endpoint.id, err.status);
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
      throw lastError ?? new Error("All chat providers are circuit-open (rate limited)");
    }
    throw lastError ?? new Error("All chat providers failed");
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
