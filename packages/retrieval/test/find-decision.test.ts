import { describe, expect, it, vi } from "vitest";
import type { DecisionRow } from "@codeoracle/db";
import { findDecision } from "../src/find-decision.js";

const repoId = "9462ddb7-6064-4620-87c7-584566f643af";
const activeId = "11111111-1111-4111-8111-111111111111";
const supersededId = "22222222-2222-4222-8222-222222222222";
const noCiteId = "33333333-3333-4333-8333-333333333333";
const bleedId = "44444444-4444-4444-8444-444444444444";
const nearTieId = "55555555-5555-4555-8555-555555555555";

function row(partial: Partial<DecisionRow> & Pick<DecisionRow, "id" | "topic" | "summary" | "sourceUrl">): DecisionRow {
  return {
    repoId,
    alternativesConsidered: [],
    decidedAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceType: "pr",
    sourceSha: "abc",
    touchedPaths: [],
    confidence: 0.9,
    supersededBy: null,
    embeddingModelId: "ollama:nomic",
    extractionModelId: "ollama:gpt",
    createdAt: new Date(),
    ...partial,
  };
}

const stubDb = {} as never;
const stubQdrant = {} as never;

describe("findDecision", () => {
  it("rejects empty topic / repoId", async () => {
    await expect(
      findDecision({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[0.1]],
        repoId,
        topic: "   ",
      }),
    ).rejects.toThrow(/topic/);

    await expect(
      findDecision({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[0.1]],
        repoId: "",
        topic: "sessions",
      }),
    ).rejects.toThrow(/repoId/);
  });

  it("rejects empty embedding vectors", async () => {
    await expect(
      findDecision({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[]],
        repoId,
        topic: "sessions",
      }),
    ).rejects.toThrow(/empty vector/);
  });

  it("returns empty results when nothing matches", async () => {
    const out = await findDecision({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1, 0.2]],
      repoId,
      topic: "unknown topic",
      deps: {
        search: async () => [],
        getByIds: async () => [],
      },
    });
    expect(out.results).toEqual([]);
  });

  it("preserves score order, hides superseded by default, drops bad citations", async () => {
    const search = vi.fn(async () => [
      { id: activeId, score: 0.91 },
      { id: supersededId, score: 0.8 },
      { id: noCiteId, score: 0.7 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: activeId,
        topic: "Postgres for sessions",
        summary: "Chose Postgres instead of memory because workers share state.",
        sourceUrl: "https://github.com/org/repo/pull/1",
        alternativesConsidered: ["Redis"],
        confidence: 0.9,
        supersededBy: null,
      }),
      row({
        id: supersededId,
        topic: "Old session store",
        summary: "Used memory initially.",
        sourceUrl: "https://github.com/org/repo/commit/old",
        confidence: 0.7,
        supersededBy: activeId,
      }),
      row({
        id: noCiteId,
        topic: "Broken",
        summary: "No citation",
        sourceUrl: "not-a-url",
        confidence: 0.5,
      }),
    ]);

    const out = await findDecision({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1, 0.2]],
      repoId,
      topic: "session store",
      deps: { search, getByIds },
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      topic: "Postgres for sessions",
      sourceUrl: "https://github.com/org/repo/pull/1",
      superseded: false,
      confidence: 0.9,
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ repoId, scoreThreshold: 0.45, limit: 8 }),
    );
  });

  it("drops far neighbors via relative floor (Q2)", async () => {
    const search = vi.fn(async () => [
      { id: activeId, score: 0.89 },
      { id: bleedId, score: 0.57 },
      { id: nearTieId, score: 0.53 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: activeId,
        topic: "GitHub HMAC webhook verification",
        summary: "Verify raw-body HMAC.",
        sourceUrl: "https://github.com/org/repo/pull/4",
      }),
      row({
        id: bleedId,
        topic: "Preventing Duplicate GitHub Source Records",
        summary: "Unique constraints on sources.",
        sourceUrl: "https://github.com/org/repo/pull/5",
      }),
      row({
        id: nearTieId,
        topic: "Principal-scoped API authentication",
        summary: "Per-repo tokens.",
        sourceUrl: "https://github.com/org/repo/pull/10",
      }),
    ]);

    const out = await findDecision({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      topic: "GitHub webhook HMAC signature verification",
      deps: { search, getByIds },
    });

    expect(out.results.map((r) => r.topic)).toEqual(["GitHub HMAC webhook verification"]);
  });

  it("keeps near-ties within the relative floor band (Q2)", async () => {
    const search = vi.fn(async () => [
      { id: activeId, score: 0.765 },
      { id: nearTieId, score: 0.763 },
      { id: bleedId, score: 0.625 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: activeId,
        topic: "Hybrid dense + sparse RRF search activation",
        summary: "Turn on hybrid.",
        sourceUrl: "https://github.com/org/repo/pull/8",
      }),
      row({
        id: nearTieId,
        topic: "Hybrid Search Result Filtering Strategy",
        summary: "Post-fusion cutoff.",
        sourceUrl: "https://github.com/org/repo/pull/8b",
      }),
      row({
        id: bleedId,
        topic: "Dual-channel RRF hits with dense-only backfill",
        summary: "Q1 backfill.",
        sourceUrl: "https://github.com/org/repo/pull/q1",
      }),
    ]);

    const out = await findDecision({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      topic: "why hybrid RRF search ranking cutoff",
      deps: { search, getByIds },
    });

    expect(out.results.map((r) => r.topic)).toEqual([
      "Hybrid dense + sparse RRF search activation",
      "Hybrid Search Result Filtering Strategy",
    ]);
  });

  it("includes superseded history when includeHistory is true", async () => {
    const out = await findDecision({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      topic: "sessions",
      includeHistory: true,
      deps: {
        search: async () => [
          { id: activeId, score: 0.9 },
          { id: supersededId, score: 0.88 },
        ],
        getByIds: async () => [
          row({
            id: activeId,
            topic: "New",
            summary: "New tip",
            sourceUrl: "https://github.com/org/repo/pull/2",
            supersededBy: null,
          }),
          row({
            id: supersededId,
            topic: "Old",
            summary: "Old tip",
            sourceUrl: "https://github.com/org/repo/pull/1",
            supersededBy: activeId,
          }),
        ],
      },
    });

    expect(out.results).toHaveLength(2);
    expect(out.results[0]?.superseded).toBe(false);
    expect(out.results[1]?.superseded).toBe(true);
  });
});
