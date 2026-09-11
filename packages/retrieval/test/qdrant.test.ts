import { describe, expect, it, vi } from "vitest";
import {
  prepareChunksCollectionForFullIndex,
  probeSparseEncoderHomogeneity,
  searchSimilarChunks,
  upsertChunkVectors,
} from "../src/store/qdrant.js";

describe("qdrant store", () => {
  it("refuses empty vectors", async () => {
    const client = {
      upsert: async () => ({}),
      getCollections: async () => ({ collections: [{ name: "code_chunks" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
    } as never;

    await expect(
      upsertChunkVectors(client, [{ id: "x", vector: [], payload: {} }]),
    ).rejects.toThrow(/empty vector/i);
  });

  it("stamps sparse_encoder on hybrid upserts (E3)", async () => {
    const upserted: Array<{ payload: Record<string, unknown> }> = [];
    const client = {
      getCollections: async () => ({ collections: [{ name: "code_chunks" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      upsert: async (_c: string, body: { points: Array<{ payload: Record<string, unknown> }> }) => {
        upserted.push(...body.points);
        return {};
      },
    };

    await upsertChunkVectors(client as never, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        vector: [0.1, 0.2],
        sparseText: "verifyGitHubSignature",
        payload: { repo_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      },
    ]);

    expect(upserted[0]?.payload.sparse_encoder).toBe("bm25-tf-v1");
    expect(upserted[0]?.payload.repo_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("probes sparse encoder homogeneity and flags legacy points (E3)", async () => {
    const client = {
      getCollections: async () => ({ collections: [{ name: "code_chunks" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      scroll: async () => ({
        points: [
          { id: "1", payload: { sparse_encoder: "bm25-tf-v1" } },
          { id: "2", payload: {} },
          { id: "3", payload: { sparse_encoder: "other" } },
        ],
      }),
    };

    const probe = await probeSparseEncoderHomogeneity(client as never, { sampleSize: 10 });
    expect(probe.sampled).toBe(3);
    expect(probe.legacyOrMissing).toBe(1);
    expect(probe.mismatched).toBe(1);
    expect(probe.homogeneous).toBe(false);
  });

  it("sets evidenceScore 0 for hybrid sparse-only hits (P0-B / F5)", async () => {
    const sparseOnlyId = "99999999-9999-4999-8999-999999999999";
    const query = vi.fn(async (_collection: string, body: { using?: string }) => {
      if (body.using === "dense") {
        return { points: [] };
      }
      if (body.using === "text") {
        return {
          points: [{ id: sparseOnlyId, score: 0.8, payload: { sparse_encoder: "bm25-tf-v1" } }],
        };
      }
      throw new Error(`unexpected using=${body.using}`);
    });
    const client = {
      getCollections: async () => ({ collections: [{ name: "code_chunks" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      query,
    };

    const hits = await searchSimilarChunks(client as never, {
      repoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      vector: [0.1, 0.2],
      queryText: "lexical mush only",
      limit: 5,
      scoreThreshold: 0.35,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(sparseOnlyId);
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.evidenceScore).toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("prepareChunksCollectionForFullIndex (E8)", () => {
  const repoA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const repoB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("clears only the target repo on an existing hybrid collection", async () => {
    const deleteCalls: unknown[] = [];
    const deleteCollection = vi.fn(async () => {
      throw new Error("deleteCollection must not run for hybrid multi-repo full index");
    });
    const client = {
      getCollections: async () => ({ collections: [{ name: "code_chunks" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      deleteCollection,
      delete: async (collection: string, body: unknown) => {
        deleteCalls.push({ collection, body });
        return {};
      },
      createCollection: vi.fn(async () => ({})),
    };

    const result = await prepareChunksCollectionForFullIndex(client as never, 768, repoA);

    expect(result).toEqual({ action: "cleared-repo", repoId: repoA });
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([
      {
        collection: "code_chunks",
        body: {
          wait: true,
          filter: {
            must: [{ key: "repo_id", match: { value: repoA } }],
          },
        },
      },
    ]);

    await prepareChunksCollectionForFullIndex(client as never, 768, repoB);
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[1]).toMatchObject({
      body: {
        filter: {
          must: [{ key: "repo_id", match: { value: repoB } }],
        },
      },
    });
  });

  it("creates a hybrid collection when missing", async () => {
    const createCollection = vi.fn(async () => ({}));
    const deleteCollection = vi.fn(async () => ({}));
    const client = {
      getCollections: async () => ({ collections: [] }),
      getCollection: async () => {
        throw new Error("should not inspect missing collection");
      },
      deleteCollection,
      createCollection,
      delete: vi.fn(async () => ({})),
    };

    const result = await prepareChunksCollectionForFullIndex(client as never, 768, repoA);
    expect(result).toEqual({ action: "created" });
    expect(createCollection).toHaveBeenCalled();
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("recreates once when collection is legacy-dense", async () => {
    let phase: "legacy" | "gone" = "legacy";
    const createCollection = vi.fn(async () => ({}));
    const deleteFn = vi.fn(async () => {
      throw new Error("scoped delete should not run on legacy recreate path");
    });
    const client = {
      getCollections: async () => ({
        collections: phase === "legacy" ? [{ name: "code_chunks" }] : [],
      }),
      getCollection: async () => ({
        config: { params: {} }, // no sparse_vectors → legacy-dense
      }),
      deleteCollection: async () => {
        phase = "gone";
      },
      createCollection,
      delete: deleteFn,
    };

    const result = await prepareChunksCollectionForFullIndex(client as never, 384, repoA);
    expect(result).toEqual({ action: "recreated-from-legacy" });
    expect(createCollection).toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("rejects empty repoId", async () => {
    await expect(
      prepareChunksCollectionForFullIndex({} as never, 768, "  "),
    ).rejects.toThrow(/repoId/);
  });
});
