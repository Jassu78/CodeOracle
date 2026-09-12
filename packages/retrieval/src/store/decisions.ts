import type { QdrantClient } from "@qdrant/js-client-rest";
import { applyHybridCutoff, fuseRrf } from "@codeoracle/core-domain";
import { textToSparseVector, SPARSE_ENCODER_VERSION, type SparseVector } from "../sparse-embed.js";

export const DECISIONS_COLLECTION = "decisions";
export const DECISION_DENSE_VECTOR_NAME = "dense";
export const DECISION_SPARSE_VECTOR_NAME = "text";

export function decisionEmbedText(
  topic: string,
  summary: string,
  alternativesConsidered: string[] = [],
): string {
  const alts =
    alternativesConsidered.length > 0
      ? `\n\nAlternatives considered: ${alternativesConsidered.join("; ")}`
      : "";
  return `${topic.trim()}\n\n${summary.trim()}${alts}`;
}

export type DecisionsCollectionMode = "missing" | "legacy-dense" | "hybrid";

export async function getDecisionsCollectionMode(
  client: QdrantClient,
): Promise<DecisionsCollectionMode> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === DECISIONS_COLLECTION);
  if (!exists) return "missing";

  const info = await client.getCollection(DECISIONS_COLLECTION);
  const sparse = (info.config?.params as { sparse_vectors?: Record<string, unknown> } | undefined)
    ?.sparse_vectors;
  if (sparse && DECISION_SPARSE_VECTOR_NAME in sparse) return "hybrid";
  return "legacy-dense";
}

/** Create hybrid decisions collection when missing (E4). */
export async function ensureDecisionsCollection(
  client: QdrantClient,
  vectorSize: number,
): Promise<void> {
  const mode = await getDecisionsCollectionMode(client);
  if (mode !== "missing") return;

  await client.createCollection(DECISIONS_COLLECTION, {
    vectors: {
      [DECISION_DENSE_VECTOR_NAME]: { size: vectorSize, distance: "Cosine" },
    },
    sparse_vectors: {
      [DECISION_SPARSE_VECTOR_NAME]: { modifier: "idf" },
    },
  });
}

export type PrepareDecisionsCollectionResult =
  | { action: "created" }
  | { action: "cleared-repo"; repoId: string }
  | { action: "recreated-from-legacy" };

/**
 * Prepare shared `decisions` collection for a full index of one repo (E4 / E8-style).
 * - missing → create hybrid
 * - hybrid → delete only this repo's points
 * - legacy-dense → drop + recreate hybrid (one-time wipe — reindex all repos' decisions)
 */
export async function prepareDecisionsCollectionForFullIndex(
  client: QdrantClient,
  vectorSize: number,
  repoId: string,
): Promise<PrepareDecisionsCollectionResult> {
  const scopedRepoId = repoId.trim();
  if (!scopedRepoId) {
    throw new Error("prepareDecisionsCollectionForFullIndex: repoId must be non-empty");
  }

  const mode = await getDecisionsCollectionMode(client);

  if (mode === "missing") {
    await ensureDecisionsCollection(client, vectorSize);
    return { action: "created" };
  }

  if (mode === "hybrid") {
    await deleteRepoDecisionVectors(client, scopedRepoId);
    return { action: "cleared-repo", repoId: scopedRepoId };
  }

  await recreateHybridDecisionsCollection(client, vectorSize);
  return { action: "recreated-from-legacy" };
}

async function recreateHybridDecisionsCollection(
  client: QdrantClient,
  vectorSize: number,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === DECISIONS_COLLECTION);
  if (exists) {
    await client.deleteCollection(DECISIONS_COLLECTION);
  }
  await ensureDecisionsCollection(client, vectorSize);
}

