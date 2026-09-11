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

/** Test hit — evidence defaults to ranking score (legacy dense). */
function hit(id: string, score: number, evidenceScore = score) {
  return { id, score, evidenceScore };
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
        deps: {
          search: async () => [],
          getByIds: async () => [],
          lexicalSearch: async () => [],
        },
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
      hit(chunkA, 0.9),
      hit(noPathId, 0.8),
      hit(chunkB, 0.7),
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
      hit(ids[0]!, 0.58),
      hit(ids[1]!, 0.47),
      hit(ids[2]!, 0.24),
      hit(ids[3]!, 0.237, 0.4),
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
      hit(secretId, 0.99),
      hit(payloadId, 0.95),
      hit(okId, 0.9),
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

  it("returns empty when dense evidence is below absolute floor (P0-B)", async () => {
    const weakA = "77777777-7777-4777-8777-777777777777";
    const weakB = "88888888-8888-4888-8888-888888888888";
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "asdf qwerty unrelated mush",
      topK: 5,
      deps: {
        search: async () => [hit(weakA, 0.12), hit(weakB, 0.09)],
        getByIds: async () => [
          row({ id: weakA, filePath: "apps/a.ts", content: "noise a" }),
          row({ id: weakB, filePath: "apps/b.ts", content: "noise b" }),
        ],
      },
    });
    expect(out.results).toEqual([]);
  });

  it("empties hybrid sparse-only tips even when RRF ranking score looks mid (P0-B)", async () => {
    const sparseOnly = "99999999-9999-4999-8999-999999999999";
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "nonsense lexical mush",
      topK: 5,
      deps: {
        // RRF single-channel top ≈ 1/3, but no dense evidence.
        search: async () => [hit(sparseOnly, 1 / 3, 0)],
        getByIds: async () => [
          row({ id: sparseOnly, filePath: "apps/noise.ts", content: "lexical noise" }),
        ],
      },
    });
    expect(out.results).toEqual([]);
  });

  it("keeps in-domain hits with dense evidence above absolute floor (P0-B)", async () => {
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "verify hmac",
      topK: 3,
      deps: {
        search: async () => [hit(chunkA, 0.5, 0.4)],
        getByIds: async () => [
          row({
            id: chunkA,
            filePath: "apps/api/src/webhooks/github-signature.ts",
            content: "export function verifyGitHubSignature() {}",
            symbolName: "verifyGitHubSignature",
          }),
        ],
      },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.filePath).toContain("github-signature.ts");
  });

  it("keeps exact lexical symbol hits when dense evidence is weak (E1)", async () => {
    const exactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const search = vi.fn(async () => [hit(exactId, 0.2, 0.1)]);
    const lexicalSearch = vi.fn(async () => [
      { id: exactId, matchKind: "symbol_exact" as const, score: 1 },
    ]);
    const getByIds = vi.fn(async () => [
      row({
        id: exactId,
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
      query: "verifyGitHubSignature",
      topK: 3,
      deps: { search, getByIds, lexicalSearch },
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.symbolName).toBe("verifyGitHubSignature");
    expect(lexicalSearch).toHaveBeenCalled();
  });

  it("returns empty for garbage when lexical and dense are both weak (E1)", async () => {
    const mushId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "asdf qwerty unrelated mush",
      topK: 5,
      deps: {
        search: async () => [hit(mushId, 0.1, 0.05)],
        lexicalSearch: async () => [{ id: mushId, matchKind: "content", score: 0.45 }],
        getByIds: async () => [
          row({ id: mushId, filePath: "apps/noise.ts", content: "lexical noise asdf" }),
        ],
      },
    });
    expect(out.results).toEqual([]);
  });

  it("surfaces lexical-only path hits with no hybrid results (E1)", async () => {
    const pathId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "github-signature.ts",
      topK: 3,
      deps: {
        search: async () => [],
        lexicalSearch: async () => [{ id: pathId, matchKind: "path_suffix", score: 0.92 }],
        getByIds: async () => [
          row({
            id: pathId,
            filePath: "apps/api/src/webhooks/github-signature.ts",
            content: "export function verifyGitHubSignature() {}",
            symbolName: "verifyGitHubSignature",
          }),
        ],
      },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.filePath).toContain("github-signature.ts");
  });

  it("drops weak hybrid companions when exact lexical clears the floor (E1/F4)", async () => {
    const exactId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const mushId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const out = await searchCodebase({
      db: stubDb,
      qdrant: stubQdrant,
      embed: async () => [[0.1]],
      repoId,
      query: "verifyGitHubSignature",
      topK: 5,
      deps: {
        search: async () => [hit(mushId, 0.2, 0.05), hit(exactId, 0.15, 0.1)],
        lexicalSearch: async () => [{ id: exactId, matchKind: "symbol_exact", score: 1 }],
        getByIds: async () => [
          row({
            id: exactId,
            filePath: "apps/api/src/webhooks/github-signature.ts",
            content: "export function verifyGitHubSignature() {}",
            symbolName: "verifyGitHubSignature",
          }),
          row({ id: mushId, filePath: "apps/noise.ts", content: "unrelated" }),
        ],
      },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.chunkId).toBe(exactId);
  });
});
