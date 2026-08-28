import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { jobHistory } from "../schema/job-history.js";

export async function startJobHistory(
  db: Database,
  opts: {
    repoId: string;
    jobType: string;
    afterSha?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(jobHistory).values({
    id,
    repoId: opts.repoId,
    jobType: opts.jobType,
    afterSha: opts.afterSha ?? null,
    status: "running",
  });
  return id;
}

export async function finishJobHistory(
  db: Database,
  jobHistoryId: string,
  opts: {
    status: "done" | "error";
    latencyMs: number;
    tokensUsed?: number;
  },
): Promise<void> {
  await db
    .update(jobHistory)
    .set({
      status: opts.status,
      latencyMs: opts.latencyMs,
      tokensUsed: opts.tokensUsed ?? 0,
    })
    .where(eq(jobHistory.id, jobHistoryId));
}
