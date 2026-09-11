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
      expect.objectContaining({ repoId, limit: 10, scoreThreshold: 0.35 }),
    );
  });

  it("diversifies by filePath with doc quota so docs cannot fill topK (Q1/R4)", async () => {
    const ids = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
    const search = vi.fn(async () => [
      { id: ids[0]!, score: 0.58 },
      { id: ids[1]!, score: 0.47 },
      { id: ids[2]!, score: 0.24 },
      { id: ids[3]!, score: 0.237 },
    ]);
    const getByIds = vi.fn(async () => [
      row({ id: ids[0]!, filePath: "apps/api/README.md", content: "doc a" }),
      row({ id: ids[1]!, filePath: "README.md", content: "doc b" }),
      row({ id: ids[2]!, filePath: "apps/api/README.md", content: "doc a again" }),
      row({
        id: ids[3]!,
        filePath: "apps/api/src/webhooks/github-signature.ts",
        content: "export function verifyGitHubSignature() {}",
        symbolName: "verifyGitHubSignature",
      }),
    ]);

    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "where do we verify GitHub webhook HMAC signatures",
      topK: 3,
      deps: { search, getByIds },
    });

    // Unique paths in rank order → doc quota maxDocs=1 → code before second README.
    expect(out.results.map((r) => r.filePath)).toEqual([
      "apps/api/README.md",
      "apps/api/src/webhooks/github-signature.ts",
      "README.md",
    ]);
  });

  it("refuses .env2-class paths and secret payloads even if indexed (P0-A)", async () => {
    const secretId = "44444444-4444-4444-8444-444444444444";
    const okId = "55555555-5555-4555-8555-555555555555";
    const payloadId = "66666666-6666-4666-8666-666666666666";
    const search = vi.fn(async () => [
      { id: secretId, score: 0.99 },
      { id: payloadId, score: 0.95 },
      { id: okId, score: 0.9 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: secretId,
        filePath: "apps/chatbot/.env2",
        content: "GEMINI_API_KEY=should-not-leak",
      }),
      row({
        id: payloadId,
        filePath: "notes/debug.ts",
        content: "const uri = 'mongodb+srv://user:pass@cluster/db'",
      }),
      row({
        id: okId,
        filePath: "src/config/env.ts",
        content: "export function loadEnv() {}",
        symbolName: "loadEnv",
      }),
    ]);

    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "GEMINI_API_KEY secrets",
      topK: 5,
      deps: { search, getByIds },
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.filePath).toBe("src/config/env.ts");
  });
});
