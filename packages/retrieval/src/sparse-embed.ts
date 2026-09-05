/**
 * Local sparse encoder for hybrid search (BM25-style bag-of-tokens).
 * Stable FNV-1a → index; values = raw term frequency.
 * Qdrant `modifier: idf` applies IDF at query time when configured.
 *
 * Identifier splitting (Q1): camelCase / snake_case segments are emitted in
 * addition to the raw token so NL queries ("verify github hmac") can overlap
 * symbols like `verifyGitHubSignature`. Indexed vectors only pick this up
 * after a full reindex; query-time benefit applies immediately.
 *
 * Accepted trade-off — hash collisions: two distinct tokens landing on the
 * same 31-bit index silently merge their term frequencies (this is the
 * standard "hashing trick" used by e.g. scikit-learn's HashingVectorizer,
 * not a bug unique to this code). Collision probability for two arbitrary
 * tokens is ~1/2^31 (birthday-bound: for a corpus of N distinct tokens,
 * expected collisions ≈ N²/2^32). At single-repo MVP scale (a few thousand
 * distinct identifiers/words per repo), this is negligible — it would only
 * become worth revisiting (e.g. widen to 61-bit indices split across two
 * hashes, or move to a real sparse model) if/when this runs across many
 * large repos sharing one collection with a much bigger combined vocabulary.
 */
export type SparseVector = {
  indices: number[];
  values: number[];
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
  // (See module doc comment above for the accepted collision trade-off.)
  return hash >>> 0;
}

export function textToSparseVector(text: string): SparseVector {
  const tf = new Map<number, number>();
  for (const token of tokenizeForSparse(text)) {
    if (token.length < 2) continue;
    const index = fnv1a(token);
    tf.set(index, (tf.get(index) ?? 0) + 1);
  }

  const indices = [...tf.keys()].sort((a, b) => a - b);
  const values = indices.map((i) => tf.get(i)!);
  return { indices, values };
}
