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
  });
});
