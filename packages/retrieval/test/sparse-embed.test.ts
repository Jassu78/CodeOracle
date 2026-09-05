import { describe, expect, it } from "vitest";
import {
  splitIdentifierToken,
  textToSparseVector,
  tokenizeForSparse,
} from "../src/sparse-embed.js";

describe("sparse-embed", () => {
  it("splits camelCase and snake_case identifiers", () => {
    expect(splitIdentifierToken("verifyGitHubSignature")).toEqual(
      expect.arrayContaining(["verifygithubsignature", "verify", "git", "hub", "signature"]),
    );
    // NASA acronym + camel: fetchNASAData → fetch, nasa, data
    expect(splitIdentifierToken("fetchNASAData")).toEqual(
      expect.arrayContaining(["fetchnasadata", "fetch", "nasa", "data"]),
    );
  });

  it("tokenizes identifiers so NL bags overlap symbols (Q1)", () => {
    const symbolTokens = new Set(tokenizeForSparse("verifyGitHubSignature"));
    const nlTokens = tokenizeForSparse("where do we verify GitHub webhook HMAC signatures");
    expect(nlTokens.some((t) => symbolTokens.has(t))).toBe(true);
    expect(symbolTokens.has("verify")).toBe(true);
    expect(symbolTokens.has("signature")).toBe(true);
  });

  it("tokenizes identifiers and numbers", () => {
    const tokens = tokenizeForSparse("fetchNASAData_v2(42)");
    expect(tokens).toEqual(expect.arrayContaining(["fetch", "nasa", "data", "v2", "42"]));
  });

  it("builds sorted sparse indices with term frequencies", () => {
    const sparse = textToSparseVector("foo bar foo");
    expect(sparse.indices.length).toBe(2);
    expect(sparse.indices).toEqual([...sparse.indices].sort((a, b) => a - b));
    expect(sparse.values.some((v) => v === 2)).toBe(true);
  });
});
