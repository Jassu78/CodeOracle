import { describe, expect, it } from "vitest";
import { extractDecisionsFromSource } from "../src/extract-from-source.js";

describe("extractDecisionsFromSource", () => {
  it("redacts, calls gateway, and parses batch", async () => {
    const gateway = {
      complete: async () => ({
        providerId: "test-chat",
        model: "test-model",
        content: JSON.stringify({
          decisions: [
            {
              topic: "Pick BullMQ",
              summary: "Need Redis-backed retries for indexing jobs.",
              alternativesConsidered: ["SQS"],
              confidence: 0.85,
              touchedPaths: ["packages/queue"],
            },
          ],
        }),
        latencyMs: 10,
        tokensUsed: 100,
      }),
    };

    const result = await extractDecisionsFromSource({
      gateway,
      source: {
        sourceType: "pr",
        title: "Add queue",
        body: "We chose BullMQ over SQS because ghp_shouldNotReachModel12345678901234567890",
        sourceUrl: "https://github.com/org/repo/pull/1",
        sourceSha: "abc123",
        decidedAtIso: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(result.batch.decisions).toHaveLength(1);
    expect(result.providerId).toBe("test-chat");
    expect(result.redactionHits.some((h) => h.name === "github_pat")).toBe(true);
  });
});
