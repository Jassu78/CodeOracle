import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Turn a git remote URL into https://github.com/owner/repo (no .git).
 * Returns null when the remote is not a GitHub HTTPS/SSH URL.
 */
export function normalizeGithubHttpsRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]!.replace(/\.git$/i, "")}`;

  const https = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (https) return `https://github.com/${https[1]}/${https[2]!.replace(/\.git$/i, "")}`;

  return null;
}

/**
 * Walk origin remotes (including local-path remotes that point at another clone)
 * to find a GitHub HTTPS base for citations — without calling the GitHub API.
 */
export async function resolveGithubHttpsBase(
  repoRoot: string,
  maxHops = 3,
): Promise<string | null> {
  let cwd = repoRoot;
  for (let hop = 0; hop < maxHops; hop++) {
    let remote: string;
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
      remote = stdout.trim();
    } catch {
      return null;
    }

    const github = normalizeGithubHttpsRemote(remote);
    if (github) return github;

    // Local filesystem remote — follow one hop (e.g. mirror → worktree with GitHub origin).
    if (remote.startsWith("/") || remote.startsWith("file://")) {
      cwd = remote.replace(/^file:\/\//, "");
      continue;
    }
    return null;
  }
  return null;
}

/** Citation URL for a commit — GitHub when known, else stable local:// provenance. */
export function commitCitationUrl(opts: {
  githubHttpsBase: string | null;
  repoSlug: string;
  sha: string;
}): string {
  if (opts.githubHttpsBase) {
    return `${opts.githubHttpsBase.replace(/\/$/, "")}/commit/${opts.sha}`;
  }
  const slug = opts.repoSlug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "repo";
  return `local://${slug}/commit/${opts.sha}`;
}
