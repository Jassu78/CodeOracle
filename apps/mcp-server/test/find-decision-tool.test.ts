import { describe, expect, it, vi } from "vitest";
import {
  formatFindDecisionText,
  runFindDecisionTool,
} from "../src/tools/find-decision.js";

describe("runFindDecisionTool", () => {
  it("validates input and returns contract-shaped output", async () => {
    const runner = vi.fn(async () => ({
      results: [
        {
          topic: "Postgres sessions",
          summary: "Shared state across workers.",
          alternativesConsidered: ["Redis"],
          sourceUrl: "https://github.com/org/repo/pull/1",
          confidence: 0.9,
          retrievalScore: 0.42,
          superseded: false,
        },
      ],
    }));

    const out = await runFindDecisionTool(runner, {
      topic: "session store",
      includeHistory: false,
    });

    expect(runner).toHaveBeenCalledWith({ topic: "session store", includeHistory: false });
    expect(out.results[0]?.sourceUrl).toContain("github.com");
  });

  it("rejects empty topic", async () => {
    await expect(runFindDecisionTool(async () => ({ results: [] }), { topic: "" })).rejects.toThrow();
  });

  it("rejects runner output missing citation", async () => {
    await expect(
      runFindDecisionTool(
        async () =>
          ({
            results: [
              {
                topic: "X",
                summary: "Y",
                alternativesConsidered: [],
                sourceUrl: "",
                confidence: 0.5,
                superseded: false,
              },
            ],
          }) as never,
        { topic: "x" },
      ),
    ).rejects.toThrow();
  });
});

describe("formatFindDecisionText", () => {
  it("renders empty and non-empty result sets", () => {
    expect(formatFindDecisionText({ results: [] })).toMatch(/No decisions matched/);
    const text = formatFindDecisionText({
      results: [
        {
          topic: "Queues",
          summary: "BullMQ for retries.",
          alternativesConsidered: ["SQS"],
          sourceUrl: "https://github.com/org/repo/pull/2",
          confidence: 0.8,
          retrievalScore: 0.31,
          superseded: false,
        },
      ],
    });
    expect(text).toContain("Queues");
    expect(text).toContain("retrievalScore=");
    expect(text).toContain("https://github.com/org/repo/pull/2");
  });
});
