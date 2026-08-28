import { describe, expect, it } from "vitest";
import { commitCitationUrl, normalizeGithubHttpsRemote } from "../src/lib/citation-url.js";

describe("citation-url", () => {
  it("normalizes SSH and HTTPS GitHub remotes", () => {
    expect(normalizeGithubHttpsRemote("git@github.com:Jassu78/Pdf-Worker.git")).toBe(
      "https://github.com/Jassu78/Pdf-Worker",
    );
    expect(normalizeGithubHttpsRemote("https://github.com/Jassu78/Pdf-Worker.git")).toBe(
      "https://github.com/Jassu78/Pdf-Worker",
    );
  });

  it("builds GitHub commit citations when base is known", () => {
    expect(
      commitCitationUrl({
        githubHttpsBase: "https://github.com/Jassu78/Pdf-Worker",
        repoSlug: "local/Pdf-Worker",
        sha: "abc123",
      }),
    ).toBe("https://github.com/Jassu78/Pdf-Worker/commit/abc123");
  });

  it("falls back to local:// provenance without inventing GitHub URLs", () => {
    expect(
      commitCitationUrl({
        githubHttpsBase: null,
        repoSlug: "local/chatbot-api",
        sha: "deadbeef",
      }),
    ).toBe("local://local-chatbot-api/commit/deadbeef");
  });
});
