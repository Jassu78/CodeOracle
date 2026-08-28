import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact-secrets.js";

describe("redactSecrets", () => {
  it("redacts github PAT and env-style secrets", () => {
    const input = [
      "Use token ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "GITHUB_PAT=supersecretvalue123456789",
    ].join("\n");

    const { redacted, hits } = redactSecrets(input);
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("supersecretvalue");
    expect(redacted).toContain("[REDACTED:github_pat]");
    expect(hits.some((h) => h.name === "github_pat")).toBe(true);
  });

  it("returns unchanged text when no secrets match", () => {
    const input = "Refactor auth middleware for clarity.";
    const { redacted, hits } = redactSecrets(input);
    expect(redacted).toBe(input);
    expect(hits).toHaveLength(0);
  });
});
