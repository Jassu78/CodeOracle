import { inArray } from "drizzle-orm";
import type { Database } from "../client.js";
import { chunks } from "../schema/chunks.js";

export async function markChunksEmbeddingStatus(
  db: Database,
  chunkIds: string[],
  status: "pending" | "embedded" | "failed",
): Promise<void> {
  if (chunkIds.length === 0) return;
  await db.update(chunks).set({ embeddingStatus: status }).where(inArray(chunks.id, chunkIds));
}
