import { describe, expect, it } from "vitest";
import { textToSparseVector, tokenizeForSparse } from "../src/sparse-embed.js";

describe("sparse-embed", () => {
  it("tokenizes identifiers and numbers", () => {
    expect(tokenizeForSparse("fetchNASAData_v2(42)")).toEqual(
      expect.arrayContaining(["fetchnasadata_v2", "42"]),
    );
  });

  it("builds sorted sparse indices with term frequencies", () => {
    const sparse = textToSparseVector("foo bar foo");
    expect(sparse.indices.length).toBe(2);
    expect(sparse.indices).toEqual([...sparse.indices].sort((a, b) => a - b));
    expect(sparse.values.some((v) => v === 2)).toBe(true);
  });
});
