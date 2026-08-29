import { describe, expect, it } from "vitest";
import { isTrivialSourceMessage } from "../src/trivial-source.js";

describe("isTrivialSourceMessage", () => {
  it("flags chore/ci/typo/merge/lockfile subjects", () => {
    expect(isTrivialSourceMessage("chore: bump lodash to 4.17.21")).toBe(true);
    expect(isTrivialSourceMessage("ci: tweak workflow timeout")).toBe(true);
    expect(isTrivialSourceMessage("fix: typo in README")).toBe(true);
    expect(isTrivialSourceMessage("Merge branch 'main' into feature")).toBe(true);
    expect(isTrivialSourceMessage("chore: update package-lock.json")).toBe(true);
    expect(isTrivialSourceMessage("Merge pull request #12 from foo/bar", "")).toBe(true);
  });

  it("flags dependabot / version-only / format noise", () => {
    expect(isTrivialSourceMessage("chore(deps): bump axios from 1.6.0 to 1.6.1")).toBe(true);
    expect(isTrivialSourceMessage("deps: update lodash")).toBe(true);
    expect(isTrivialSourceMessage("Bump lodash from 4.17.20 to 4.17.21")).toBe(true);
    expect(isTrivialSourceMessage("release: v1.2.3")).toBe(true);
    expect(isTrivialSourceMessage("1.2.3")).toBe(true);
    expect(isTrivialSourceMessage("Apply prettier")).toBe(true);
  });

  it("keeps messages with architectural rationale", () => {
    expect(
      isTrivialSourceMessage(
        "chore: bump redis client because we need cluster mode support",
      ),
    ).toBe(false);
    expect(
      isTrivialSourceMessage("feat: switch session store to Postgres instead of memory"),
    ).toBe(false);
    expect(isTrivialSourceMessage("refactor: extract gating worker modules")).toBe(false);
    expect(
      isTrivialSourceMessage(
        "chore: migrate cache",
        "We are replacing in-memory LRU rather than Redis so that…",
      ),
    ).toBe(false);
  });
});
