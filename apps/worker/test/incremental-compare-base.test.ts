import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { afterEach, describe, expect, it } from "vitest";
import { resolveIncrementalCompareBase } from "../src/processors/incremental-reindex.js";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d3527f25fb579";

describe("resolveIncrementalCompareBase", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function initRepo(): Promise<{ root: string; head: string; mainTip: string }> {
    dir = await mkdtemp(join(tmpdir(), "co-inc-base-"));
    const git = async (...args: string[]) =>
      execFileAsync("git", args, { cwd: dir, encoding: "utf8" });
    await git("init");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(dir!, "a.txt"), "a\n");
    await git("add", "a.txt");
    await git("commit", "-m", "main");
    await git("branch", "-M", "main");
    const { stdout: mainTip } = await git("rev-parse", "HEAD");
    await writeFile(join(dir!, "b.txt"), "b\n");
    await git("checkout", "-b", "feature");
    await git("add", "b.txt");
    await git("commit", "-m", "feature");
    const { stdout: head } = await git("rev-parse", "HEAD");
    return { root: dir!, head: head.trim(), mainTip: mainTip.trim() };
  }

  it("returns beforeSha unchanged when not zero", async () => {
    const { root, head } = await initRepo();
    const base = await resolveIncrementalCompareBase({
      repoRoot: root,
      defaultBranch: "main",
      beforeSha: "abc123",
      afterSha: head,
    });
    expect(base).toBe("abc123");
  });

  it("uses merge-base with default branch for branch-create (zero before)", async () => {
    const { root, head, mainTip } = await initRepo();
    const base = await resolveIncrementalCompareBase({
      repoRoot: root,
      defaultBranch: "main",
      beforeSha: ZERO_SHA,
      afterSha: head,
    });
    expect(base).toBe(mainTip);
  });

  it("materializes empty tree when merge-base is unavailable", async () => {
    dir = await mkdtemp(join(tmpdir(), "co-inc-empty-"));
    const git = async (...args: string[]) =>
      execFileAsync("git", args, { cwd: dir, encoding: "utf8" });
    await git("init");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(join(dir!, "only.txt"), "x\n");
    await git("add", "only.txt");
    await git("commit", "-m", "orphan");
    const { stdout: head } = await git("rev-parse", "HEAD");

    const base = await resolveIncrementalCompareBase({
      repoRoot: dir!,
      defaultBranch: "does-not-exist",
      beforeSha: ZERO_SHA,
      afterSha: head.trim(),
    });
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    // Object must be resolvable for a subsequent git diff.
    await git("rev-parse", "--verify", `${base}^{tree}`);
  });
});
