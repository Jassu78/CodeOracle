import { eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import { JOB_NAMES } from "@codeoracle/contracts";
import { githubSources, type Database } from "@codeoracle/db";
import { isTrivialSourceMessage } from "@codeoracle/extraction";
import { bullJobId } from "@codeoracle/queue";

export type GithubSourceRow = {
  id: string;
  sourceType: string;
  sourceSha: string;
  sourceUrl: string | null;
  title: string | null;
  body: string | null;
};

/** Pure selection logic — prefer PRs; skip commits covered by a PR merge SHA. */
export function selectSourcesForExtraction(sources: GithubSourceRow[]): {
  selected: GithubSourceRow[];
  skippedTrivial: number;
  skippedCommitCoveredByPr: number;
} {
  let skippedTrivial = 0;
  const nonTrivial: GithubSourceRow[] = [];

  for (const source of sources) {
    if (!source.sourceUrl) continue;
    const title = source.title ?? "";
    const body = source.body ?? "";
    if (!`${title}\n${body}`.trim()) continue;
    if (isTrivialSourceMessage(title, body)) {
      skippedTrivial += 1;
      continue;
    }
    nonTrivial.push(source);
  }

  const prs = nonTrivial.filter((s) => s.sourceType === "pr");
  const commits = nonTrivial.filter((s) => s.sourceType !== "pr");

  if (prs.length === 0) {
    return { selected: commits, skippedTrivial, skippedCommitCoveredByPr: 0 };
  }

  const prShas = new Set(prs.map((p) => p.sourceSha));
  const uncoveredCommits: GithubSourceRow[] = [];
  let skippedCommitCoveredByPr = 0;
  for (const commit of commits) {
    if (prShas.has(commit.sourceSha)) {
      skippedCommitCoveredByPr += 1;
      continue;
    }
    uncoveredCommits.push(commit);
  }

  return {
    selected: [...prs, ...uncoveredCommits],
    skippedTrivial,
    skippedCommitCoveredByPr,
  };
}

/** Queue one extract job per eligible github_sources row after indexing completes. */
export async function queueExtractDecisionsForRepo(opts: {
  db: Database;
  queue: Queue;
  repoId: string;
}): Promise<{
  queued: number;
  skippedTrivial: number;
  skippedCommitCoveredByPr: number;
}> {
  const sources = await opts.db
    .select()
    .from(githubSources)
    .where(eq(githubSources.repoId, opts.repoId));

  const { selected, skippedTrivial, skippedCommitCoveredByPr } = selectSourcesForExtraction(
    sources.map((s) => ({
      id: s.id,
      sourceType: s.sourceType,
      sourceSha: s.sourceSha,
      sourceUrl: s.sourceUrl,
      title: s.title,
      body: s.body,
    })),
  );

  let queued = 0;
  for (const source of selected) {
    // Remove prior job with same id so re-extract actually runs (BullMQ jobId is idempotent).
    const jobId = bullJobId("extract_decisions", opts.repoId, source.id);
    const existing = await opts.queue.getJob(jobId);
    if (existing) {
      await existing.remove();
    }

    await opts.queue.add(
      JOB_NAMES.EXTRACT_DECISIONS,
      {
        repoId: opts.repoId,
        githubSourceId: source.id,
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );
    queued += 1;
  }

  return { queued, skippedTrivial, skippedCommitCoveredByPr };
}
