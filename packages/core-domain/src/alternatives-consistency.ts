/**
 * Q3 — alternatives consistency policy (domain rules).
 *
 * Empty alternatives are valid when the source names no option.
 * Empty alternatives are invalid when the same extraction already
 * asserts a contrast (in source title/body or in the decision summary).
 *
 * This does NOT invent alternatives. Callers must repair or drop.
 */

/** Cue phrases that usually mark a rejected / non-chosen option. */
const CONTRAST_CUE_PATTERNS: RegExp[] = [
  /\brather\s+than\b/i,
  /\binstead\s+of\b/i,
  /\bas\s+opposed\s+to\b/i,
  /\bin\s+preference\s+to\b/i,
  /\bchose\b[\s\S]{0,80}\bover\b/i,
  /\bpicked\b[\s\S]{0,80}\bover\b/i,
  /\bprefer(?:red|ring)?\b[\s\S]{0,80}\bover\b/i,
  /\brejected\b/i,
  /\bversus\b/i,
  // Word-boundary "vs" / "vs." — avoid matching inside words.
  /(?:^|[^\w])vs\.?(?:$|[^\w])/i,
  /\bnot\s+using\b/i,
];

export function textHasContrastCue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return CONTRAST_CUE_PATTERNS.some((re) => re.test(t));
}

export function hasNonEmptyAlternatives(alternatives: readonly string[]): boolean {
  return alternatives.some((a) => a.trim().length > 0);
}

export type AlternativesConsistencyInput = {
  summary: string;
  alternativesConsidered: readonly string[];
  /** Prefer grounding checks on the git source, not only model prose. */
  sourceTitle?: string;
  sourceBody?: string;
};

/**
 * True when alternatives are empty but contrast is asserted in source
 * and/or summary — structured field disagrees with available text.
 */
export function isAlternativesInconsistent(input: AlternativesConsistencyInput): boolean {
  if (hasNonEmptyAlternatives(input.alternativesConsidered)) return false;

  const sourceBlob = [input.sourceTitle ?? "", input.sourceBody ?? ""].join("\n");
  if (textHasContrastCue(sourceBlob)) return true;
  if (textHasContrastCue(input.summary)) return true;
  return false;
}

export type AlternativesQualityBucket =
  | "filled"
  | "inconsistent"
  | "true_empty";

/**
 * Ops / CLI taxonomy for stored decisions (no invent, no fill).
 * - filled: has at least one non-empty alternative
 * - inconsistent: empty alts but contrast cue in source and/or summary
 * - true_empty: empty alts and no contrast cue (honest empty or weak source)
 */
export function classifyAlternativesQuality(
  input: AlternativesConsistencyInput,
): AlternativesQualityBucket {
  if (hasNonEmptyAlternatives(input.alternativesConsidered)) return "filled";
  if (isAlternativesInconsistent(input)) return "inconsistent";
  return "true_empty";
}
