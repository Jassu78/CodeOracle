import { and, eq } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { githubSources, type Database } from "@codeoracle/db";
import { normalizePathList } from "./commit-paths.js";

const MAX_TOUCHED_PATHS = 100;

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status !== 403 && status !== 429) throw err;
      const resetHeader = (err as { response?: { headers?: Record<string, string> } }).response
        ?.headers?.["x-ratelimit-reset"];
      const resetMs = resetHeader
        ? Math.max(0, Number(resetHeader) * 1000 - Date.now()) + 1000
        : 30_000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(resetMs, 120_000)));
    }
  }
  throw lastError;
}

async function listPrTouchedPaths(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  const paths: string[] = [];
  let page = 1;
  while (paths.length < MAX_TOUCHED_PATHS && page <= 5) {
    const { data } = await withRateLimitRetry(() =>
      octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    );
    if (data.length === 0) break;
    for (const file of data) {
      if (file.filename) paths.push(file.filename);
      if (paths.length >= MAX_TOUCHED_PATHS) break;
    }
    if (data.length < 100) break;
    page += 1;
  }
  return normalizePathList(paths).slice(0, MAX_TOUCHED_PATHS);
}

async function listPrCommitShas(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  const shas: string[] = [];
  let page = 1;
  while (shas.length < 250 && page <= 5) {
    const { data } = await withRateLimitRetry(() =>
      octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    );
    if (data.length === 0) break;
    for (const c of data) {
      if (c.sha) shas.push(c.sha);
    }
    if (data.length < 100) break;
    page += 1;
  }
  return shas;
}

export type SyncedMergedPr = {
  githubSourceId: string;
  pullNumber: number;
  mergeSha: string;
  title: string;
};

/**
 * G4.10 — find PRs associated with `afterSha` that were merged, upsert `github_sources`,
 * return source ids for extract queueing. Direct pushes with no merged PR → empty list.
 */
export async function syncMergedPrsAtCommit(opts: {
  db: Database;
  repoId: string;
  githubFullName: string;
  pat: string;
  afterSha: string;
}): Promise<SyncedMergedPr[]> {
  const [owner, repo] = opts.githubFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid github full name: ${opts.githubFullName}`);
  }
  if (opts.githubFullName.startsWith("local/")) {
    return [];
  }

  const octokit = new Octokit({ auth: opts.pat });
  const { data: associated } = await withRateLimitRetry(() =>
    octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: opts.afterSha,
    }),
  );

  const merged = associated.filter((pr) => Boolean(pr.merged_at));
  const synced: SyncedMergedPr[] = [];

  for (const pr of merged) {
    const mergeSha = pr.merge_commit_sha ?? pr.head.sha ?? opts.afterSha;
    let touchedPaths: string[] = [];
    try {
      touchedPaths = await listPrTouchedPaths(octokit, owner, repo, pr.number);
    } catch {
      touchedPaths = [];
    }

    let prCommitShas: string[] = [];
    try {
      prCommitShas = await listPrCommitShas(octokit, owner, repo, pr.number);
    } catch {
      prCommitShas = [];
    }
    if (mergeSha) prCommitShas = [...new Set([...prCommitShas, mergeSha])];

    const row = {
      repoId: opts.repoId,
      sourceType: "pr",
      externalId: String(pr.number),
      title: pr.title,
      body: pr.body ?? "",
      sourceUrl: pr.html_url ?? null,
      sourceSha: mergeSha,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      rawJson: {
        ...(pr as unknown as Record<string, unknown>),
        touchedPaths,
        prCommitShas,
      },
    };

    const inserted = await opts.db
      .insert(githubSources)
      .values(row)
      .onConflictDoUpdate({
        target: [githubSources.repoId, githubSources.sourceType, githubSources.externalId],
        set: {
          title: row.title,
          body: row.body,
          sourceUrl: row.sourceUrl,
          sourceSha: row.sourceSha,
          mergedAt: row.mergedAt,
          rawJson: row.rawJson,
        },
      })
      .returning({ id: githubSources.id });

    let githubSourceId = inserted[0]?.id;
    if (!githubSourceId) {
      const [existing] = await opts.db
        .select({ id: githubSources.id })
        .from(githubSources)
        .where(
          and(
            eq(githubSources.repoId, opts.repoId),
            eq(githubSources.sourceType, "pr"),
            eq(githubSources.externalId, String(pr.number)),
          ),
        )
        .limit(1);
      githubSourceId = existing?.id;
    }
    if (!githubSourceId) {
      throw new Error(`Failed to upsert github_sources for PR #${pr.number}`);
    }

    synced.push({
      githubSourceId,
      pullNumber: pr.number,
      mergeSha,
      title: pr.title,
    });
  }

  return synced;
}

/** Pure filter — unit-tested without Octokit. */
export function filterMergedAssociatedPulls<
  T extends { merged_at?: string | null; number: number },
>(prs: T[]): T[] {
  return prs.filter((pr) => Boolean(pr.merged_at));
}
