/**
 * Local sparse encoder for hybrid search (BM25 TF + Qdrant IDF).
 *
 * **E3:** Document vectors use BM25 term-frequency saturation + length norm.
 * Query vectors use raw term frequency. Qdrant `modifier: idf` supplies IDF
 * at search time (Okapi-style when combined).
 *
 * Identifier splitting (Q1): camelCase / snake_case segments are emitted in
 * addition to the raw token so NL queries ("verify github hmac") can overlap
 * symbols like `verifyGitHubSignature`. Indexed vectors only pick this up
 * after a full reindex; query-time benefit applies immediately.
 *
 * **Encoder version:** bumping {@link SPARSE_ENCODER_VERSION} changes stored
 * weights. Hybrid collections must be **fully reindexed** after deploy —
 * mixing raw-TF (pre-E3) and BM25-TF points silently degrades ranking.
 *
 * Accepted trade-off — hash collisions: two distinct tokens landing on the
 * same 31-bit index silently merge their term frequencies (hashing trick).
 * At single-repo scale this is negligible.
 */

export type SparseVector = {
  indices: number[];
  values: number[];
};

/**
 * Sparse value formula id stamped on upsert payloads (`sparse_encoder`).
 * Pre-E3 points omit this field (treated as legacy raw TF).
 */
export const SPARSE_ENCODER_VERSION = "bm25-tf-v1";

/** Okapi BM25 defaults (Robertson / Zaragoza). */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
/**
 * Assumed average document length in tokens for code chunks.
 * Not corpus-adaptive (no silent stats drift); good enough until E5/corpus stats.
 */
export const BM25_AVGDL = 180;

export type SparseEncodeRole = "document" | "query";

export type SparseEncodeOpts = {
  /**
   * `document` — BM25 TF saturation (upsert).
   * `query` — raw TF (search); IDF comes from Qdrant.
   * @default "document"
   */
  role?: SparseEncodeRole;
  k1?: number;
  b?: number;
  avgdl?: number;
};

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|[0-9]+/g;

/** Split one identifier into snake + camelCase segments (lowercased, len≥2). */
export function splitIdentifierToken(raw: string): string[] {
  const lowerRaw = raw.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    if (s.length < 2 || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  push(lowerRaw);

  for (const snakePart of raw.split("_")) {
    if (!snakePart) continue;
    const camelParts = snakePart
      .replace(/([a-z0-9])([A-Z])/g, "$1\0$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\0$2")
      .split("\0")
      .filter(Boolean);
    for (const part of camelParts) {
      push(part.toLowerCase());
    }
  }

  return out;
}

export function tokenizeForSparse(text: string): string[] {
  const matches = text.match(TOKEN_RE) ?? [];
  const out: string[] = [];
  // Preserve multiplicity across the text so term frequency stays meaningful.
  // Dedup within a single identifier happens in splitIdentifierToken.
  for (const m of matches) {
    out.push(...splitIdentifierToken(m));
  }
  return out;
}

function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Qdrant sparse indices are non-negative u32-ish; keep positive 31-bit.
  return hash >>> 0;
}

/**
 * Okapi BM25 TF component (no IDF) for one term in a document of length `dl`.
 */
export function bm25TermFrequency(
  tf: number,
  dl: number,
  opts: { k1?: number; b?: number; avgdl?: number } = {},
): number {
  if (!(tf > 0) || !(dl > 0)) return 0;
  const k1 = opts.k1 ?? BM25_K1;
  const b = opts.b ?? BM25_B;
  const avgdl = opts.avgdl ?? BM25_AVGDL;
  const denom = tf + k1 * (1 - b + (b * dl) / avgdl);
  return (tf * (k1 + 1)) / denom;
}

/**
 * Encode text to a Qdrant sparse vector.
 * Use `role: "document"` on upsert and `role: "query"` on search.
 */
export function textToSparseVector(text: string, opts: SparseEncodeOpts = {}): SparseVector {
  const role = opts.role ?? "document";
  const tokens = tokenizeForSparse(text).filter((t) => t.length >= 2);
  const dl = Math.max(tokens.length, 1);

  const tf = new Map<number, number>();
  for (const token of tokens) {
    const index = fnv1a(token);
    tf.set(index, (tf.get(index) ?? 0) + 1);
  }

  const indices = [...tf.keys()].sort((a, b) => a - b);
  const values = indices.map((i) => {
    const termTf = tf.get(i)!;
    if (role === "query") return termTf;
    return bm25TermFrequency(termTf, dl, opts);
  });

  return { indices, values };
}