export async function upsertDecisionVectors(
  client: QdrantClient,
  points: Array<{
    id: string;
    vector: number[];
    /** Source text for sparse channel — decisionEmbedText. */
    sparseText?: string;
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;

  for (const point of points) {
    if (point.vector.length === 0) {
      throw new Error(`Refusing to upsert empty vector for decision ${point.id}`);
    }
  }

  const mode = await getDecisionsCollectionMode(client);

  if (mode === "hybrid") {
    await client.upsert(DECISIONS_COLLECTION, {
      wait: true,
      points: points.map((p) => {
        const sparse: SparseVector = textToSparseVector(p.sparseText ?? "", { role: "document" });
        return {
          id: p.id,
          vector: {
            [DECISION_DENSE_VECTOR_NAME]: p.vector,
            [DECISION_SPARSE_VECTOR_NAME]: sparse,
          },
          payload: {
            ...p.payload,
            sparse_encoder: SPARSE_ENCODER_VERSION,
          },
        };
      }),
    });
    return;
  }

  // legacy-dense until prepare recreates
  await client.upsert(DECISIONS_COLLECTION, {
    wait: true,
    points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload })),
  });
}

export type DecisionSearchHit = {
  id: string;
  /** Ranking score: RRF when hybrid, dense cosine when legacy / denseOnly. */
  score: number;
  /** Dense cosine for P0-B / supersede (0 if sparse-only). */
  evidenceScore: number;
};

/**
 * Decision topic search — hybrid dense+sparse RRF when collection supports it.
 * Floors must use `evidenceScore`, not fused `score`.
 */
export async function searchSimilarDecisions(
  client: QdrantClient,
  opts: {
    repoId: string;
    vector: number[];
    /** Topic text for sparse query (required for hybrid find path). */
    queryText?: string;
    limit?: number;
    scoreThreshold?: number;
    /**
     * Dense-only (supersede archaeology). Never returns sparse-only tips.
     * Default false = hybrid find path when available.
     */
    denseOnly?: boolean;
  },
): Promise<DecisionSearchHit[]> {
  const limit = opts.limit ?? 5;
  const scoreThreshold = opts.scoreThreshold ?? 0.75;
  const filter = {
    must: [{ key: "repo_id", match: { value: opts.repoId } }],
  };
  const mode = await getDecisionsCollectionMode(client);

  if (mode === "hybrid" && !opts.denseOnly && opts.queryText?.trim()) {
    const sparse = textToSparseVector(opts.queryText, { role: "query" });
    const prefetchLimit = Math.max(limit * 3, 24);

    const [denseResponse, sparseResponse] = await Promise.all([
      client.query(DECISIONS_COLLECTION, {
        query: opts.vector,
        using: DECISION_DENSE_VECTOR_NAME,
        limit: prefetchLimit,
        score_threshold: scoreThreshold,
        filter,
      }),
      client.query(DECISIONS_COLLECTION, {
        query: sparse,
        using: DECISION_SPARSE_VECTOR_NAME,
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

    // Prefer dual + strong dense-only (chunk-style primary band). Then drop
    // sparse-only tips so they cannot clear P0-B via RRF alone.
    const cut = applyHybridCutoff(fused, {
      limit: Math.max(limit * 2, limit + 5),
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });

    return cut
      .map((h) => ({
        id: h.id,
        score: h.score,
        evidenceScore: denseScoreById.get(h.id) ?? 0,
      }))
      .filter((h) => h.evidenceScore > 0)
      .slice(0, limit);
  }

  const denseQuery =
    mode === "hybrid"
      ? { query: opts.vector, using: DECISION_DENSE_VECTOR_NAME }
      : { query: opts.vector };

  const response = await client.query(DECISIONS_COLLECTION, {
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

/** Removes all Qdrant decision vectors for a repo — used before idempotent full re-index. */
export async function deleteRepoDecisionVectors(
  client: QdrantClient,
  repoId: string,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === DECISIONS_COLLECTION);
  if (!exists) return;

  await client.delete(DECISIONS_COLLECTION, {
    wait: true,
    filter: {
      must: [{ key: "repo_id", match: { value: repoId } }],
    },
  });
}

/** Point-id deletes for incremental doc decision replace. */
export async function deleteDecisionVectorsByIds(
  client: QdrantClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === DECISIONS_COLLECTION);
  if (!exists) return;

  await client.delete(DECISIONS_COLLECTION, {
    wait: true,
    points: ids,
  });
}
