/**
 * Reciprocal Rank Fusion + post-fusion cutoff for hybrid (dense + sparse) search.
 *
 * RRF fused ranks are not cosine similarities — `scoreThreshold` on the dense
 * channel still applies at prefetch time; this module drops weak fused ranks
 * after merge so hybrid results don't silently ignore a relevance floor.
 */

export type RetrievalChannel = "dense" | "sparse";

export type ChannelRanking = {
  channel: RetrievalChannel;
  /** Ordered best → worst point ids from one channel. */
  ids: string[];
};

export type FusedHit = {
  id: string;
  /** Sum of 1/(k + rank) across channels that retrieved this id (rank is 0-based). */
  score: number;
  channels: RetrievalChannel[];
};

/** Qdrant-compatible RRF constant (formula: Σ 1/(k + rank)). */
export const RRF_K = 2;

/**
 * Fuse per-channel ranked lists with Reciprocal Rank Fusion.
 * An id that appears in any channel is included (minChannels filter is separate).
 */
export function fuseRrf(rankings: ChannelRanking[], k: number = RRF_K): FusedHit[] {
  const scores = new Map<string, { score: number; channels: Set<RetrievalChannel> }>();

  for (const ranking of rankings) {
    ranking.ids.forEach((id, rank) => {
      const entry = scores.get(id) ?? { score: 0, channels: new Set<RetrievalChannel>() };
      entry.score += 1 / (k + rank + 1);
      entry.channels.add(ranking.channel);
      scores.set(id, entry);
    });
  }

  return [...scores.entries()]
    .map(([id, v]) => ({
      id,
      score: v.score,
      channels: [...v.channels].sort() as RetrievalChannel[],
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export type HybridCutoffOpts = {
  limit: number;
  /**
   * Minimum number of channels that must have retrieved the id.
   * 1 = appear in dense or sparse; 2 = require agreement from both.
   * If dual-channel filtering empties the list, falls back to minChannels=1
   * so a sparse-only or dense-only corpus still returns something.
   */
  minChannels?: number;
  /**
   * Drop hits whose RRF score is below `topScore * relativeFloor`.
   * Default 0.5 — cuts the long tail of single-channel bottom ranks.
   */
  relativeFloor?: number;
};

/**
 * Post-fusion relevance floor: channel agreement + drop bottom ranks, then cap.
 */
export function applyHybridCutoff(hits: FusedHit[], opts: HybridCutoffOpts): FusedHit[] {
  if (hits.length === 0 || opts.limit <= 0) return [];

  const wantChannels = opts.minChannels ?? 1;
  const relativeFloor = opts.relativeFloor ?? 0.5;

  let eligible = hits.filter((h) => h.channels.length >= wantChannels);
  if (eligible.length === 0 && wantChannels > 1) {
    eligible = hits.filter((h) => h.channels.length >= 1);
  }
  if (eligible.length === 0) return [];

  const topScore = eligible[0]!.score;
  const floor = topScore * relativeFloor;
  return eligible.filter((h) => h.score >= floor).slice(0, opts.limit);
}
