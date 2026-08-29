import { describe, expect, it } from "vitest";
import {
  SAMPLE_REPO_FINAL_PATHS,
  SAMPLE_REPO_HISTORY,
  assertCheckedInTreeMatchesHistory,
  buildSampleRepo,
} from "./build.js";

describe("sample-repo fixture (D5.1)", () => {
  it("encodes at least five commits with WHY bodies", () => {
    expect(SAMPLE_REPO_HISTORY.length).toBeGreaterThanOrEqual(5);
    const whyCommits = SAMPLE_REPO_HISTORY.filter((s) => s.message.includes("\n\n"));
    expect(whyCommits.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps checked-in tree/ in sync with history", async () => {
    await assertCheckedInTreeMatchesHistory();
  });

  it("materializes a git repo with expected final paths and stable origin", async () => {
    const repo = await buildSampleRepo();
    try {
      expect(repo.commitShas.length).toBe(SAMPLE_REPO_HISTORY.length);
      expect(repo.commitShas[0]).toMatch(/^[0-9a-f]{40}$/);

      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      for (const rel of SAMPLE_REPO_FINAL_PATHS) {
        const body = await readFile(join(repo.root, rel), "utf8");
        expect(body.length).toBeGreaterThan(0);
      }

      const { stdout: remote } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: repo.root,
      });
      expect(remote.trim()).toContain("github.com/codeoracle-test/sample-repo");

      // Re-build with same dates → same tip SHA (determinism).
      const again = await buildSampleRepo();
      try {
        expect(again.commitShas[0]).toBe(repo.commitShas[0]);
      } finally {
        await again.cleanup();
      }
    } finally {
      await repo.cleanup();
    }
  });
});
