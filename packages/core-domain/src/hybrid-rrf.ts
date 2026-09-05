/**
 * Reciprocal Rank Fusion + post-fusion cutoff for hybrid (dense + sparse) search.
 *
 * RRF fused ranks are not cosine similarities — `scoreThreshold` on the dense
 * channel still applies at prefetch time; this module drops weak fused ranks
 * after merge so hybrid results don't silently ignore a relevance floor.
 *
 * When `minChannels` is 2 (hybrid default), dual-channel hits are preferred
 * but **capped** so prose agreement cannot fill the entire top-K; remaining
 * slots backfill weak dual / dense-only / sparse-only (Q1).
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
   * Minimum number of channels that must have retrieved the id for the
   * *primary* pool.
   * 1 = appear in dense or sparse; 2 = prefer dual-channel, then backfill.
   * If dual-channel filtering empties the list, falls back to single-channel
   * so a sparse-only or dense-only corpus still returns something.
   */
  minChannels?: number;
  /**
   * Drop hits whose RRF score is below `topScore * relativeFloor`.
   * Default 0.5 — cuts the long tail of single-channel bottom ranks.
   *
   * Floors (when minChannels ≥ 2 with backfill):
   * - Dual-channel primary pool: vs **dual-channel** top score
   * - Single-channel backfill: vs **max single-channel RRF** `1/(RRF_K+1)` × relativeFloor
     (not vs global top — dual-channel scores are ~2× single-channel)
   * - Weak dual (failed primary floor): eligible for backfill with no extra floor
   */
  relativeFloor?: number;
  /**
   * When minChannels ≥ 2 and dual-channel hits exist but leave slots free,
   * append weak dual / dense-only / sparse-only.
   * Default true. Set false to restore pre-Q1 “dual-only when non-empty” behavior.
   */
  backfillSingleChannel?: boolean;
};

function isDualChannel(h: FusedHit): boolean {
  return h.channels.length >= 2;
}

function isDenseOnly(h: FusedHit): boolean {
  return h.channels.length === 1 && h.channels[0] === "dense";
}

function isSparseOnly(h: FusedHit): boolean {
  return h.channels.length === 1 && h.channels[0] === "sparse";
}

/**
 * Backfill priority: weak dual (agreement that missed the primary floor) →
 * dense-only → sparse-only; then score desc; then id.
 */
function compareBackfill(a: FusedHit, b: FusedHit): number {
  const rank = (h: FusedHit) =>
    isDualChannel(h) ? 0 : isDenseOnly(h) ? 1 : isSparseOnly(h) ? 2 : 3;
  return rank(a) - rank(b) || b.score - a.score || a.id.localeCompare(b.id);
}

/** Max dual-channel share before backfill so docs cannot own all of top-K. */
export function dualChannelPrimaryCap(limit: number): number {
  return Math.max(1, Math.floor(limit / 2));
}

/**
 * Post-fusion relevance floor: channel agreement + drop bottom ranks, then cap.
 * With minChannels≥2 and backfill (default), dual-channel wins first (capped),
 * then weak dual / dense-only / sparse-only fill remaining slots.
 */
export function applyHybridCutoff(hits: FusedHit[], opts: HybridCutoffOpts): FusedHit[] {
  if (hits.length === 0 || opts.limit <= 0) return [];

  const wantChannels = opts.minChannels ?? 1;
  const relativeFloor = opts.relativeFloor ?? 0.5;
  const backfill = opts.backfillSingleChannel ?? true;

  if (wantChannels <= 1) {
    const topScore = hits[0]!.score;
    const floor = topScore * relativeFloor;
    return hits.filter((h) => h.score >= floor).slice(0, opts.limit);
  }

  const dual = hits.filter(isDualChannel);
  if (dual.length === 0) {
    // No agreement anywhere — fall back to any channel under global floor.
    const topScore = hits[0]!.score;
    const floor = topScore * relativeFloor;
    return hits.filter((h) => h.score >= floor).slice(0, opts.limit);
  }

  const dualTop = dual[0]!.score;
  const dualFloor = dualTop * relativeFloor;
  const primary = dual.filter((h) => h.score >= dualFloor);

  if (!backfill) {
    return primary.slice(0, opts.limit);
  }

  // Cap dual share so multiple doc chunks that agree on both channels cannot
  // fill every slot before dense-preferred code is considered (Q1 live miss).
  const dualCap = dualChannelPrimaryCap(opts.limit);
  const head = primary.slice(0, Math.min(dualCap, opts.limit));
  const taken = new Set(head.map((h) => h.id));
  // Strong duals beyond the cap are deferred — do not let them re-enter
  // backfill ahead of weak dual / dense-only code.
  const deferredPrimary = new Set(primary.map((h) => h.id));

  // Max RRF for an id seen on exactly one channel at rank 0.
  const singleChannelCap = 1 / (RRF_K + 1);
  const backfillFloor = singleChannelCap * relativeFloor;

  const candidates = hits
    .filter((h) => !taken.has(h.id) && !deferredPrimary.has(h.id))
    .filter((h) => (isDualChannel(h) ? true : h.score >= backfillFloor))
    .sort(compareBackfill);

  const out = [...head];
  for (const h of candidates) {
    if (out.length >= opts.limit) break;
    out.push(h);
  }

  // If backfill could not fill, restore remaining strong dual (capped-out).
  if (out.length < opts.limit) {
    for (const h of primary) {
      if (out.length >= opts.limit) break;
      if (taken.has(h.id)) continue;
      if (out.some((x) => x.id === h.id)) continue;
      out.push(h);
    }
  }

  return out;
}
