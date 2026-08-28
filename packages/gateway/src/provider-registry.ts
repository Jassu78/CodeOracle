import type { ProvidersConfig } from "@codeoracle/contracts";
import { getOrderedEndpoints } from "@codeoracle/config";
import { OpenAiCompatAdapter, ProviderRequestError } from "./openai-compat-adapter.js";
import type { ChatProviderPort, EmbeddingProviderPort, EmbeddingResult, ChatCompletionResult } from "./ports.js";

export class ProviderRegistry implements EmbeddingProviderPort, ChatProviderPort {
  constructor(
    private readonly config: ProvidersConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const endpoints = getOrderedEndpoints(this.config, "embeddings");
    let lastError: unknown;
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const vectors = await adapter.embed(texts);
        return {
          providerId: endpoint.id,
          model: endpoint.model,
          vectors,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRequestError && !err.retryable) break;
      }
    }
    throw lastError ?? new Error("No embedding providers configured");
  }

  async complete(system: string, user: string): Promise<ChatCompletionResult> {
    const endpoints = getOrderedEndpoints(this.config, "chat");
    let lastError: unknown;
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const adapter = new OpenAiCompatAdapter(endpoint, this.resolveKey(endpoint.apiKeyEnv));
        const { content, tokensUsed } = await adapter.chatComplete(system, user);
        return {
          providerId: endpoint.id,
          model: endpoint.model,
          content,
          latencyMs: Date.now() - started,
          tokensUsed,
        };
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRequestError && !err.retryable) break;
      }
    }
    throw lastError ?? new Error("No chat providers configured");
  }

  primaryEmbeddingModelId(): string {
    const [first] = getOrderedEndpoints(this.config, "embeddings");
    if (!first) throw new Error("No enabled embedding provider");
    return `${first.id}:${first.model}`;
  }

  private resolveKey(apiKeyEnv: string | null): string | null {
    if (!apiKeyEnv) return null;
    return this.env[apiKeyEnv] ?? null;
  }
}
