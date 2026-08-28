import { describe, expect, it } from "vitest";
import {
  formatChangedPathsSummary,
  formatDiffSummary,
  touchedPathsFromRawJson,
} from "../src/lib/commit-paths.js";

describe("formatChangedPathsSummary", () => {
  it("returns undefined for empty", () => {
    expect(formatChangedPathsSummary([])).toBeUndefined();
  });

  it("lists paths and truncates", () => {
    const paths = Array.from({ length: 42 }, (_, i) => `src/f${i}.ts`);
    const summary = formatChangedPathsSummary(paths, 40)!;
    expect(summary).toContain("src/f0.ts");
    expect(summary).toContain("…and 2 more");
    expect(summary).toContain("do not invent paths");
  });
});

describe("formatDiffSummary", () => {
  it("combines paths and stat", () => {
    const summary = formatDiffSummary({
      paths: ["a.ts"],
      stat: " a.ts | 2 ++",
    });
    expect(summary).toContain("a.ts");
    expect(summary).toContain("Diff stat:");
  });
});

describe("touchedPathsFromRawJson", () => {
  it("reads touchedPaths array", () => {
    expect(touchedPathsFromRawJson({ touchedPaths: ["x.ts", "x.ts", ""] })).toEqual(["x.ts"]);
  });

  it("returns empty for missing", () => {
    expect(touchedPathsFromRawJson(null)).toEqual([]);
    expect(touchedPathsFromRawJson({})).toEqual([]);
  });
});
