import { describe, expect, it } from "vitest";
import { filterMergedAssociatedPulls } from "../src/lib/sync-merged-pr-at-commit.js";

describe("filterMergedAssociatedPulls", () => {
  it("keeps only pulls with merged_at set", () => {
    const out = filterMergedAssociatedPulls([
      { number: 1, merged_at: "2026-01-01T00:00:00Z" },
      { number: 2, merged_at: null },
      { number: 3, merged_at: undefined },
      { number: 4, merged_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(out.map((p) => p.number)).toEqual([1, 4]);
  });
});
