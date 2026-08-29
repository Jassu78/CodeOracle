import { eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import { JOB_NAMES } from "@codeoracle/contracts";
import { githubSources, type Database } from "@codeoracle/db";
import { isTrivialSourceMessage } from "@codeoracle/core-domain";
import { bullJobId } from "@codeoracle/queue";
import { safeReplaceJob } from "./safe-replace-job.js";

export type GithubSourceRow = {
  id: string;
  sourceType: string;
  sourceSha: string;
  sourceUrl: string | null;
  title: string | null;
  body: string | null;
  /** Optional SHAs of commits contained in a PR (from crawl raw_json). */
  prCommitShas?: string[];
};

export type SelectSourcesResult = {
  selected: GithubSourceRow[];
  skippedTrivial: number;
  skippedCommitCoveredByPr: number;
};

/** Pure selection logic — prefer PRs; skip commits covered by a PR (merge or contained SHA). */
export function selectSourcesForExtraction(
  sources: GithubSourceRow[],
  opts: { limit?: number } = {},
): SelectSourcesResult {
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
    return {
      selected: applyLimit(commits, opts.limit),
      skippedTrivial,
      skippedCommitCoveredByPr: 0,
    };
  }

  const coveredShas = new Set<string>();
  for (const pr of prs) {
    if (pr.sourceSha) coveredShas.add(pr.sourceSha);
    for (const sha of pr.prCommitShas ?? []) {
      if (sha) coveredShas.add(sha);
    }
  }

  const uncoveredCommits: GithubSourceRow[] = [];
  let skippedCommitCoveredByPr = 0;
  for (const commit of commits) {
    if (coveredShas.has(commit.sourceSha)) {
      skippedCommitCoveredByPr += 1;
      continue;
    }
    uncoveredCommits.push(commit);
  }

  return {
    selected: applyLimit([...prs, ...uncoveredCommits], opts.limit),
    skippedTrivial,
    skippedCommitCoveredByPr,
  };
}

function applyLimit(rows: GithubSourceRow[], limit?: number): GithubSourceRow[] {
  if (limit === undefined || limit <= 0) return rows;
  return rows.slice(0, limit);
}

function prCommitShasFromRawJson(rawJson: unknown): string[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const value = (rawJson as { prCommitShas?: unknown }).prCommitShas;
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** Queue one extract job per eligible github_sources row after indexing completes. */
export async function queueExtractDecisionsForRepo(opts: {
  db: Database;
  queue: Queue;
  repoId: string;
  /** Cap queued jobs (PRs first). 0 / undefined = no cap. */
  limit?: number;
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
      prCommitShas: prCommitShasFromRawJson(s.rawJson),
    })),
    { limit: opts.limit },
  );

  let queued = 0;
  for (const source of selected) {
    const jobId = bullJobId("extract_decisions", opts.repoId, source.id);
    const result = await safeReplaceJob({
      queue: opts.queue,
      name: JOB_NAMES.EXTRACT_DECISIONS,
      jobId,
      data: {
        repoId: opts.repoId,
        githubSourceId: source.id,
      },
      jobOpts: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    });
    if (result !== "skipped_active") queued += 1;
  }

  return { queued, skippedTrivial, skippedCommitCoveredByPr };
}

/** Queue extract jobs for explicit github_sources ids (G4.10 merged-PR path). */
export async function queueExtractDecisionsForSourceIds(opts: {
  queue: Queue;
  repoId: string;
  githubSourceIds: string[];
}): Promise<{ queued: number }> {
  let queued = 0;
  for (const githubSourceId of opts.githubSourceIds) {
    const jobId = bullJobId("extract_decisions", opts.repoId, githubSourceId);
    const result = await safeReplaceJob({
      queue: opts.queue,
      name: JOB_NAMES.EXTRACT_DECISIONS,
      jobId,
      data: {
        repoId: opts.repoId,
        githubSourceId,
      },
      jobOpts: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    });
    if (result !== "skipped_active") queued += 1;
  }
  return { queued };
}
