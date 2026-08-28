import { Octokit } from "@octokit/rest";
import type { Database } from "@codeoracle/db";
import { githubSources } from "@codeoracle/db";

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
      target: [githubSources.repoId, githubSources.sourceSha],
      set: {
        sourceType: row.sourceType,
        externalId: row.externalId,
        title: row.title,
        body: row.body,
        sourceUrl: row.sourceUrl,
        mergedAt: row.mergedAt,
        rawJson: row.rawJson,
      },
    });
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
      await upsertGithubSource(opts.db, {
        repoId: opts.repoId,
        sourceType: "pr",
        externalId: String(pr.number),
        title: pr.title,
        body: pr.body ?? "",
        sourceUrl: pr.html_url ?? null,
        sourceSha: pr.merge_commit_sha ?? pr.head.sha,
        mergedAt: new Date(pr.merged_at),
        rawJson: pr as unknown as Record<string, unknown>,
      });
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
      await upsertGithubSource(opts.db, {
        repoId: opts.repoId,
        sourceType: "commit",
        externalId: commit.sha,
        title: commit.commit.message.split("\n")[0] ?? "",
        body: commit.commit.message,
        sourceUrl: commit.html_url ?? null,
        sourceSha: commit.sha,
        mergedAt: commit.commit.author?.date ? new Date(commit.commit.author.date) : null,
        rawJson: commit as unknown as Record<string, unknown>,
      });
      commitCount += 1;
      if (commitCount >= 200) break;
    }
    commitPage += 1;
  }

  return { prCount, commitCount };
}

export async function crawlLocalGitHistory(opts: {
  db: Database;
  repoId: string;
  repoRoot: string;
}): Promise<{ commitCount: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const { stdout } = await exec(
    "git",
    ["log", "--format=%H%x09%s%x09%b", "-n", "200"],
    { cwd: opts.repoRoot },
  );

  let commitCount = 0;
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [sha, subject, ...bodyParts] = line.split("\t");
    if (!sha) continue;
    await upsertGithubSource(opts.db, {
      repoId: opts.repoId,
      sourceType: "commit",
      externalId: sha,
      title: subject ?? "",
      body: bodyParts.join("\t"),
      sourceUrl: null,
      sourceSha: sha,
      mergedAt: null,
      rawJson: { local: true },
    });
    commitCount += 1;
  }
  return { commitCount };
}
