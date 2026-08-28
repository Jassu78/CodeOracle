import { QdrantClient } from "@qdrant/js-client-rest";

export const CHUNKS_COLLECTION = "code_chunks";

export function createQdrantClient(url: string): QdrantClient {
  return new QdrantClient({ url, checkCompatibility: false });
}

export async function ensureChunksCollection(client: QdrantClient, vectorSize: number): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === CHUNKS_COLLECTION);
  if (exists) return;

  await client.createCollection(CHUNKS_COLLECTION, {
    vectors: { size: vectorSize, distance: "Cosine" },
  });
}

export async function upsertChunkVectors(
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
      throw new Error(`Refusing to upsert empty vector for chunk ${point.id}`);
    }
  }

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
