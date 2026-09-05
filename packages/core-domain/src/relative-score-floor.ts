/**
 * Keep hits whose score is within `relativeFloor` of the top score, then cap.
 * Used by `find_decision` so absolute Qdrant thresholds do not return a long
 * tail of adjacent-but-weaker decisions (Q2).
 *
 * Hits must already be sorted best → worst. Does not reorder.
 */
export type ScoredHit = { score: number };

export type RelativeScoreFloorOpts = {
  /** Keep hits with score >= topScore * relativeFloor. Default 0.85. */
  relativeFloor?: number;
  /** Max hits to return after the floor. */
  limit: number;
};

/** Live-tuned default for decision topic search (HMAC bleed vs hybrid near-ties). */
export const DECISION_RELATIVE_SCORE_FLOOR = 0.85;

export function applyRelativeScoreFloor<T extends ScoredHit>(
  hits: T[],
  opts: RelativeScoreFloorOpts,
): T[] {
  if (hits.length === 0 || opts.limit <= 0) return [];

  const relativeFloor = opts.relativeFloor ?? DECISION_RELATIVE_SCORE_FLOOR;
  const topScore = hits[0]!.score;
  if (!(topScore > 0) || !(relativeFloor > 0)) {
    return hits.slice(0, opts.limit);
  }

  const floor = topScore * relativeFloor;
  return hits.filter((h) => h.score >= floor).slice(0, opts.limit);
}

/** Over-fetch so citation/supersede drops and the relative floor can still fill displayLimit. */
export function decisionSearchFetchLimit(displayLimit: number): number {
  return Math.max(displayLimit * 2, 8);
}
