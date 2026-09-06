import { describe, expect, it } from "vitest";
import { diversifyByFilePath } from "../src/diversify-paths.js";
import {
  classifyPathContent,
  maxDocSlotsForLimit,
} from "../src/path-content-class.js";

describe("classifyPathContent", () => {
  it("marks markdown and README names as docs", () => {
    expect(classifyPathContent("README.md")).toBe("doc");
    expect(classifyPathContent("apps/api/README.md")).toBe("doc");
    expect(classifyPathContent("docs/guide.rst")).toBe("doc");
    expect(classifyPathContent("README")).toBe("doc");
  });

  it("marks code paths as source", () => {
    expect(classifyPathContent("apps/api/src/lib/auth.ts")).toBe("source");
    expect(classifyPathContent("pkg/main.go")).toBe("source");
  });
});

describe("maxDocSlotsForLimit", () => {
  it("reserves room for source when limit > 1", () => {
    expect(maxDocSlotsForLimit(3)).toBe(1);
    expect(maxDocSlotsForLimit(5)).toBe(2);
    expect(maxDocSlotsForLimit(1)).toBe(1);
  });
});

describe("diversifyByFilePath", () => {
  it("keeps first hit per path and fills from later unique paths", () => {
    const items = [
      { filePath: "apps/api/README.md", score: 0.58 },
      { filePath: "README.md", score: 0.47 },
      { filePath: "apps/api/README.md", score: 0.24 },
      { filePath: "apps/api/src/webhooks/github-signature.ts", score: 0.237 },
      { filePath: "scripts/mirror-local-repo.sh", score: 0.16 },
    ];
    const out = diversifyByFilePath(items, 3);
    // Doc quota floor(3/2)=1 → leading doc, then sources (not two docs first).
    expect(out.map((h) => h.filePath)).toEqual([
      "apps/api/README.md",
      "apps/api/src/webhooks/github-signature.ts",
      "scripts/mirror-local-repo.sh",
    ]);
  });

  it("skips blank paths", () => {
    expect(
      diversifyByFilePath([{ filePath: "  " }, { filePath: "a.ts" }], 5).map((h) => h.filePath),
    ).toEqual(["a.ts"]);
  });

  it("breaks doc dual monopoly when source remains (Q1 R4 class)", () => {
    const items = [
      { filePath: "README.md", id: "d1" },
      { filePath: "apps/api/README.md", id: "d2" },
      { filePath: "apps/mcp-server/src/transport/http.ts", id: "src" },
      { filePath: "packages/db/src/repositories/api-tokens.ts", id: "tok" },
    ];
    const out = diversifyByFilePath(items, 3);
    expect(out.map((h) => h.filePath)).toEqual([
      "README.md",
      "apps/mcp-server/src/transport/http.ts",
      "packages/db/src/repositories/api-tokens.ts",
    ]);
    expect(out.filter((h) => classifyPathContent(h.filePath) === "doc")).toHaveLength(1);
  });

  it("lifts doc quota when the pool has no source (doc-intent)", () => {
    const items = [
      { filePath: "README.md" },
      { filePath: "apps/api/README.md" },
      { filePath: "CONTRIBUTING.md" },
    ];
    expect(diversifyByFilePath(items, 3).map((h) => h.filePath)).toEqual([
      "README.md",
      "apps/api/README.md",
      "CONTRIBUTING.md",
    ]);
  });
});
