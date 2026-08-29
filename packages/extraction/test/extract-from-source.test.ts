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
    expect(result.repaired).toBe(false);
    expect(result.redactionHits.some((h) => h.name === "github_pat")).toBe(true);
  });

  it("repairs once when first completion is invalid JSON (G3.20)", async () => {
    let calls = 0;
    const gateway = {
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            providerId: "test-chat",
            model: "test-model",
            content: "not json at all",
            latencyMs: 5,
            tokensUsed: 10,
          };
        }
        return {
          providerId: "test-chat",
          model: "test-model",
          content: JSON.stringify({
            decisions: [
              {
                topic: "Use Postgres",
                summary: "Need ACID for job history.",
                alternativesConsidered: ["SQLite"],
                confidence: 0.9,
                touchedPaths: [],
              },
            ],
          }),
          latencyMs: 5,
          tokensUsed: 20,
        };
      },
    };

    const result = await extractDecisionsFromSource({
      gateway,
      source: {
        sourceType: "commit",
        title: "db",
        body: "Chose Postgres over SQLite for concurrent workers.",
        sourceUrl: "https://github.com/org/repo/commit/abc",
        sourceSha: "abc",
        decidedAtIso: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(calls).toBe(2);
    expect(result.repaired).toBe(true);
    expect(result.batch.decisions[0]!.alternativesConsidered).toContain("SQLite");
    expect(result.tokensUsed).toBe(30);
  });
});
