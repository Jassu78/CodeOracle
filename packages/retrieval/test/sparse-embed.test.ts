import { describe, expect, it } from "vitest";
import {
  BM25_AVGDL,
  BM25_K1,
  SPARSE_ENCODER_VERSION,
  bm25TermFrequency,
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

  it("builds sorted sparse indices with query raw TF", () => {
    const sparse = textToSparseVector("foo bar foo", { role: "query" });
    expect(sparse.indices.length).toBe(2);
    expect(sparse.indices).toEqual([...sparse.indices].sort((a, b) => a - b));
    expect(sparse.values.some((v) => v === 2)).toBe(true);
  });

  it("exports a stable sparse encoder version string (E3)", () => {
    expect(SPARSE_ENCODER_VERSION).toBe("bm25-tf-v1");
  });

  it("saturates BM25 TF so repeated terms do not grow linearly (E3)", () => {
    const once = bm25TermFrequency(1, 10);
    const many = bm25TermFrequency(50, 10);
    expect(once).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(once);
    // Raw TF would be 50×; BM25 must stay well below that.
    expect(many).toBeLessThan(BM25_K1 + 1 + 0.01);
    expect(many / once).toBeLessThan(10);
  });

  it("length-normalizes BM25 TF (longer docs down-weight same tf)", () => {
    const shortDoc = bm25TermFrequency(3, 20, { avgdl: BM25_AVGDL });
    const longDoc = bm25TermFrequency(3, 400, { avgdl: BM25_AVGDL });
    expect(shortDoc).toBeGreaterThan(longDoc);
  });

  it("document role uses BM25 weights; query role keeps raw TF (E3)", () => {
    const text = "alpha beta alpha";
    const doc = textToSparseVector(text, { role: "document" });
    const query = textToSparseVector(text, { role: "query" });
    expect(doc.indices).toEqual(query.indices);
    expect(query.values.some((v) => v === 2)).toBe(true);
    // BM25(tf=2) < raw 2 for typical params
    const docMax = Math.max(...doc.values);
    expect(docMax).toBeLessThan(2);
    expect(docMax).toBeGreaterThan(0);
  });
});
