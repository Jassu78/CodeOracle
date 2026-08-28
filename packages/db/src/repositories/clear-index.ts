import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { chunks } from "../schema/chunks.js";

/** Deletes all chunk metadata for a repo before a full re-index. Qdrant vectors are cleared separately. */
export async function clearRepoChunks(db: Database, repoId: string): Promise<number> {
  const deleted = await db.delete(chunks).where(eq(chunks.repoId, repoId)).returning({ id: chunks.id });
  return deleted.length;
}
