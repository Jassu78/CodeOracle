import { describe, expect, it } from "vitest";
import {
  escapeIlikePattern,
  isExtensionOnlyQuery,
  lexicalEvidenceForKind,
  looksLikeFilePath,
  normalizeLexicalQuery,
  scoreLexicalRow,
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
    expect(isExtensionOnlyQuery(".ts")).toBe(true);
    expect(isExtensionOnlyQuery("e.ts")).toBe(false);
  });

  it("maps match kinds to P0-B evidence credit (E1)", () => {
    expect(lexicalEvidenceForKind("symbol_exact")).toBe(1);
    expect(lexicalEvidenceForKind("path_exact")).toBe(1);
    expect(lexicalEvidenceForKind("path_suffix")).toBe(1);
    expect(lexicalEvidenceForKind("symbol_soft")).toBe(0.4);
    expect(lexicalEvidenceForKind("content")).toBe(0);
  });

  it("scores symbol/path exact and rejects extension-only path_suffix (F1)", () => {
    const row = {
      id: "1",
      filePath: "apps/api/src/webhooks/github-signature.ts",
      symbolName: "verifyGitHubSignature",
      content: "export function verifyGitHubSignature() {}",
    };
    expect(scoreLexicalRow(row, "verifyGitHubSignature")?.matchKind).toBe("symbol_exact");
    expect(scoreLexicalRow(row, "github-signature.ts")?.matchKind).toBe("path_exact");
    expect(scoreLexicalRow(row, "apps/api/src/webhooks/github-signature.ts")?.matchKind).toBe(
      "path_exact",
    );
    expect(scoreLexicalRow(row, "webhooks/github-signature.ts")?.matchKind).toBe("path_suffix");
    expect(scoreLexicalRow(row, "e.ts")).toBeNull();
    expect(scoreLexicalRow(row, ".ts")).toBeNull();
  });
});
