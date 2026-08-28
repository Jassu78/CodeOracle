import { describe, expect, it } from "vitest";
import { FindDecisionResultSchema, SearchCodebaseResultItemSchema } from "./mcp.js";

describe("MCP output contracts enforce mandatory citations", () => {
  it("FindDecisionResult requires a valid sourceUrl", () => {
    expect(() =>
      FindDecisionResultSchema.parse({
        topic: "why redis for rate limits",
        summary: "chose redis for TTL semantics",
        alternativesConsidered: [],
        confidence: 0.8,
        superseded: false,
        // sourceUrl intentionally omitted
      }),
    ).toThrow();
  });

  it("SearchCodebaseResultItem requires a filePath", () => {
    expect(() =>
      SearchCodebaseResultItemSchema.parse({
        chunkId: "3f2c1a4b-1234-5678-abcd-ef0123456789",
        symbolName: "hashPassword",
        content: "function hashPassword() {}",
        score: 0.95,
        repoId: "3f2c1a4b-1234-5678-abcd-ef0123456780",
        // filePath intentionally omitted
      }),
    ).toThrow();
  });
});
