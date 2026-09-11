import { describe, expect, it } from "vitest";
import {
  escapeIlikePattern,
  lexicalEvidenceForKind,
  looksLikeFilePath,
  normalizeLexicalQuery,
} from "../src/lexical-query.js";

describe("lexical-query", () => {
  it("normalizes quoted literals", () => {
    expect(normalizeLexicalQuery('"verifyGitHubSignature"')).toBe("verifyGitHubSignature");
    expect(normalizeLexicalQuery("'path/to/file.ts'")).toBe("path/to/file.ts");
    expect(normalizeLexicalQuery("  plain  ")).toBe("plain");
  });

  it("escapes ILIKE metacharacters", () => {
    expect(escapeIlikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("detects path-shaped queries", () => {
    expect(looksLikeFilePath("apps/api/src/x.ts")).toBe(true);
    expect(looksLikeFilePath("github-signature.ts")).toBe(true);
    expect(looksLikeFilePath("verifyGitHubSignature")).toBe(false);
  });

  it("maps match kinds to P0-B evidence credit (E1)", () => {
    expect(lexicalEvidenceForKind("symbol_exact")).toBe(1);
    expect(lexicalEvidenceForKind("path_exact")).toBe(1);
    expect(lexicalEvidenceForKind("path_suffix")).toBe(1);
    expect(lexicalEvidenceForKind("symbol_soft")).toBe(0.4);
    expect(lexicalEvidenceForKind("content")).toBe(0);
  });
});
