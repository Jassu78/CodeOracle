import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureCloneDir, pruneStaleClones } from "../src/crawler/github-clone.js";

describe("clone directory pruning", () => {
  it("removes oldest clone dirs over maxRepos", async () => {
    const root = await mkdtemp(join(tmpdir(), "codeoracle-clone-"));
    try {
      for (let i = 0; i < 3; i++) {
        const dir = join(root, `repo-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, ".git"), "");
        const t = new Date(Date.now() - (3 - i) * 60_000);
        await utimes(dir, t, t);
      }

      await pruneStaleClones(root, 2);
      const { readdir } = await import("node:fs/promises");
      const remaining = await readdir(root);
      expect(remaining).toHaveLength(2);
      expect(remaining).not.toContain("repo-0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ensureCloneDir applies pruning hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "codeoracle-clone-"));
    try {
      await ensureCloneDir(root, 1);
      await mkdir(join(root, "a"), { recursive: true });
      await mkdir(join(root, "b"), { recursive: true });
      await ensureCloneDir(root, 1);
      const { readdir } = await import("node:fs/promises");
      expect((await readdir(root)).length).toBeLessThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
