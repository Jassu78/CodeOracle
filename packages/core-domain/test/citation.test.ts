import { describe, expect, it } from "vitest";
import { isCitationUrl } from "../src/citation.js";

describe("isCitationUrl", () => {
  it("accepts http/https URLs", () => {
    expect(isCitationUrl("https://github.com/org/repo/commit/abc123")).toBe(true);
    expect(isCitationUrl("http://example.com")).toBe(true);
  });

  it("rejects non-http(s) schemes — e.g. local:// provenance placeholders", () => {
    expect(isCitationUrl("local://repo/commit/abc123")).toBe(false);
    expect(isCitationUrl("ftp://example.com")).toBe(false);
  });

  it("rejects malformed or empty strings", () => {
    expect(isCitationUrl("")).toBe(false);
    expect(isCitationUrl("not a url")).toBe(false);
  });
});
