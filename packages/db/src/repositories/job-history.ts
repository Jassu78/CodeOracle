import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { jobHistory } from "../schema/job-history.js";

export async function findJobHistoryByKey(
  db: Database,
  opts: { repoId: string; jobType: string; afterSha: string },
): Promise<{ id: string; status: string } | null> {
  const [row] = await db
    .select({ id: jobHistory.id, status: jobHistory.status })
    .from(jobHistory)
    .where(
      and(
        eq(jobHistory.repoId, opts.repoId),
        eq(jobHistory.jobType, opts.jobType),
        eq(jobHistory.afterSha, opts.afterSha),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function startJobHistory(
  db: Database,
  opts: {
    repoId: string;
    jobType: string;
    afterSha?: string | null;
  },
): Promise<string> {
  const afterSha = opts.afterSha ?? null;

  // Retries (429 → failover → BullMQ re-attempt) must reuse the same idempotency
  // key instead of dying on job_history_idempotency_unique.
  if (afterSha) {
    const existing = await db
      .select({ id: jobHistory.id })
      .from(jobHistory)
      .where(
        and(
          eq(jobHistory.repoId, opts.repoId),
          eq(jobHistory.jobType, opts.jobType),
          eq(jobHistory.afterSha, afterSha),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(jobHistory)
        .set({ status: "running", latencyMs: 0, tokensUsed: 0 })
        .where(eq(jobHistory.id, existing[0].id));
      return existing[0].id;
    }
  }

  const id = randomUUID();
  try {
    await db.insert(jobHistory).values({
      id,
      repoId: opts.repoId,
      jobType: opts.jobType,
      afterSha,
      status: "running",
    });
    return id;
  } catch (err) {
    // Race: another worker inserted the same idempotency key first.
    if (afterSha) {
      const [row] = await db
        .select({ id: jobHistory.id })
        .from(jobHistory)
        .where(
          and(
            eq(jobHistory.repoId, opts.repoId),
            eq(jobHistory.jobType, opts.jobType),
            eq(jobHistory.afterSha, afterSha),
          ),
        )
        .limit(1);
      if (row) {
        await db
          .update(jobHistory)
          .set({ status: "running", latencyMs: 0, tokensUsed: 0 })
          .where(eq(jobHistory.id, row.id));
        return row.id;
      }
    }
    throw err;
  }
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
