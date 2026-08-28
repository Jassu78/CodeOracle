import { mkdir, readdir, stat, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function ensureCloneDir(cloneRoot: string, maxRepos = 50): Promise<void> {
  await mkdir(cloneRoot, { recursive: true });
  await pruneStaleClones(cloneRoot, maxRepos);
}

/** G2.17 — evict oldest clone dirs when over capacity. */
export async function pruneStaleClones(cloneRoot: string, maxRepos: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(cloneRoot);
  } catch {
    return;
  }

  const dirs = await Promise.all(
    entries.map(async (name) => {
      const path = join(cloneRoot, name);
      try {
        const s = await stat(path);
        if (!s.isDirectory()) return null;
        return { path, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const sorted = dirs.filter(Boolean).sort((a, b) => a!.mtimeMs - b!.mtimeMs) as {
    path: string;
    mtimeMs: number;
  }[];

  const excess = sorted.length - maxRepos;
  if (excess <= 0) return;

  for (const dir of sorted.slice(0, excess)) {
    await rm(dir.path, { recursive: true, force: true });
  }
}

export async function cloneGithubRepo(opts: {
  cloneRoot: string;
  githubFullName: string;
  branch: string;
  pat: string;
  /** Commits retained for deterministic path lookup during extract. Default 200. */
  historyDepth?: number;
}): Promise<string> {
  const depth = Math.max(1, opts.historyDepth ?? 200);
  const depthArg = String(depth);
  const target = join(opts.cloneRoot, opts.githubFullName.replace("/", "__"));
  const authUrl = `https://x-access-token:${opts.pat}@github.com/${opts.githubFullName}.git`;
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

  try {
    await access(join(target, ".git"));
    await execFileAsync("git", ["fetch", "origin", opts.branch, "--depth", depthArg], {
      cwd: target,
      env: gitEnv,
    });
    await execFileAsync("git", ["checkout", opts.branch], { cwd: target, env: gitEnv });
    await execFileAsync("git", ["reset", "--hard", `origin/${opts.branch}`], {
      cwd: target,
      env: gitEnv,
    });
    return target;
  } catch {
    await execFileAsync(
      "git",
      ["clone", "--depth", depthArg, "--branch", opts.branch, authUrl, target],
      { env: gitEnv },
    );
    return target;
  }
}

export function resolveRepoRoot(opts: {
  localClonePath?: string | null;
  cloneRoot: string;
  githubFullName: string;
}): string {
  if (opts.localClonePath) return opts.localClonePath;
  return join(opts.cloneRoot, opts.githubFullName.replace("/", "__"));
}
