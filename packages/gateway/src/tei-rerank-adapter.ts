import type { RerankEndpoint } from "@codeoracle/contracts";
import { ProviderRequestError } from "./openai-compat-adapter.js";

export type TeiRerankCandidate = {
  id: string;
  text: string;
};

export type TeiRerankHit = {
  id: string;
  score: number;
};

/**
 * Hugging Face Text Embeddings Inference (TEI) `POST /rerank`.
 * Not OpenAI-compat — intentional exception for E2.1 cross-encoder.
 *
 * AbortSignal must come from the caller (≤ SEARCH_RERANK_TIMEOUT_MS). Do not
 * use the chat/embed 90s default; outer withTimeout does not cancel fetch.
 */
export class TeiRerankAdapter {
  constructor(
    private readonly endpoint: RerankEndpoint,
    private readonly apiKey: string | null,
  ) {}

  async rerank(
    query: string,
    candidates: TeiRerankCandidate[],
    signal: AbortSignal,
  ): Promise<TeiRerankHit[]> {
    if (candidates.length === 0) return [];

    const url = `${this.endpoint.baseUrl.replace(/\/$/, "")}/rerank`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          texts: candidates.map((c) => c.text),
          truncate: true,
        }),
        signal,
      });
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" ||
          err.name === "AbortError" ||
          /aborted|timeout/i.test(err.message));
      if (timedOut) {
        // No response body / query echo — status-only message for usage logs.
        throw new ProviderRequestError(
          `Provider ${this.endpoint.id} timed out or aborted`,
          408,
          true,
        );
      }
      throw err;
    }

    if (!res.ok) {
      // Drain body without attaching it to the error (may contain query/passage).
      await res.text().catch(() => undefined);
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderRequestError(
        `Provider ${this.endpoint.id} HTTP ${res.status}`,
        res.status,
        retryable,
      );
    }

    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) {
      throw new ProviderRequestError(
        `Provider ${this.endpoint.id} returned non-array rerank payload`,
        502,
        true,
      );
    }

    const out: TeiRerankHit[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const index = (row as { index?: unknown }).index;
      const score = (row as { score?: unknown }).score;
      if (typeof index !== "number" || !Number.isInteger(index)) continue;
      if (index < 0 || index >= candidates.length) continue;
      if (typeof score !== "number" || !Number.isFinite(score)) continue;
      const id = candidates[index]!.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, score });
    }

    // Prefer TEI's score order when present; otherwise keep mapping order.
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}
