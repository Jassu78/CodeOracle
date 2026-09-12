export interface EmbeddingResult {
  providerId: string;
  model: string;
  vectors: number[][];
  latencyMs: number;
}

export interface EmbeddingProviderPort {
  embed(texts: string[]): Promise<EmbeddingResult>;
}

export interface ChatCompletionResult {
  providerId: string;
  model: string;
  content: string;
  latencyMs: number;
  tokensUsed: number;
}

export interface ChatProviderPort {
  complete(system: string, user: string): Promise<ChatCompletionResult>;
}

export interface RerankCandidateInput {
  id: string;
  text: string;
}

export interface RerankHit {
  id: string;
  /** Provider-local relevance — does not replace fused RRF display score. */
  score: number;
}

export interface RerankResult {
  providerId: string;
  model: string;
  results: RerankHit[];
  latencyMs: number;
}

export type RerankOptions = {
  /**
   * Hard abort budget for this call (and sequential failover attempts).
   * Must be ≤ SEARCH_RERANK_TIMEOUT_MS at the app edge — do not use chat's 90s.
   */
  timeoutMs: number;
};

export interface RerankProviderPort {
  rerank(
    query: string,
    candidates: RerankCandidateInput[],
    opts: RerankOptions,
  ): Promise<RerankResult>;
}

export type { ProviderUsageEvent, ProviderUsageLogger } from "@codeoracle/contracts";
