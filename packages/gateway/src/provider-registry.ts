import type { ProvidersConfig } from "@codeoracle/contracts";
import { getOrderedEndpoints } from "@codeoracle/config";
import { OpenAiCompatAdapter, ProviderRequestError } from "./openai-compat-adapter.js";
import type {
  ChatProviderPort,
  ChatCompletionResult,
  EmbeddingProviderPort,
  EmbeddingResult,
} from "./ports.js";
import type { ProviderUsageLogger } from "@codeoracle/contracts";

export type ProviderRegistryOptions = {
  config: ProvidersConfig;
  env?: NodeJS.ProcessEnv;
  /** D3.6 — log every attempt for observability and quota tracking. */
  onUsage?: ProviderUsageLogger;
};

export class ProviderRegistry implements EmbeddingProviderPort, ChatProviderPort {
  private readonly config: ProvidersConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onUsage?: ProviderUsageLogger;

  constructor(opts: ProviderRegistryOptions | ProvidersConfig, env: NodeJS.ProcessEnv = process.env) {
    if ("config" in opts) {
      this.config = opts.config;
      this.env = opts.env ?? process.env;
      this.onUsage = opts.onUsage;
    } else {
      this.config = opts;
      this.env = env;
    }
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const endpoints = getOrderedEndpoints(this.config, "embeddings");
    if (endpoints.length === 0) throw new Error("No enabled embedding providers configured");

    let lastError: unknown;
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const vectors = await adapter.embed(texts);
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
    throw lastError ?? new Error("All embedding providers failed");
  }

  async complete(system: string, user: string): Promise<ChatCompletionResult> {
    const endpoints = getOrderedEndpoints(this.config, "chat");
    if (endpoints.length === 0) throw new Error("No enabled chat providers configured");

    let lastError: unknown;
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const { content, tokensUsed } = await adapter.chatComplete(system, user);
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
