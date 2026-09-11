/**
 * Absolute top-score floor — empty the list when even the best hit is too weak.
 *
 * Complements relative floors (which only compare to the top hit). Failure class
 * P0-B: nonsense / xyzzy queries still return sticky mid-score hits because a
 * relative floor happily keeps "everything near a mediocre top".
 *
 * Hits must already be sorted best → worst for `applyAbsoluteTopScoreFloor`.
 */

export type AbsoluteTopScoreFloorOpts = {
  /** If top score is strictly below this, return []. */
  absoluteMin: number;
};

/**
 * Search **evidence** floor (dense cosine), not fused RRF rank score.
 * Aligns with the dense channel `scoreThreshold` default (0.35). Hybrid
 * sparse-only tips have evidence 0 and correctly empty under this floor.
 */
export const SEARCH_ABSOLUTE_SCORE_FLOOR = 0.35;

/**
 * Decision topic cosine scores. Black-box xyzzy sticky tip was ~0.55;
 * in-domain tips after Q2 are typically higher. Floor clears mediocre stickiness.
 */
export const DECISION_ABSOLUTE_SCORE_FLOOR = 0.58;

export function applyAbsoluteTopScoreFloor<T extends { score: number }>(
  hits: T[],
  opts: AbsoluteTopScoreFloorOpts,
): T[] {
  if (hits.length === 0) return [];
  const absoluteMin = opts.absoluteMin;
  if (!(absoluteMin > 0)) return hits;
  if (hits[0]!.score < absoluteMin) return [];
  return hits;
}

/**
 * Best score across hits (unsorted OK). Used when ranking score (e.g. RRF)
 * must not be confused with cosine evidence for the absolute floor.
 */
export function bestScore(hits: Array<{ score: number }>): number {
  if (hits.length === 0) return 0;
  let best = hits[0]!.score;
  for (let i = 1; i < hits.length; i += 1) {
    const s = hits[i]!.score;
    if (s > best) best = s;
  }
  return best;
}
