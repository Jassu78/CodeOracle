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
