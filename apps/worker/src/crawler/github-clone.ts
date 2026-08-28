import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function ensureCloneDir(cloneRoot: string): Promise<void> {
  await mkdir(cloneRoot, { recursive: true });
}

export async function cloneGithubRepo(opts: {
  cloneRoot: string;
  githubFullName: string;
  branch: string;
  pat: string;
}): Promise<string> {
  const target = join(opts.cloneRoot, opts.githubFullName.replace("/", "__"));
  const authUrl = `https://x-access-token:${opts.pat}@github.com/${opts.githubFullName}.git`;
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

  try {
    await access(join(target, ".git"));
    await execFileAsync("git", ["fetch", "origin", opts.branch, "--depth", "1"], { cwd: target, env: gitEnv });
    await execFileAsync("git", ["checkout", opts.branch], { cwd: target, env: gitEnv });
    await execFileAsync("git", ["reset", "--hard", `origin/${opts.branch}`], { cwd: target, env: gitEnv });
    return target;
  } catch {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", opts.branch, authUrl, target], {
      env: gitEnv,
    });
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
