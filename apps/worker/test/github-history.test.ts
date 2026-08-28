import { describe, expect, it } from "vitest";

/** G2.14 — documents merged-PR filter contract used by crawlGithubHistory. */
function countMergedPulls(
  pulls: Array<{ merged_at: string | null; number: number }>,
): number {
  return pulls.filter((pr) => Boolean(pr.merged_at)).length;
}

describe("github-history merged PR filter", () => {
  it("counts only merged closed PRs", () => {
    const pulls = [
      { number: 1, merged_at: "2026-01-01T00:00:00Z" },
      { number: 2, merged_at: null },
      { number: 3, merged_at: "2026-02-01T00:00:00Z" },
    ];
    expect(countMergedPulls(pulls)).toBe(2);
  });

  it("returns zero when no PRs are merged", () => {
    expect(countMergedPulls([{ number: 9, merged_at: null }])).toBe(0);
  });
});
