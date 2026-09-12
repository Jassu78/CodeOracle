/** Injected at the app edge — keeps retrieval free of gateway imports. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Optional post-fusion rerank (E2). Gateway-free seam — apps inject a
 * cross-encoder / late-interaction adapter when SEARCH_RERANK_ENABLED and a
 * provider exist. Retrieval never imports gateway.
 */
export type RerankCandidate = {
  id: string;
  text: string;
};

export type RerankResult = {
  id: string;
  /** Provider-local relevance score — does not replace fused result.score. */
  score: number;
};

export type RerankFn = (
  query: string,
  candidates: RerankCandidate[],
) => Promise<RerankResult[]>;

/**
 * Reorder items by rerank results. Unknown ids ignored; missing ids appended
 * in original order. Never drops an item solely because rerank omitted it.
 */
export function applyRerankOrder<T extends { chunkId: string }>(
  items: T[],
  ranked: RerankResult[],
): T[] {
  if (items.length === 0) return items;
  const byId = new Map(items.map((item) => [item.chunkId, item]));
  const seen = new Set<string>();
  const out: T[] = [];

  for (const entry of ranked) {
    if (!entry || typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    out.push(item);
  }

  for (const item of items) {
    if (!seen.has(item.chunkId)) out.push(item);
  }
  return out;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation",
): Promise<T> {
  // Prevent late rejection after timeout from becoming an unhandledRejection.
  const guarded = promise.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      guarded,
      new Promise<{ ok: false; err: Error }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, err: new Error(`${label} timed out after ${timeoutMs}ms`) }),
          timeoutMs,
        );
      }),
    ]);
    if (raced.ok) return raced.value;
    throw raced.err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Citation-worthiness check ("no citation = bug"). Lives in `@codeoracle/
 * core-domain` as a framework-free product rule shared across capability
 * packages; re-exported here under its original name so call sites in this
 * package don't churn.
 */
export { isCitationUrl as isHttpUrl } from "@codeoracle/core-domain";
