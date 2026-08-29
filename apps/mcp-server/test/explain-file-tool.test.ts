import { describe, expect, it, vi } from "vitest";
import { formatExplainFileText, runExplainFileTool } from "../src/tools/explain-file.js";

describe("runExplainFileTool", () => {
  it("validates input and returns contract-shaped output", async () => {
    const runner = vi.fn(async () => ({
      path: "src/main.ts",
      chunkSummaries: ["[0-10] boot"],
      relatedDecisions: [
        {
          topic: "Framework",
          summary: "Express",
          sourceUrl: "https://github.com/org/repo/pull/1",
          decidedAt: "2026-01-01T00:00:00.000Z",
          superseded: false,
        },
      ],
    }));

    const out = await runExplainFileTool(runner, { path: "src/main.ts" });
    expect(runner).toHaveBeenCalledWith({ path: "src/main.ts" });
    expect(out.relatedDecisions[0]?.sourceUrl).toContain("github.com");
  });

  it("rejects empty path", async () => {
    await expect(
      runExplainFileTool(async () => ({ path: "x", chunkSummaries: [], relatedDecisions: [] }), {
        path: "",
      }),
    ).rejects.toThrow();
  });
});

describe("formatExplainFileText", () => {
  it("renders chunks and decisions", () => {
    const text = formatExplainFileText({
      path: "a.ts",
      chunkSummaries: ["chunk one"],
      relatedDecisions: [],
    });
    expect(text).toContain("File: a.ts");
    expect(text).toContain("chunk one");
    expect(text).toContain("No related decisions");
  });
});
