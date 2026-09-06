/**
 * Reciprocal Rank Fusion + post-fusion cutoff for hybrid (dense + sparse) search.
 *
 * RRF fused ranks are not cosine similarities — `scoreThreshold` on the dense
 * channel still applies at prefetch time; this module drops weak fused ranks
 * after merge so hybrid results don't silently ignore a relevance floor.
 *
 * When `minChannels` is 2 (hybrid default):
 * - **Primary band:** dual-channel hits above the dual relative floor, plus
 *   dense-only hits that clear that same floor (strong dense-only), merged by
 *   RRF score. Dual count in the head is capped (`dualChannelPrimaryCap`) so
 *   prose agreement cannot fill every slot.
 * - **Backfill:** remaining dense-only → weak dual → sparse-only (Q1).
 *
 * Strong dense-only must compete in the primary band: otherwise a mid dual
 * (lower RRF than a dense-#1/#2 impl) occupies head slots and NL authorize
 * queries miss hit@3 (Q1 R4 gold class).
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
   * - Dual-channel + strong dense-only primary band: vs **dual-channel** top × relativeFloor
   * - Single-channel backfill: vs **max single-channel RRF** `1/(RRF_K+1)` × relativeFloor
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
 * Backfill priority (candidates are never strong dual — those are head/deferred):
 * dense-only → weak dual (missed primary floor) → sparse-only; then score desc; then id.
 *
 * Dense-only before weak dual: NL “where is X implemented?” often puts prose on
 * both channels weakly while the true impl is dense-strong / sparse-miss. Letting
 * weak dual docs beat dense-only code recreates docs-only top-K (Q1 R1 class).
 */
function compareBackfill(a: FusedHit, b: FusedHit): number {
  const rank = (h: FusedHit) =>
    isDenseOnly(h) ? 0 : isDualChannel(h) ? 1 : isSparseOnly(h) ? 2 : 3;
  return rank(a) - rank(b) || b.score - a.score || a.id.localeCompare(b.id);
}

function compareByScore(a: FusedHit, b: FusedHit): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

/** Max dual-channel share in the primary head so docs cannot own all of top-K. */
export function dualChannelPrimaryCap(limit: number): number {
  return Math.max(1, Math.floor(limit / 2));
}

/**
 * Post-fusion relevance floor: channel agreement + drop bottom ranks, then cap.
 * Primary band = strong duals ∪ strong dense-only (both ≥ dualFloor), by score,
 * with a cap on dual count; then backfill remaining slots.
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
    const topScore = hits[0]!.score;
    const floor = topScore * relativeFloor;
    return hits.filter((h) => h.score >= floor).slice(0, opts.limit);
  }

  const dualTop = dual[0]!.score;
  const dualFloor = dualTop * relativeFloor;
  const strongDual = dual.filter((h) => h.score >= dualFloor);
  const strongDenseOnly = hits.filter((h) => isDenseOnly(h) && h.score >= dualFloor);

  if (!backfill) {
    return strongDual.slice(0, opts.limit);
  }

  const dualCap = dualChannelPrimaryCap(opts.limit);
  const primaryBand = [...strongDual, ...strongDenseOnly].sort(compareByScore);

  const head: FusedHit[] = [];
  let dualsInHead = 0;
  for (const h of primaryBand) {
    if (head.length >= opts.limit) break;
    if (isDualChannel(h)) {
      if (dualsInHead >= dualCap) continue;
      dualsInHead += 1;
    }
    head.push(h);
  }

  const taken = new Set(head.map((h) => h.id));
  // Strong duals not seated (dual cap) — restore only if backfill cannot fill.
  const deferredStrongDual = new Set(
    strongDual.filter((h) => !taken.has(h.id)).map((h) => h.id),
  );

  const singleChannelCap = 1 / (RRF_K + 1);
  const backfillFloor = singleChannelCap * relativeFloor;

  const candidates = hits
    .filter((h) => !taken.has(h.id) && !deferredStrongDual.has(h.id))
    .filter((h) => (isDualChannel(h) ? true : h.score >= backfillFloor))
    .sort(compareBackfill);

  const out = [...head];
  for (const h of candidates) {
    if (out.length >= opts.limit) break;
    out.push(h);
  }

  if (out.length < opts.limit) {
    for (const h of strongDual) {
      if (out.length >= opts.limit) break;
      if (taken.has(h.id)) continue;
      if (out.some((x) => x.id === h.id)) continue;
      out.push(h);
    }
  }

  return out;
}
