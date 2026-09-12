import { describe, expect, it } from "vitest";
import { DecisionSchema, DecisionSourceType } from "./decision.js";

describe("DecisionSchema", () => {
  const valid = {
    id: "3f2c1a4b-1234-5678-abcd-ef0123456789",
    repoId: "3f2c1a4b-1234-5678-abcd-ef0123456780",
    topic: "Database choice: Postgres vs MongoDB",
    summary: "Chose Postgres for ACID guarantees on financial records.",
    alternativesConsidered: ["MongoDB", "DynamoDB"],
    decidedAt: "2026-01-01T00:00:00.000Z",
    sourceType: "pr",
    sourceUrl: "https://github.com/org/repo/pull/42",
    sourceSha: "abc123",
    touchedPaths: ["src/db/index.ts"],
    confidence: 0.9,
    supersededBy: null,
    embeddingModelId: "ollama-embed-local/nomic-embed-text",
    extractionModelId: "gemini-free/gemini-2.0-flash",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a fully-formed decision", () => {
    expect(DecisionSchema.parse(valid)).toMatchObject({ topic: valid.topic });
  });

  it("rejects a decision missing sourceUrl — no citation is a bug, not an edge case", () => {
    const { sourceUrl: _sourceUrl, ...withoutCitation } = valid;
    expect(() => DecisionSchema.parse(withoutCitation)).toThrow();
  });

  it("rejects an invalid sourceType", () => {
    expect(() => DecisionSchema.parse({ ...valid, sourceType: "slack_message" })).toThrow();
  });

  it("accepts all schema-defined source types including doc and review_comment", () => {
    for (const t of DecisionSourceType.options) {
      expect(() => DecisionSchema.parse({ ...valid, sourceType: t })).not.toThrow();
    }
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() => DecisionSchema.parse({ ...valid, confidence: 1.5 })).toThrow();
  });
});
