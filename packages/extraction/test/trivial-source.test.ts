import { describe, expect, it } from "vitest";
import { isTrivialSourceMessage } from "../src/trivial-source.js";

describe("isTrivialSourceMessage", () => {
  it("skips version bumps and chore/ci without rationale", () => {
    expect(isTrivialSourceMessage("chore: bump lodash to 4.17.21")).toBe(true);
    expect(isTrivialSourceMessage("ci: tweak workflow timeout")).toBe(true);
    expect(isTrivialSourceMessage("fix: typo in README")).toBe(true);
    expect(isTrivialSourceMessage("Merge branch 'main' into feature")).toBe(true);
    expect(isTrivialSourceMessage("chore: update package-lock.json")).toBe(true);
    expect(isTrivialSourceMessage("Merge pull request #12 from foo/bar", "")).toBe(true);
  });

  it("skips dependabot / renovate / release-only subjects", () => {
    expect(isTrivialSourceMessage("chore(deps): bump axios from 1.6.0 to 1.6.1")).toBe(true);
    expect(isTrivialSourceMessage("deps: update lodash")).toBe(true);
    expect(isTrivialSourceMessage("Bump lodash from 4.17.20 to 4.17.21")).toBe(true);
    expect(isTrivialSourceMessage("release: v1.2.3")).toBe(true);
    expect(isTrivialSourceMessage("1.2.3")).toBe(true);
    expect(isTrivialSourceMessage("Apply prettier")).toBe(true);
  });

  it("keeps architectural / rationale-bearing messages", () => {
    expect(
      isTrivialSourceMessage(
        "chore: replace redis with bullmq",
        "because we need delayed jobs and retries",
      ),
    ).toBe(false);
    expect(
      isTrivialSourceMessage("feat: switch session store to Postgres instead of memory"),
    ).toBe(false);
    expect(isTrivialSourceMessage("refactor: extract gating worker modules")).toBe(false);
    expect(
      isTrivialSourceMessage(
        "chore(deps): bump bullmq",
        "because we need delayed jobs and retries",
      ),
    ).toBe(false);
  });
});
