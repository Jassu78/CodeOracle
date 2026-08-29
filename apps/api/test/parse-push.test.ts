import { describe, expect, it } from "vitest";
import { parseGithubPushPayload } from "../src/webhooks/parse-push.js";

describe("parseGithubPushPayload", () => {
  const base = {
    ref: "refs/heads/main",
    before: "1111111111111111111111111111111111111111",
    after: "2222222222222222222222222222222222222222",
    repository: { full_name: "org/repo" },
  };

  it("parses a branch push", () => {
    const out = parseGithubPushPayload(base);
    expect(out).toEqual({
      ok: true,
      push: {
        ref: "refs/heads/main",
        beforeSha: base.before,
        afterSha: base.after,
        githubFullName: "org/repo",
      },
    });
  });

  it("ignores tags and branch deletions", () => {
    expect(parseGithubPushPayload({ ...base, ref: "refs/tags/v1" }).ok).toBe(false);
    expect(
      parseGithubPushPayload({
        ...base,
        after: "0000000000000000000000000000000000000000",
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(parseGithubPushPayload({}).ok).toBe(false);
    expect(parseGithubPushPayload(null).ok).toBe(false);
  });
});
