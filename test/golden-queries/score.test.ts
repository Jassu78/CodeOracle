import { describe, expect, it } from "vitest";
import {
  SEARCH_HIT_AT_K_MIN,
  aggregateEvalScores,
  scoreExplainFile,
  scoreFindDecision,
  scoreSearchHit,
} from "./score.js";

describe("scoreSearchHit", () => {
  it("passes when expected path is in top-K", () => {
    const r = scoreSearchHit(
      [{ filePath: "a.ts" }, { filePath: "cache/memory-cache.ts" }, { filePath: "z.ts" }],
      { anyOfFilePaths: ["cache/memory-cache.ts"], hitAt: 3 },
    );
    expect(r.passed).toBe(true);
  });

  it("fails when expected path is outside hitAt", () => {
    const r = scoreSearchHit(
      [{ filePath: "a.ts" }, { filePath: "b.ts" }, { filePath: "cache/memory-cache.ts" }],
      { anyOfFilePaths: ["cache/memory-cache.ts"], hitAt: 2 },
    );
    expect(r.passed).toBe(false);
  });
});

describe("scoreFindDecision", () => {
  it("requires citations and content match", () => {
    const ok = scoreFindDecision(
      [
        {
          topic: "In-memory cache",
          summary: "Use Map instead of Redis for MVP",
          sourceUrl: "https://github.com/org/repo/commit/abc123",
        },
      ],
      { topicOrSummaryIncludes: ["redis", "cache"], sourceUrlIncludes: ["/commit/"] },
    );
    expect(ok.passed).toBe(true);
    expect(ok.citationOk).toBe(true);
    expect(ok.contentOk).toBe(true);
  });

  it("fails empty results and bad citations", () => {
    expect(scoreFindDecision([], { topicOrSummaryIncludes: ["x"] }).citationOk).toBe(false);
    const bad = scoreFindDecision(
      [{ topic: "x", summary: "y", sourceUrl: "local://not-http" }],
      { topicOrSummaryIncludes: ["x"], sourceUrlIncludes: ["/commit/"] },
    );
    expect(bad.citationOk).toBe(false);
    expect(bad.passed).toBe(false);
  });
});

describe("scoreExplainFile", () => {
  it("requires matching path and non-empty body when configured", () => {
    expect(
      scoreExplainFile(
        { path: "a.ts", chunkSummaries: ["hi"], relatedDecisions: [] },
        { path: "a.ts", requireNonEmpty: true },
      ).passed,
    ).toBe(true);
    expect(
      scoreExplainFile(
        { path: "a.ts", chunkSummaries: [], relatedDecisions: [] },
        { path: "a.ts", requireNonEmpty: true },
      ).passed,
    ).toBe(false);
  });
});

describe("aggregateEvalScores", () => {
  it("enforces PRD gates search≥80% and find citation=100%", () => {
    const searchScores = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      tool: "search_codebase" as const,
      passed: i < 4, // 80%
      detail: "",
    }));
    const findScores = [
      { id: "f0", tool: "find_decision" as const, passed: true, detail: "" },
      { id: "f1", tool: "find_decision" as const, passed: false, detail: "" },
    ];
    const agg = aggregateEvalScores([...searchScores, ...findScores], [
      { citationOk: true, contentOk: true },
      { citationOk: true, contentOk: false },
    ]);
    expect(agg.searchHitAtKRate).toBeGreaterThanOrEqual(SEARCH_HIT_AT_K_MIN);
    expect(agg.findCitationRate).toBe(1);
    expect(agg.passed).toBe(true);

    const failCite = aggregateEvalScores(findScores, [
      { citationOk: true, contentOk: true },
      { citationOk: false, contentOk: true },
    ]);
    expect(failCite.passed).toBe(false);
  });
});
