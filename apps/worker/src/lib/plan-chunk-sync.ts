export type ExistingChunkRef = {
  id: string;
  contentHash: string;
  qdrantPointId: string | null;
};

export type NewChunkCandidate = {
  contentHash: string;
  /** Opaque payload the caller persists when inserting. */
  draft: unknown;
};

export type ChunkSyncPlan<T> = {
  /** Existing rows to delete (hash no longer present). */
  deleteIds: string[];
  deleteQdrantIds: string[];
  /** New chunks to insert + embed. */
  toInsert: T[];
  /** True when every new hash already existed — nothing to embed. */
  unchanged: boolean;
};

/**
 * Hash-diff plan: keep vectors whose contentHash still exists; re-embed only new hashes.
 * Matching is by contentHash multiset (order-independent).
 */
export function planChunkSync<T extends { contentHash: string }>(
  existing: ExistingChunkRef[],
  incoming: T[],
): ChunkSyncPlan<T> {
  const remaining = new Map<string, ExistingChunkRef[]>();
  for (const row of existing) {
    const list = remaining.get(row.contentHash) ?? [];
    list.push(row);
    remaining.set(row.contentHash, list);
  }

  const toInsert: T[] = [];
  for (const chunk of incoming) {
    const list = remaining.get(chunk.contentHash);
    if (list && list.length > 0) {
      list.shift();
      if (list.length === 0) remaining.delete(chunk.contentHash);
      else remaining.set(chunk.contentHash, list);
      continue;
    }
    toInsert.push(chunk);
  }

  const leftovers = [...remaining.values()].flat();
  return {
    deleteIds: leftovers.map((r) => r.id),
    deleteQdrantIds: leftovers
      .map((r) => r.qdrantPointId ?? r.id)
      .filter((id): id is string => Boolean(id)),
    toInsert,
    unchanged: toInsert.length === 0 && leftovers.length === 0,
  };
}
