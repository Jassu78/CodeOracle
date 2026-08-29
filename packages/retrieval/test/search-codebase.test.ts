import { describe, expect, it, vi } from "vitest";
import { searchCodebase } from "../src/search-codebase.js";
import type { ChunkRow } from "@codeoracle/db";

const repoId = "9462ddb7-6064-4620-87c7-584566f643af";
const chunkA = "11111111-1111-4111-8111-111111111111";
const chunkB = "22222222-2222-4222-8222-222222222222";
const noPathId = "33333333-3333-4333-8333-333333333333";

function row(partial: Partial<ChunkRow> & Pick<ChunkRow, "id" | "filePath" | "content">): ChunkRow {
  return {
    repoId,
    symbolName: null,
    parentSymbol: null,
    language: "ts",
    byteStart: 0,
    byteEnd: 10,
    contentHash: "h",
    embeddingModelId: "ollama:nomic",
    embeddingStatus: "embedded",
    qdrantPointId: partial.id,
    lastIndexedSha: "abc",
    createdAt: new Date(),
    ...partial,
  };
}

const stubDb = {} as never;
const stubQdrant = {} as never;

describe("searchCodebase", () => {
  it("rejects empty query / repoId", async () => {
    await expect(
      searchCodebase({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[0.1]],
        repoId,
        query: "  ",
      }),
    ).rejects.toThrow(/query/);

    await expect(
      searchCodebase({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[0.1]],
        repoId: "",
        query: "auth",
      }),
    ).rejects.toThrow(/repoId/);
  });

  it("rejects empty embedding vectors", async () => {
    await expect(
      searchCodebase({
        db: stubDb,
        qdrant: stubQdrant,
        embed: async () => [[]],
        repoId,
        query: "auth",
      }),
    ).rejects.toThrow(/empty vector/);
  });

  it("returns empty results when nothing matches", async () => {
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1, 0.2]],
      repoId,
      query: "unknown",
      deps: { search: async () => [], getByIds: async () => [] },
    });
    expect(out.results).toEqual([]);
  });

  it("preserves score order and drops rows without filePath", async () => {
    const search = vi.fn(async () => [
      { id: chunkA, score: 0.9 },
      { id: noPathId, score: 0.8 },
      { id: chunkB, score: 0.7 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: chunkA,
        filePath: "apps/api/src/auth.ts",
        content: "export function login() {}",
        symbolName: "login",
      }),
      row({ id: noPathId, filePath: "   ", content: "orphan" }),
      row({
        id: chunkB,
        filePath: "apps/api/src/session.ts",
        content: "export const store = {}",
        symbolName: null,
      }),
    ]);

    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "login session",
      topK: 5,
      deps: { search, getByIds },
    });

    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({
      chunkId: chunkA,
      filePath: "apps/api/src/auth.ts",
      symbolName: "login",
      score: 0.9,
    });
    expect(out.results[1]?.filePath).toBe("apps/api/src/session.ts");
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ repoId, limit: 5, scoreThreshold: 0.35 }),
    );
  });
});
