/**
 * Local sparse encoder for hybrid search (BM25-style bag-of-tokens).
 * Stable FNV-1a → index; values = raw term frequency.
 * Qdrant `modifier: idf` applies IDF at query time when configured.
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

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]+|[0-9]+/g;

export function tokenizeForSparse(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE);
  return matches ?? [];
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
