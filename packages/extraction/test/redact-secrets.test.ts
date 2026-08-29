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

  describe("generic high-entropy token (inline prose secrets)", () => {
    it("redacts a random-looking mixed-case+digit token not matching any known vendor prefix", () => {
      const input = "the key was aB3kX9pQzM2wLtR7vNcYfGhJ8sDdEeQq if you need it";
      const { redacted, hits } = redactSecrets(input);
      expect(redacted).not.toContain("aB3kX9pQzM2wLtR7vNcYfGhJ8sDdEeQq");
      expect(redacted).toContain("[REDACTED:generic_high_entropy_token]");
      expect(hits.some((h) => h.name === "generic_high_entropy_token")).toBe(true);
    });

    it("does NOT redact a git commit SHA (lowercase hex — no legitimate false positive)", () => {
      const input =
        "See commit 58fa8f4f6f11403584c42d35d893ef3d4ab66c0e for the original fix.";
      const { redacted, hits } = redactSecrets(input);
      expect(redacted).toBe(input);
      expect(hits).toHaveLength(0);
    });

    it("does NOT redact a long camelCase identifier with no digits", () => {
      const input = "Renamed computeExpensiveValueFromCachedLookupTable for clarity.";
      const { redacted, hits } = redactSecrets(input);
      expect(redacted).toBe(input);
      expect(hits).toHaveLength(0);
    });

    it("does NOT redact plain lowercase or plain uppercase long tokens", () => {
      const input = "loremipsumdolorsitametconsecteturadipiscingelit AND ANOTHERALLCAPSWORDHERE";
      const { redacted, hits } = redactSecrets(input);
      expect(redacted).toBe(input);
      expect(hits).toHaveLength(0);
    });
  });
});
