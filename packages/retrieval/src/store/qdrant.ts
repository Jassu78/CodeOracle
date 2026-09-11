import { QdrantClient } from "@qdrant/js-client-rest";
import { applyHybridCutoff, fuseRrf } from "@codeoracle/core-domain";
import { textToSparseVector, type SparseVector } from "../sparse-embed.js";

export const CHUNKS_COLLECTION = "code_chunks";
export const DENSE_VECTOR_NAME = "dense";
export const SPARSE_VECTOR_NAME = "text";

export type ChunksCollectionMode = "missing" | "legacy-dense" | "hybrid";

export function createQdrantClient(url: string): QdrantClient {
  return new QdrantClient({ url, checkCompatibility: false });
}

export async function getChunksCollectionMode(client: QdrantClient): Promise<ChunksCollectionMode> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === CHUNKS_COLLECTION);
  if (!exists) return "missing";

  const info = await client.getCollection(CHUNKS_COLLECTION);
  const sparse = (info.config?.params as { sparse_vectors?: Record<string, unknown> } | undefined)
    ?.sparse_vectors;
  if (sparse && SPARSE_VECTOR_NAME in sparse) return "hybrid";
  return "legacy-dense";
}

/**
 * Create hybrid collection (named dense + sparse) when missing.
 * Does not migrate legacy-dense in place — use `recreateHybridChunksCollection` on full index.
 */
export async function ensureChunksCollection(client: QdrantClient, vectorSize: number): Promise<void> {
  const mode = await getChunksCollectionMode(client);
  if (mode !== "missing") return;

  await client.createCollection(CHUNKS_COLLECTION, {
    vectors: {
      [DENSE_VECTOR_NAME]: { size: vectorSize, distance: "Cosine" },
    },
    sparse_vectors: {
      [SPARSE_VECTOR_NAME]: { modifier: "idf" },
    },
  });
}

/** Drop + recreate hybrid collection — call from full index after clearing Postgres chunks. */
export async function recreateHybridChunksCollection(
  client: QdrantClient,
  vectorSize: number,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === CHUNKS_COLLECTION);
  if (exists) {
    await client.deleteCollection(CHUNKS_COLLECTION);
  }
  await ensureChunksCollection(client, vectorSize);
}

export async function upsertChunkVectors(
  client: QdrantClient,
  points: Array<{
    id: string;
    vector: number[];
    /** Source text for sparse channel — required for hybrid collections. */
    sparseText?: string;
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;

  for (const point of points) {
    if (point.vector.length === 0) {
      throw new Error(`Refusing to upsert empty vector for chunk ${point.id}`);
    }
  }

  const mode = await getChunksCollectionMode(client);

  if (mode === "hybrid") {
    await client.upsert(CHUNKS_COLLECTION, {
      wait: true,
      points: points.map((p) => {
        const sparse: SparseVector = textToSparseVector(p.sparseText ?? "");
        return {
          id: p.id,
          vector: {
            [DENSE_VECTOR_NAME]: p.vector,
            [SPARSE_VECTOR_NAME]: sparse,
          },
          payload: p.payload,
        };
      }),
    });
    return;
  }

  // legacy-dense (or ensure was never called): unnamed dense vector
  await client.upsert(CHUNKS_COLLECTION, {
    wait: true,
    points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload })),
  });
}

/** Removes all Qdrant points for a repo — used before idempotent full re-index. */
export async function deleteRepoChunkVectors(client: QdrantClient, repoId: string): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === CHUNKS_COLLECTION);
  if (!exists) return;

  await client.delete(CHUNKS_COLLECTION, {
    wait: true,
    filter: {
      must: [{ key: "repo_id", match: { value: repoId } }],
    },
  });
}

/**
 * Code chunk search — hybrid dense+sparse RRF when collection supports it;
 * dense-only fallback for legacy collections.
 *
 * Hybrid path (H4): run channels separately so we know which list each id
 * came from, fuse with domain RRF, then apply post-fusion cutoff
 * (channel agreement + drop bottom ranks). `scoreThreshold` gates the dense
 * channel (cosine); it is not applied as a cosine floor on fused RRF scores.
 */
export async function searchSimilarChunks(
  client: QdrantClient,
  opts: {
    repoId: string;
    vector: number[];
    /** Required for sparse channel / hybrid RRF. */
    queryText?: string;
    limit?: number;
    scoreThreshold?: number;
  },
): Promise<Array<{ id: string; score: number; evidenceScore: number }>> {
  const limit = opts.limit ?? 10;
  const scoreThreshold = opts.scoreThreshold ?? 0.35;
  const filter = {
    must: [{ key: "repo_id", match: { value: opts.repoId } }],
  };
  const mode = await getChunksCollectionMode(client);

  if (mode === "hybrid" && opts.queryText?.trim()) {
    const sparse = textToSparseVector(opts.queryText);
    // Prefetch wider than topK so dense-only code can enter fusion/backfill (Q1).
    const prefetchLimit = Math.max(limit * 3, 30);

    const [denseResponse, sparseResponse] = await Promise.all([
      client.query(CHUNKS_COLLECTION, {
        query: opts.vector,
        using: DENSE_VECTOR_NAME,
        limit: prefetchLimit,
        score_threshold: scoreThreshold,
        filter,
      }),
      client.query(CHUNKS_COLLECTION, {
        query: sparse,
        using: SPARSE_VECTOR_NAME,
        limit: prefetchLimit,
        filter,
      }),
    ]);

    const denseScoreById = new Map(
      denseResponse.points.map((p: { id: string | number; score: number }) => [
        String(p.id),
        p.score,
      ]),
    );
    const denseIds = denseResponse.points.map((p: { id: string | number }) => String(p.id));
    const sparseIds = sparseResponse.points.map((p: { id: string | number }) => String(p.id));

    const fused = fuseRrf([
      { channel: "dense", ids: denseIds },
      { channel: "sparse", ids: sparseIds },
    ]);

    // Prefer dual-channel agreement; strong dense-only (≥ dual floor) compete in
    // the primary band; then backfill dense-only / weak dual / sparse-only (Q1/R4).
    const cut = applyHybridCutoff(fused, {
      limit,
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });

    // Ranking score = RRF; evidenceScore = dense cosine (0 if sparse-only) for P0-B.
    return cut.map((h) => ({
      id: h.id,
      score: h.score,
      evidenceScore: denseScoreById.get(h.id) ?? 0,
    }));
  }

  const denseQuery =
    mode === "hybrid"
      ? { query: opts.vector, using: DENSE_VECTOR_NAME }
      : { query: opts.vector };

  const response = await client.query(CHUNKS_COLLECTION, {
    ...denseQuery,
    limit,
    score_threshold: scoreThreshold,
    filter,
  });

  return response.points.map((r: { id: string | number; score: number }) => ({
    id: String(r.id),
    score: r.score,
    evidenceScore: r.score,
  }));
}

/** Delete specific chunk vectors by point id (incremental reindex). */
export async function deleteChunkVectorsByIds(
  client: QdrantClient,
  pointIds: string[],
): Promise<void> {
  if (pointIds.length === 0) return;

  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === CHUNKS_COLLECTION);
  if (!exists) return;

  await client.delete(CHUNKS_COLLECTION, {
    wait: true,
    points: pointIds,
  });
}
