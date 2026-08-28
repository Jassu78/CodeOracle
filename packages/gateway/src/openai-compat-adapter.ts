import type { OpenAiCompatEndpoint } from "@codeoracle/contracts";

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export class OpenAiCompatAdapter {
  constructor(
    private readonly endpoint: OpenAiCompatEndpoint,
    private readonly apiKey: string | null,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.endpoint.baseUrl.replace(/\/$/, "")}/embeddings`;
    const res = await this.post(url, { model: this.endpoint.model, input: texts });
    const data = res.data as Array<{ embedding: number[] }>;
    return data.map((row) => row.embedding);
  }

  async chatComplete(system: string, user: string): Promise<{ content: string; tokensUsed: number }> {
    const url = `${this.endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await this.post(url, {
      model: this.endpoint.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = (res.choices as Array<{ message: { content: string } }>)[0]?.message?.content ?? "";
    const tokensUsed = (res.usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0;
    return { content, tokensUsed };
  }

  private async post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderRequestError(
        `Provider ${this.endpoint.id} HTTP ${res.status}: ${text.slice(0, 300)}`,
        res.status,
        retryable,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
