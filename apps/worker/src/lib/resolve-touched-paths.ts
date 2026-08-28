import { Octokit } from "@octokit/rest";
import {
  ensureCommitReadable,
  formatDiffSummary,
  listCommitStatSummary,
  listCommitTouchedPaths,
  touchedPathsFromRawJson,
} from "./commit-paths.js";

const MAX_PATHS = 100;

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status !== 403 && status !== 429) throw err;
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchPathsViaGithubApi(opts: {
  pat: string;
  githubFullName: string;
  sourceType: "pr" | "commit";
  externalId: string;
  sourceSha: string;
}): Promise<string[]> {
  const [owner, repo] = opts.githubFullName.split("/");
  if (!owner || !repo) return [];
  const octokit = new Octokit({ auth: opts.pat });

  if (opts.sourceType === "pr") {
    const pullNumber = Number(opts.externalId);
    if (!Number.isFinite(pullNumber)) return [];
    const paths: string[] = [];
    let page = 1;
    while (paths.length < MAX_PATHS && page <= 5) {
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
        if (paths.length >= MAX_PATHS) break;
      }
      if (data.length < 100) break;
      page += 1;
    }
    return [...new Set(paths)];
  }

  const { data } = await withRateLimitRetry(() =>
    octokit.rest.repos.getCommit({ owner, repo, ref: opts.sourceSha }),
  );
  return [
    ...new Set(
      (data.files ?? [])
        .map((f) => f.filename)
        .filter((name): name is string => Boolean(name)),
    ),
  ].slice(0, MAX_PATHS);
}

/**
 * Resolve changed paths deterministically:
 * raw_json → local git → GitHub API (when PAT + non-local repo) → [].
 */
export async function resolveTouchedPathsAndDiffSummary(opts: {
  repoRoot: string;
  githubFullName: string;
  localClonePath?: string | null;
  githubPat?: string;
  sourceType: "pr" | "commit";
  externalId: string;
  sourceSha: string;
  rawJson: unknown;
}): Promise<{ paths: string[]; diffSummary?: string }> {
  let paths = touchedPathsFromRawJson(opts.rawJson);

  if (paths.length === 0 && opts.sourceType === "commit") {
    await ensureCommitReadable(opts.repoRoot, opts.sourceSha);
    paths = await listCommitTouchedPaths(opts.repoRoot, opts.sourceSha);
  }

  const isLocal = Boolean(opts.localClonePath);
  if (
    paths.length === 0 &&
    !isLocal &&
    opts.githubPat?.trim() &&
    !opts.githubFullName.startsWith("local/")
  ) {
    try {
      paths = await fetchPathsViaGithubApi({
        pat: opts.githubPat,
        githubFullName: opts.githubFullName,
        sourceType: opts.sourceType,
        externalId: opts.externalId,
        sourceSha: opts.sourceSha,
      });
    } catch {
      paths = [];
    }
  }

  paths = paths.slice(0, MAX_PATHS);

  const stat =
    opts.sourceType === "commit" || paths.length > 0
      ? await listCommitStatSummary(opts.repoRoot, opts.sourceSha)
      : undefined;

  return {
    paths,
    diffSummary: formatDiffSummary({ paths, stat: stat ?? undefined }),
  };
}
