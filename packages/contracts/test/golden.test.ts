import { describe, expect, it } from "vitest";
import { GoldenQuerySetSchema } from "../src/golden.js";

describe("GoldenQuerySetSchema", () => {
  it("accepts a valid 10-query set", () => {
    const queries = Array.from({ length: 10 }, (_, i) => ({
      id: `search-${i}`,
      tool: "search_codebase" as const,
      query: `query ${i}`,
      expect: { anyOfFilePaths: [`file-${i}.ts`], hitAt: 3 },
    }));
    const parsed = GoldenQuerySetSchema.parse({
      version: 1,
      fixture: "test/fixtures/sample-repo",
      description: "unit fixture",
      queries,
    });
    expect(parsed.queries).toHaveLength(10);
  });

  it("rejects fewer than 10 queries", () => {
    expect(() =>
      GoldenQuerySetSchema.parse({
        version: 1,
        fixture: "test/fixtures/sample-repo",
        description: "too small",
        queries: [
          {
            id: "one",
            tool: "search_codebase",
            query: "x",
            expect: { anyOfFilePaths: ["a.ts"], hitAt: 3 },
          },
        ],
      }),
    ).toThrow();
  });

  it("requires citation fragment defaults on find_decision", () => {
    const q = GoldenQuerySetSchema.parse({
      version: 1,
      fixture: "test/fixtures/sample-repo",
      description: "find",
      queries: Array.from({ length: 10 }, (_, i) =>
        i === 0
          ? {
              id: "fd-0",
              tool: "find_decision" as const,
              query: "why cache",
              expect: { topicOrSummaryIncludes: ["cache"] },
            }
          : {
              id: `s-${i}`,
              tool: "search_codebase" as const,
              query: `q${i}`,
              expect: { anyOfFilePaths: ["a.ts"], hitAt: 3 },
            },
      ),
    });
    expect(q.queries[0]).toMatchObject({
      tool: "find_decision",
      expect: { sourceUrlIncludes: ["/commit/"] },
    });
  });
});
