import { describe, expect, it, vi } from "vitest";
import {
  formatSearchCodebaseText,
  runSearchCodebaseTool,
} from "../src/tools/search-codebase.js";

describe("runSearchCodebaseTool", () => {
  it("validates input and returns contract-shaped output", async () => {
    const runner = vi.fn(async () => ({
      results: [
        {
          chunkId: "11111111-1111-4111-8111-111111111111",
          filePath: "src/auth.ts",
          symbolName: "login",
          content: "export function login() {}",
          score: 0.88,
          repoId: "9462ddb7-6064-4620-87c7-584566f643af",
        },
      ],
    }));

    const out = await runSearchCodebaseTool(runner, { query: "auth", topK: 5 });
    expect(runner).toHaveBeenCalledWith({ query: "auth", topK: 5 });
    expect(out.results[0]?.filePath).toBe("src/auth.ts");
  });

  it("rejects empty query", async () => {
    await expect(runSearchCodebaseTool(async () => ({ results: [] }), { query: "" })).rejects.toThrow();
  });

  it("rejects runner output missing filePath", async () => {
    await expect(
      runSearchCodebaseTool(
        async () =>
          ({
            results: [
              {
                chunkId: "11111111-1111-4111-8111-111111111111",
                filePath: "",
                symbolName: null,
                content: "x",
                score: 0.5,
                repoId: "9462ddb7-6064-4620-87c7-584566f643af",
              },
            ],
          }) as never,
        { query: "x" },
      ),
    ).rejects.toThrow();
  });
});

describe("formatSearchCodebaseText", () => {
  it("renders empty and non-empty", () => {
    expect(formatSearchCodebaseText({ results: [] })).toMatch(/No code chunks/);
    const text = formatSearchCodebaseText({
      results: [
        {
          chunkId: "11111111-1111-4111-8111-111111111111",
          filePath: "a.ts",
          symbolName: null,
          content: "hello world",
          score: 0.5,
          repoId: "9462ddb7-6064-4620-87c7-584566f643af",
        },
      ],
    });
    expect(text).toContain("a.ts");
  });
});
