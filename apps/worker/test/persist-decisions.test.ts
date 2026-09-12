import { describe, expect, it, vi } from "vitest";
import { persistExtractedDecisions } from "../src/lib/persist-decisions.js";

describe("persistExtractedDecisions", () => {
  it("links superseded_by when a newer decision matches an older active one", async () => {
    const olderId = "11111111-1111-4111-8111-111111111111";
    const upsert = vi.fn(async () => ({}));
    const query = vi.fn(async () => ({ points: [{ id: olderId, score: 0.9 }] }));
    const qdrant = {
      getCollections: vi.fn(async () => ({ collections: [{ name: "decisions" }] })),
      query,
      upsert,
    } as never;

    const insertValues = vi.fn();
    const updateWhere = vi.fn();
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: olderId,
              repoId: "repo",
              topic: "Database",
              summary: "Use Postgres",
              alternativesConsidered: [],
              decidedAt: new Date("2026-01-01T00:00:00.000Z"),
              sourceType: "pr",
              sourceUrl: "https://example.com/pr/1",
              sourceSha: "abc",
              touchedPaths: [],
              confidence: 0.9,
              supersededBy: null,
              embeddingModelId: "embed",
              extractionModelId: "chat",
              createdAt: new Date(),
            },
          ]),
        })),
      })),
    } as never;

    const gateway = {
      embed: vi.fn(async () => ({
        vectors: [[0.1, 0.2, 0.3]],
        providerId: "ollama",
        model: "nomic",
        latencyMs: 1,
      })),
    };

    const result = await persistExtractedDecisions({
      db,
      qdrant,
      gateway,
      repoId: "repo",
      sourceType: "pr",
      sourceUrl: "https://example.com/pr/2",
      sourceSha: "def",
      decidedAt: new Date("2026-08-01T00:00:00.000Z"),
      extractionModelId: "gemini-free:gemini-2.5-flash",
      embeddingModelId: "ollama-embed-local:nomic-embed-text",
      extracted: [
        {
          topic: "Database: Postgres for workers",
          summary: "Moved to Postgres because SQLite locked under concurrent BullMQ workers.",
          alternativesConsidered: ["SQLite"],
          confidence: 0.85,
          touchedPaths: ["packages/db"],
        },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.supersededLinks).toBe(1);
    expect(gateway.embed).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("does not supersede or link when the only similar tip is sourceType=doc", async () => {
    const docId = "22222222-2222-4222-8222-222222222222";
    const upsert = vi.fn(async () => ({}));
    const query = vi.fn(async () => ({ points: [{ id: docId, score: 0.95 }] }));
    const qdrant = {
      getCollections: vi.fn(async () => ({ collections: [{ name: "decisions" }] })),
      query,
      upsert,
    } as never;

    const insertValues = vi.fn();
    const updateWhere = vi.fn();
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              id: docId,
              repoId: "repo",
              topic: "Model Armor",
              summary: "From SAFETY.md",
              alternativesConsidered: [],
              decidedAt: new Date("2026-09-01T00:00:00.000Z"),
              sourceType: "doc",
              sourceUrl: "https://github.com/acme/app/blob/abc/SAFETY.md",
              sourceSha: "abc",
              touchedPaths: ["SAFETY.md"],
              confidence: 0.75,
              supersededBy: null,
              embeddingModelId: "embed",
              extractionModelId: "doc-index:v1",
              createdAt: new Date(),
            },
          ]),
        })),
      })),
    } as never;

    const gateway = {
      embed: vi.fn(async () => ({
        vectors: [[0.1, 0.2, 0.3]],
        providerId: "ollama",
        model: "nomic",
        latencyMs: 1,
      })),
    };

    const result = await persistExtractedDecisions({
      db,
      qdrant,
      gateway,
      repoId: "repo",
      sourceType: "pr",
      sourceUrl: "https://example.com/pr/3",
      sourceSha: "def",
      decidedAt: new Date("2026-01-01T00:00:00.000Z"),
      extractionModelId: "gemini-free:gemini-2.5-flash",
      embeddingModelId: "ollama-embed-local:nomic-embed-text",
      extracted: [
        {
          topic: "Model Armor",
          summary: "PR mentions Model Armor for prompt injection.",
          alternativesConsidered: [],
          confidence: 0.8,
          touchedPaths: [],
        },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.supersededLinks).toBe(0);
    expect(updateWhere).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        supersededBy: null,
        sourceType: "pr",
      }),
    );
  });
});
