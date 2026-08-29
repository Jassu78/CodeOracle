import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Builds a tiny, scripted git repo with a deterministic commit history —
 * built fresh in a temp dir per test run rather than checked in, so the
 * `.git` internals never need to live in this repo's own git history
 * (D5.1: "a handful of files + a scripted commit/PR history", not a
 * checked-in nested repo). A fake `origin` remote (local git config only,
 * no network call) gives commits real-looking `https://github.com/...`
 * citation URLs — see `apps/worker/src/lib/citation-url.ts`.
 */
export type SampleRepo = {
  root: string;
  cleanup: () => Promise<void>;
};

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

export async function buildSampleGitRepo(): Promise<SampleRepo> {
  const root = await mkdtemp(join(tmpdir(), "codeoracle-e2e-"));

  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "ci@codeoracle.test"]);
  await git(root, ["config", "user.name", "CodeOracle CI"]);
  await git(root, [
    "remote",
    "add",
    "origin",
    "https://github.com/codeoracle-test/sample-repo.git",
  ]);

  await writeFile(
    join(root, "README.md"),
    "# sample-repo\n\nFixture repo for CodeOracle CI integration tests.\n",
  );
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "chore: scaffold sample repo"]);

  await writeFile(
    join(root, "cache.ts"),
    [
      "export function lookup(key: string): string | undefined {",
      "  return undefined;",
      "}",
      "",
    ].join("\n"),
  );
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "-m",
    "feat: add lookup function\n\nBaseline lookup with no caching yet.",
  ]);

  await writeFile(
    join(root, "cache.ts"),
    [
      "const cache = new Map<string, string>();",
      "",
      "export function lookup(key: string): string | undefined {",
      "  if (cache.has(key)) return cache.get(key);",
      "  const value = computeExpensiveValue(key);",
      "  cache.set(key, value);",
      "  return value;",
      "}",
      "",
      "function computeExpensiveValue(key: string): string {",
      "  return `computed:${key}`;",
      "}",
      "",
    ].join("\n"),
  );
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "-m",
    "feat: add in-memory cache to lookup\n\nAvoid recomputing the same expensive value on every call by caching results in memory instead of adding an external Redis dependency for this MVP.",
  ]);

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
