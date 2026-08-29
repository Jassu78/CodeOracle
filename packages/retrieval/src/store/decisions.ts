import type { QdrantClient } from "@qdrant/js-client-rest";

export const DECISIONS_COLLECTION = "decisions";

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

export async function ensureDecisionsCollection(
  client: QdrantClient,
  vectorSize: number,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === DECISIONS_COLLECTION);
  if (exists) return;

  await client.createCollection(DECISIONS_COLLECTION, {
    vectors: { size: vectorSize, distance: "Cosine" },
  });
}

export async function upsertDecisionVectors(
  client: QdrantClient,
  points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;

  for (const point of points) {
    if (point.vector.length === 0) {
      throw new Error(`Refusing to upsert empty vector for decision ${point.id}`);
    }
  }

  await client.upsert(DECISIONS_COLLECTION, {
    wait: true,
    points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload })),
  });
}

export async function searchSimilarDecisions(
  client: QdrantClient,
  opts: {
    repoId: string;
    vector: number[];
    limit?: number;
    scoreThreshold?: number;
  },
): Promise<Array<{ id: string; score: number }>> {
  const response = await client.query(DECISIONS_COLLECTION, {
    query: opts.vector,
    limit: opts.limit ?? 5,
    score_threshold: opts.scoreThreshold ?? 0.75,
    filter: {
      must: [{ key: "repo_id", match: { value: opts.repoId } }],
    },
  });

  return response.points.map((r: { id: string | number; score: number }) => ({
    id: String(r.id),
    score: r.score,
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
