import { isCitationUrl } from "@codeoracle/core-domain";
import type { ReplayFindCase, ReplaySearchCase } from "./suite.js";

export type SearchHitLike = { filePath: string; symbolName?: string | null };
export type FindHitLike = { topic: string; summary: string; sourceUrl: string };

export type CaseScore = {
  id: string;
  tool: "search_codebase" | "find_decision";
  gate: "hard" | "soft";
  passed: boolean;
  detail: string;
};

function hitMatchesNeedle(hit: SearchHitLike, needle: string): boolean {
  const n = needle.toLowerCase();
  if (hit.filePath.toLowerCase().includes(n)) return true;
  const sym = hit.symbolName?.toLowerCase() ?? "";
  return sym.length > 0 && sym.includes(n);
}

/**
 * hit@K with path **or symbol** substring match — portable across repo layouts
 * (unlike fixture goldens which use exact relative paths). Symbols matter for
 * NL “where do we authorize…” when the verb lives in the identifier, not the filename.
 */
export function scoreReplaySearch(
  results: SearchHitLike[],
  expect: ReplaySearchCase["expect"],
): { passed: boolean; detail: string } {
  if (expect.expectEmpty) {
    return {
      passed: results.length === 0,
      detail:
        results.length === 0
          ? "empty as expected (garbage / no-match class)"
          : `expected empty, got ${results.length} hit(s)`,
    };
  }

  const hitAt = expect.hitAt;
  const top = results.slice(0, hitAt);
  const labels = top.map((r) =>
    r.symbolName ? `${r.filePath}::${r.symbolName}` : r.filePath,
  );
  const matched = expect.anyOfPathIncludes.find((want) =>
    top.some((h) => hitMatchesNeedle(h, want)),
  );
  return {
    passed: Boolean(matched),
    detail: matched
      ? `hit@${hitAt}: path/symbol contains "${matched}" in [${labels.join(", ") || "(empty)"}]`
      : `miss@${hitAt}: wanted path/symbol containing one of [${expect.anyOfPathIncludes.join(", ")}], got [${labels.join(", ") || "(empty)"}]`,
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
