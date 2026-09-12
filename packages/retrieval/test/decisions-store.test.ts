import { describe, expect, it, vi } from "vitest";
import {
  prepareDecisionsCollectionForFullIndex,
  searchSimilarDecisions,
  upsertDecisionVectors,
} from "../src/store/decisions.js";

describe("decisions store (E4)", () => {
  it("stamps sparse_encoder on hybrid upserts", async () => {
    const upserted: Array<{ payload: Record<string, unknown>; vector: unknown }> = [];
    const client = {
      getCollections: async () => ({ collections: [{ name: "decisions" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      upsert: async (
        _c: string,
        body: { points: Array<{ payload: Record<string, unknown>; vector: unknown }> },
      ) => {
        upserted.push(...body.points);
        return {};
      },
    };

    await upsertDecisionVectors(client as never, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        vector: [0.1, 0.2],
        sparseText: "HMAC webhook verification",
        payload: { repo_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      },
    ]);

    expect(upserted[0]?.payload.sparse_encoder).toBe("bm25-tf-v1");
    expect(upserted[0]?.vector).toMatchObject({
      dense: [0.1, 0.2],
      text: expect.objectContaining({ indices: expect.any(Array) }),
    });
  });

  it("drops sparse-only hybrid tips (evidence 0) from find results", async () => {
    const sparseOnlyId = "99999999-9999-4999-8999-999999999999";
    const query = vi.fn(async (_collection: string, body: { using?: string }) => {
      if (body.using === "dense") return { points: [] };
      if (body.using === "text") {
        return { points: [{ id: sparseOnlyId, score: 0.8 }] };
      }
      throw new Error(`unexpected using=${body.using}`);
    });
    const client = {
      getCollections: async () => ({ collections: [{ name: "decisions" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      query,
    };

    const hits = await searchSimilarDecisions(client as never, {
      repoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      vector: [0.1, 0.2],
      queryText: "xyzzy",
      limit: 5,
      scoreThreshold: 0.45,
    });

    expect(hits).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps strong dense-only tips when dual bleed also exists", async () => {
    const denseOnlyId = "11111111-1111-4111-8111-111111111111";
    const dualId = "22222222-2222-4222-8222-222222222222";
    const query = vi.fn(async (_collection: string, body: { using?: string }) => {
      if (body.using === "dense") {
        return {
          points: [
            { id: denseOnlyId, score: 0.9 },
            { id: dualId, score: 0.7 },
          ],
        };
      }
      if (body.using === "text") {
        return { points: [{ id: dualId, score: 0.8 }] };
      }
      throw new Error(`unexpected using=${body.using}`);
    });
    const client = {
      getCollections: async () => ({ collections: [{ name: "decisions" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      query,
    };

    const hits = await searchSimilarDecisions(client as never, {
      repoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      vector: [0.1, 0.2],
      queryText: "authorize",
      limit: 5,
      scoreThreshold: 0.45,
    });

    const ids = hits.map((h) => h.id);
    expect(ids).toContain(denseOnlyId);
    expect(ids).toContain(dualId);
    expect(hits.find((h) => h.id === denseOnlyId)?.evidenceScore).toBe(0.9);
  });

  it("denseOnly supersede path queries only the dense channel", async () => {
    const query = vi.fn(async (_c: string, body: { using?: string }) => {
      expect(body.using).toBe("dense");
      return { points: [{ id: "11111111-1111-4111-8111-111111111111", score: 0.8 }] };
    });
    const client = {
      getCollections: async () => ({ collections: [{ name: "decisions" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      query,
    };

    const hits = await searchSimilarDecisions(client as never, {
      repoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      vector: [0.1],
      scoreThreshold: 0.75,
      denseOnly: true,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.evidenceScore).toBe(0.8);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("prepareDecisionsCollectionForFullIndex (E4)", () => {
  const repoA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("clears only the target repo on an existing hybrid collection", async () => {
    const deleteCalls: unknown[] = [];
    const client = {
      getCollections: async () => ({ collections: [{ name: "decisions" }] }),
      getCollection: async () => ({
        config: { params: { sparse_vectors: { text: {} } } },
      }),
      deleteCollection: vi.fn(async () => {
        throw new Error("deleteCollection must not run for hybrid multi-repo");
      }),
      delete: async (_c: string, body: unknown) => {
        deleteCalls.push(body);
        return {};
      },
    };

    const result = await prepareDecisionsCollectionForFullIndex(client as never, 2, repoA);
    expect(result).toEqual({ action: "cleared-repo", repoId: repoA });
    expect(deleteCalls).toHaveLength(1);
    expect(client.deleteCollection).not.toHaveBeenCalled();
  });

  it("recreates from legacy dense", async () => {
    const deleteCollection = vi.fn(async () => ({}));
    const createCollection = vi.fn(async () => ({}));
    const client = {
      getCollections: vi.fn(async () => ({ collections: [{ name: "decisions" }] })),
      getCollection: async () => ({
        config: { params: { vectors: { size: 2, distance: "Cosine" } } },
      }),
      deleteCollection,
      createCollection,
    };

    // After deleteCollection, ensure sees missing
    client.getCollections
      .mockResolvedValueOnce({ collections: [{ name: "decisions" }] }) // mode check
      .mockResolvedValueOnce({ collections: [{ name: "decisions" }] }) // recreate: exists?
      .mockResolvedValueOnce({ collections: [] }); // ensure after delete

    const result = await prepareDecisionsCollectionForFullIndex(client as never, 2, repoA);
    expect(result).toEqual({ action: "recreated-from-legacy" });
    expect(deleteCollection).toHaveBeenCalled();
    expect(createCollection).toHaveBeenCalled();
  });
});
