import { describe, expect, it } from "vitest";
import { parseNulDelimitedGitLog } from "../src/crawler/github-history.js";

describe("parseNulDelimitedGitLog", () => {
  it("keeps multiline bodies without corrupting the next SHA", () => {
    const stdout = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "feat: add sessions",
      "Because Redis flaked under load.\n\nAlso document the TTL.",
      "2026-08-01T12:00:00+00:00",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "fix: null check",
      "",
      "2026-08-02T12:00:00+00:00",
      "", // trailing empty after final NUL
    ].join("\0");

    const commits = parseNulDelimitedGitLog(stdout);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subject: "feat: add sessions",
      body: "Because Redis flaked under load.\n\nAlso document the TTL.",
    });
    expect(commits[1]).toMatchObject({
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      subject: "fix: null check",
      body: "",
    });
  });

  it("skips garbage segments that are not SHAs", () => {
    const stdout = ["not-a-sha", "x", "y", "z", ""].join("\0");
    expect(parseNulDelimitedGitLog(stdout)).toEqual([]);
  });
});
