import { describe, expect, it, vi } from "vitest";
import { createCodeOracleMcpServer } from "../src/create-server.js";

describe("createCodeOracleMcpServer", () => {
  it("registers find_decision, search_codebase, and explain_file", () => {
    const server = createCodeOracleMcpServer({
      findDecision: vi.fn(async () => ({ results: [] })),
      searchCodebase: vi.fn(async () => ({ results: [] })),
      explainFile: vi.fn(async () => ({
        path: "x",
        chunkSummaries: [],
        relatedDecisions: [],
      })),
    });
    const tools = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools ?? {}).sort()).toEqual([
      "explain_file",
      "find_decision",
      "search_codebase",
    ]);
  });
});
