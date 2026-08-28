import { sql, lt } from "drizzle-orm";
import type { Database } from "../client.js";
import { jobHistory } from "../schema/job-history.js";

export async function pruneJobHistory(db: Database, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(jobHistory).where(lt(jobHistory.createdAt, cutoff)).returning({ id: jobHistory.id });
  return deleted.length;
}
