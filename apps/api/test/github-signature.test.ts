import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "../src/webhooks/github-signature.js";

describe("verifyGitHubSignature", () => {
  const secret = "test-webhook-secret";
  const body = Buffer.from('{"ref":"refs/heads/main","before":"aaa","after":"bbb"}', "utf8");

  function sign(raw: Buffer, key: string): string {
    return `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;
  }

  it("accepts a valid signature", () => {
    expect(verifyGitHubSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects wrong secret, missing header, or tampered body", () => {
    expect(verifyGitHubSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyGitHubSignature(body, undefined, secret)).toBe(false);
    expect(verifyGitHubSignature(body, "sha1=dead", secret)).toBe(false);
    const tampered = Buffer.from(body.toString("utf8") + " ", "utf8");
    expect(verifyGitHubSignature(tampered, sign(body, secret), secret)).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifyGitHubSignature(body, sign(body, secret), "")).toBe(false);
  });
});
