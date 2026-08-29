import { isCitationUrl } from "@codeoracle/core-domain";
import type {
  GoldenExplainFileExpectation,
  GoldenFindDecisionExpectation,
  GoldenQuery,
  GoldenSearchExpectation,
} from "@codeoracle/contracts";

/** Structural result shapes — scoring never imports Qdrant/DB. */
export type SearchResultLike = { filePath: string };
export type FindDecisionResultLike = {
  topic: string;
  summary: string;
  sourceUrl: string;
};
export type ExplainFileResultLike = {
  path: string;
  chunkSummaries: string[];
  relatedDecisions: unknown[];
};

export type QueryScore = {
  id: string;
  tool: GoldenQuery["tool"];
  passed: boolean;
  detail: string;
};

/**
 * hit@K: at least one expected file path appears in the first `hitAt` results.
 */
export function scoreSearchHit(
  results: SearchResultLike[],
  expect: Pick<GoldenSearchExpectation, "anyOfFilePaths"> & { hitAt?: number },
): { passed: boolean; detail: string } {
  const hitAt = expect.hitAt ?? 3;
  const top = results.slice(0, hitAt);
  const paths = top.map((r) => r.filePath);
  const hit = expect.anyOfFilePaths.some((want) => paths.includes(want));
  return {
    passed: hit,
    detail: hit
      ? `hit@${hitAt}: found ${expect.anyOfFilePaths.find((w) => paths.includes(w))} in [${paths.join(", ")}]`
      : `miss@${hitAt}: wanted one of [${expect.anyOfFilePaths.join(", ")}], got [${paths.join(", ") || "(empty)"}]`,
  };
}

/**
 * find_decision citation correctness (PRD NFR-5 = 100%):
 * - ≥1 result required
 * - every result must be an http(s) citation URL containing each `sourceUrlIncludes` fragment
 * - ≥1 result must match content (any of topicOrSummaryIncludes in topic+summary)
 */
export function scoreFindDecision(
  results: FindDecisionResultLike[],
  expect: Pick<GoldenFindDecisionExpectation, "topicOrSummaryIncludes"> & {
    sourceUrlIncludes?: string[];
  },
): { passed: boolean; citationOk: boolean; contentOk: boolean; detail: string } {
  if (results.length === 0) {
    return {
      passed: false,
      citationOk: false,
      contentOk: false,
      detail: "no results — cannot satisfy citation or content expectations",
    };
  }

  const fragments = expect.sourceUrlIncludes ?? ["/commit/"];
  const citationFailures: string[] = [];
  for (const r of results) {
    if (!isCitationUrl(r.sourceUrl)) {
      citationFailures.push(`${r.sourceUrl} (not http/https)`);
      continue;
    }
    for (const frag of fragments) {
      if (!r.sourceUrl.includes(frag)) {
        citationFailures.push(`${r.sourceUrl} missing "${frag}"`);
      }
    }
  }
  const citationOk = citationFailures.length === 0;

  const needles = expect.topicOrSummaryIncludes.map((s) => s.toLowerCase());
  const contentOk = results.some((r) => {
    const blob = `${r.topic}\n${r.summary}`.toLowerCase();
    return needles.some((n) => blob.includes(n));
  });

  const passed = citationOk && contentOk;
  const detail = [
    citationOk ? "citations ok" : `citation failures: ${citationFailures.join("; ")}`,
    contentOk
      ? `content matched one of [${expect.topicOrSummaryIncludes.join(", ")}]`
      : `content miss — none of [${expect.topicOrSummaryIncludes.join(", ")}] in results`,
  ].join("; ");

  return { passed, citationOk, contentOk, detail };
}

export function scoreExplainFile(
  result: ExplainFileResultLike,
  expect: Pick<GoldenExplainFileExpectation, "path"> & { requireNonEmpty?: boolean },
): { passed: boolean; detail: string } {
  if (result.path !== expect.path) {
    return {
      passed: false,
      detail: `path mismatch: expected ${expect.path}, got ${result.path}`,
    };
  }
  const nonEmpty =
    result.chunkSummaries.some((s) => s.trim().length > 0) || result.relatedDecisions.length > 0;
  if (expect.requireNonEmpty !== false && !nonEmpty) {
    return { passed: false, detail: `explain_file ${expect.path}: empty summaries and decisions` };
  }
  return { passed: true, detail: `explain_file ${expect.path}: non-empty` };
}

export type EvalAggregate = {
  searchTotal: number;
  searchPassed: number;
  /** searchPassed / searchTotal — PRD gate ≥ 0.8 */
  searchHitAtKRate: number;
  findTotal: number;
  findPassed: number;
  /** Fraction of find_decision queries where every returned citation is valid — PRD gate = 1.0 */
  findCitationRate: number;
  findContentPassed: number;
  explainTotal: number;
  explainPassed: number;
  /** True when PRD NFR-5 gates pass. */
  passed: boolean;
  queryScores: QueryScore[];
};

export const SEARCH_HIT_AT_K_MIN = 0.8;
export const FIND_CITATION_MIN = 1.0;

/**
 * Aggregate per-query scores into PRD gates.
 * `findCitationOk` / `findContentOk` are parallel arrays aligned with find_decision queryScores order,
 * or pass richer QueryScore entries via optional side channel — simpler: accept find meta on each score.
 */
export function aggregateEvalScores(
  queryScores: QueryScore[],
  findMeta: Array<{ citationOk: boolean; contentOk: boolean }>,
): EvalAggregate {
  const search = queryScores.filter((q) => q.tool === "search_codebase");
  const find = queryScores.filter((q) => q.tool === "find_decision");
  const explain = queryScores.filter((q) => q.tool === "explain_file");

  if (find.length !== findMeta.length) {
    throw new Error(
      `aggregateEvalScores: find_decision count ${find.length} != findMeta ${findMeta.length}`,
    );
  }

  const searchPassed = search.filter((q) => q.passed).length;
  const searchTotal = search.length;
  const searchHitAtKRate = searchTotal === 0 ? 1 : searchPassed / searchTotal;

  const findCitationOkCount = findMeta.filter((m) => m.citationOk).length;
  const findTotal = find.length;
  const findCitationRate = findTotal === 0 ? 1 : findCitationOkCount / findTotal;
  const findContentPassed = findMeta.filter((m) => m.contentOk).length;
  const findPassed = find.filter((q) => q.passed).length;

  const explainPassed = explain.filter((q) => q.passed).length;
  const explainTotal = explain.length;

  const passed =
    searchHitAtKRate + Number.EPSILON >= SEARCH_HIT_AT_K_MIN &&
    findCitationRate + Number.EPSILON >= FIND_CITATION_MIN;

  return {
    searchTotal,
    searchPassed,
    searchHitAtKRate,
    findTotal,
    findPassed,
    findCitationRate,
    findContentPassed,
    explainTotal,
    explainPassed,
    passed,
    queryScores,
  };
}
