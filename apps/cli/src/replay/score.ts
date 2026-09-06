import { isCitationUrl } from "@codeoracle/core-domain";
import type { ReplayFindCase, ReplaySearchCase } from "./suite.js";

export type SearchHitLike = { filePath: string };
export type FindHitLike = { topic: string; summary: string; sourceUrl: string };

export type CaseScore = {
  id: string;
  tool: "search_codebase" | "find_decision";
  gate: "hard" | "soft";
  passed: boolean;
  detail: string;
};

/**
 * hit@K with path **substring** match — portable across repo layouts
 * (unlike fixture goldens which use exact relative paths).
 */
export function scoreReplaySearch(
  results: SearchHitLike[],
  expect: ReplaySearchCase["expect"],
): { passed: boolean; detail: string } {
  const hitAt = expect.hitAt;
  const top = results.slice(0, hitAt);
  const paths = top.map((r) => r.filePath);
  const matched = expect.anyOfPathIncludes.find((want) =>
    paths.some((p) => p.includes(want)),
  );
  return {
    passed: Boolean(matched),
    detail: matched
      ? `hit@${hitAt}: path contains "${matched}" in [${paths.join(", ") || "(empty)"}]`
      : `miss@${hitAt}: wanted path containing one of [${expect.anyOfPathIncludes.join(", ")}], got [${paths.join(", ") || "(empty)"}]`,
  };
}

export function scoreReplayFind(
  results: FindHitLike[],
  expect: ReplayFindCase["expect"],
): { passed: boolean; detail: string } {
  if (results.length === 0) {
    return { passed: false, detail: "no results" };
  }

  if (expect.maxCount !== undefined && results.length > expect.maxCount) {
    return {
      passed: false,
      detail: `maxCount exceeded: got ${results.length}, want ≤ ${expect.maxCount}`,
    };
  }

  if (expect.requireCitationHttp) {
    const bad = results.filter((r) => !isCitationUrl(r.sourceUrl));
    if (bad.length > 0) {
      return {
        passed: false,
        detail: `non-http citation(s): ${bad.map((b) => b.sourceUrl).join("; ")}`,
      };
    }
  }

  const needles = expect.topicOrSummaryIncludesAny.map((s) => s.toLowerCase());
  const contentOk = results.some((r) => {
    const blob = `${r.topic}\n${r.summary}`.toLowerCase();
    return needles.some((n) => blob.includes(n));
  });

  if (!contentOk) {
    return {
      passed: false,
      detail: `content miss — none of [${expect.topicOrSummaryIncludesAny.join(", ")}] in ${results.length} result(s)`,
    };
  }

  const parts = [
    `count=${results.length}`,
    expect.maxCount !== undefined ? `maxCount≤${expect.maxCount}` : null,
    "content ok",
    expect.requireCitationHttp ? "citations http" : null,
  ].filter(Boolean);
  return { passed: true, detail: parts.join("; ") };
}
