import { describe, expect, it } from "vitest";
import { selectSourcesForExtraction } from "../src/lib/queue-extraction-jobs.js";

describe("selectSourcesForExtraction", () => {
  it("queues commits when no PRs exist", () => {
    const result = selectSourcesForExtraction([
      {
        id: "1",
        sourceType: "commit",
        sourceSha: "aaa",
        sourceUrl: "https://example/commit/aaa",
        title: "feat: add queue",
        body: "because we need retries",
      },
      {
        id: "2",
        sourceType: "commit",
        sourceSha: "bbb",
        sourceUrl: "https://example/commit/bbb",
        title: "chore: bump lodash to 4.17.21",
        body: "",
      },
    ]);
    expect(result.skippedTrivial).toBe(1);
    expect(result.selected.map((s) => s.id)).toEqual(["1"]);
    expect(result.skippedCommitCoveredByPr).toBe(0);
  });

  it("prefers PRs and skips commits covered by PR merge SHA", () => {
    const result = selectSourcesForExtraction([
      {
        id: "pr1",
        sourceType: "pr",
        sourceSha: "merge1",
        sourceUrl: "https://example/pull/1",
        title: "feat: use Postgres for sessions",
        body: "instead of memory",
      },
      {
        id: "c1",
        sourceType: "commit",
        sourceSha: "merge1",
        sourceUrl: "https://example/commit/merge1",
        title: "feat: use Postgres for sessions",
        body: "",
      },
      {
        id: "c2",
        sourceType: "commit",
        sourceSha: "other",
        sourceUrl: "https://example/commit/other",
        title: "fix: handle null token",
        body: "",
      },
    ]);
    expect(result.selected.map((s) => s.id)).toEqual(["pr1", "c2"]);
    expect(result.skippedCommitCoveredByPr).toBe(1);
  });
});
