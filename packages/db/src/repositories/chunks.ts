import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client.js";
import { chunks } from "../schema/chunks.js";

export type ChunkRow = typeof chunks.$inferSelect;

export async function getChunksByIds(db: Database, ids: string[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(chunks).where(inArray(chunks.id, ids));
}

/** Deterministic file view — ordered by byte offset for explain_file. */
export async function listChunksByFilePath(
  db: Database,
  repoId: string,
  filePath: string,
): Promise<ChunkRow[]> {
  return db
    .select()
    .from(chunks)
    .where(and(eq(chunks.repoId, repoId), eq(chunks.filePath, filePath)))
    .orderBy(asc(chunks.byteStart));
}

export async function deleteChunksByIds(db: Database, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db.delete(chunks).where(inArray(chunks.id, ids)).returning({ id: chunks.id });
  return deleted.length;
}

export async function deleteChunksByFilePath(
  db: Database,
  repoId: string,
  filePath: string,
): Promise<{ ids: string[]; qdrantPointIds: string[] }> {
  const rows = await db
    .select({ id: chunks.id, qdrantPointId: chunks.qdrantPointId })
    .from(chunks)
    .where(and(eq(chunks.repoId, repoId), eq(chunks.filePath, filePath)));

  if (rows.length === 0) return { ids: [], qdrantPointIds: [] };

  const ids = rows.map((r) => r.id);
  await db.delete(chunks).where(inArray(chunks.id, ids));
  return {
    ids,
    qdrantPointIds: rows.map((r) => r.qdrantPointId ?? r.id),
  };
}
