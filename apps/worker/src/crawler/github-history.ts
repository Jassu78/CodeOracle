import { Octokit } from "@octokit/rest";
import type { Database } from "@codeoracle/db";
import { githubSources } from "@codeoracle/db";
import { listCommitTouchedPaths, normalizePathList } from "../lib/commit-paths.js";

const MAX_TOUCHED_PATHS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status !== 403 && status !== 429) throw err;
      const resetHeader = (err as { response?: { headers?: Record<string, string> } }).response?.headers?.[
        "x-ratelimit-reset"
      ];
      const resetMs = resetHeader ? Math.max(0, Number(resetHeader) * 1000 - Date.now()) + 1000 : 30_000 * (attempt + 1);
      await sleep(Math.min(resetMs, 120_000));
    }
  }
  throw lastError;
}

async function upsertGithubSource(
  db: Database,
  row: {
    repoId: string;
    sourceType: string;
    externalId: string;
    title: string | null;
    body: string | null;
    sourceUrl: string | null;
    sourceSha: string;
    mergedAt: Date | null;
    rawJson: Record<string, unknown>;
  },
): Promise<void> {
  await db
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
    });
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

async function listCommitTouchedPathsViaApi(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
): Promise<string[]> {
  const { data } = await withRateLimitRetry(() =>
    octokit.rest.repos.getCommit({ owner, repo, ref: sha }),
  );
  const paths = (data.files ?? [])
    .map((f) => f.filename)
    .filter((name): name is string => Boolean(name));
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

export async function crawlGithubHistory(opts: {
  db: Database;
  repoId: string;
  githubFullName: string;
  pat: string;
}): Promise<{ prCount: number; commitCount: number }> {
  const [owner, repo] = opts.githubFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid github full name: ${opts.githubFullName}`);
  const octokit = new Octokit({ auth: opts.pat });

  const prCoveredShas = new Set<string>();
  let prCount = 0;
  let prPage = 1;
  while (prPage <= 5) {
    const { data: pulls } = await withRateLimitRetry(() =>
      octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        per_page: 100,
        page: prPage,
      }),
    );
    if (pulls.length === 0) break;

    for (const pr of pulls) {
      if (!pr.merged_at) continue;
      const mergeSha = pr.merge_commit_sha ?? pr.head.sha;
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

      await upsertGithubSource(opts.db, {
        repoId: opts.repoId,
        sourceType: "pr",
        externalId: String(pr.number),
        title: pr.title,
        body: pr.body ?? "",
        sourceUrl: pr.html_url ?? null,
        sourceSha: mergeSha,
        mergedAt: new Date(pr.merged_at),
        rawJson: { ...(pr as unknown as Record<string, unknown>), touchedPaths, prCommitShas },
      });
      for (const sha of prCommitShas) prCoveredShas.add(sha);
      prCount += 1;
    }
    prPage += 1;
  }

  let commitCount = 0;
  let commitPage = 1;
  while (commitCount < 200 && commitPage <= 5) {
    const { data: commits } = await withRateLimitRetry(() =>
      octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 100,
        page: commitPage,
      }),
    );
    if (commits.length === 0) break;

    for (const commit of commits) {
      // Skip commits already covered by a merged PR (prefer PR bodies for extract).
      if (prCoveredShas.has(commit.sha)) continue;

      let touchedPaths: string[] = [];
      try {
        touchedPaths = await listCommitTouchedPathsViaApi(octokit, owner, repo, commit.sha);
      } catch {
        touchedPaths = [];
      }

      await upsertGithubSource(opts.db, {
        repoId: opts.repoId,
        sourceType: "commit",
        externalId: commit.sha,
        title: commit.commit.message.split("\n")[0] ?? "",
        body: commit.commit.message,
        sourceUrl: commit.html_url ?? null,
        sourceSha: commit.sha,
        mergedAt: commit.commit.author?.date ? new Date(commit.commit.author.date) : null,
        rawJson: { ...(commit as unknown as Record<string, unknown>), touchedPaths },
      });
      commitCount += 1;
      if (commitCount >= 200) break;
    }
    commitPage += 1;
  }

  return { prCount, commitCount };
}

/** Parse `git log --format=%H%x00%s%x00%b%x00%aI%x00` stdout into records. */
export function parseNulDelimitedGitLog(stdout: string): Array<{
  sha: string;
  subject: string;
  body: string;
  authorDate: string;
}> {
  const parts = stdout.split("\0");
  const commits: Array<{ sha: string; subject: string; body: string; authorDate: string }> = [];
  for (let i = 0; i + 3 < parts.length; i += 4) {
    const sha = parts[i]?.trim() ?? "";
    const subject = parts[i + 1] ?? "";
    const body = parts[i + 2] ?? "";
    const authorDate = parts[i + 3]?.trim() ?? "";
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) continue;
    commits.push({ sha, subject, body, authorDate });
  }
  return commits;
}

export async function crawlLocalGitHistory(opts: {
  db: Database;
  repoId: string;
  repoRoot: string;
  /** Used for local:// citations when no GitHub remote is discoverable. */
  repoSlug?: string;
}): Promise<{ commitCount: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { commitCitationUrl, resolveGithubHttpsBase } = await import("../lib/citation-url.js");
  const exec = promisify(execFile);
  const { stdout } = await exec(
    "git",
    // NUL-delimited records so multi-line commit bodies do not corrupt SHAs.
    ["log", "-n", "200", "--format=%H%x00%s%x00%b%x00%aI%x00"],
    { cwd: opts.repoRoot, maxBuffer: 20 * 1024 * 1024 },
  );

  const githubHttpsBase = await resolveGithubHttpsBase(opts.repoRoot);
  const repoSlug =
    opts.repoSlug ??
    (githubHttpsBase?.split("/").slice(-2).join("/") ?? opts.repoRoot.split("/").pop() ?? "local-repo");

  let commitCount = 0;
  for (const { sha, subject, body, authorDate } of parseNulDelimitedGitLog(stdout)) {
    const touchedPaths = (await listCommitTouchedPaths(opts.repoRoot, sha)).slice(
      0,
      MAX_TOUCHED_PATHS,
    );

    await upsertGithubSource(opts.db, {
      repoId: opts.repoId,
      sourceType: "commit",
      externalId: sha,
      title: subject,
      body,
      sourceUrl: commitCitationUrl({ githubHttpsBase, repoSlug, sha }),
      sourceSha: sha,
      mergedAt: authorDate && !Number.isNaN(Date.parse(authorDate)) ? new Date(authorDate) : null,
      rawJson: { local: true, githubHttpsBase, touchedPaths },
    });
    commitCount += 1;
  }
  return { commitCount };
}
