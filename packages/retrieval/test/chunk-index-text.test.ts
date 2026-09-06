import { describe, expect, it } from "vitest";
import { chunkIndexText } from "../src/chunk-index-text.js";
import { tokenizeForSparse } from "../src/sparse-embed.js";

describe("chunkIndexText", () => {
  it("prepends path, basename, and symbol before content", () => {
    const text = chunkIndexText({
      filePath: "apps/api/src/lib/auth.ts",
      symbolName: "authorizeForRepo",
      content: "export function authorizeForRepo() {}",
    });
    expect(text.startsWith("apps/api/src/lib/auth.ts\nauth.ts\nauthorizeForRepo\n\n")).toBe(
      true,
    );
    expect(text).toContain("export function authorizeForRepo");
  });

  it("omits empty symbol and duplicate basename when path is bare", () => {
    expect(
      chunkIndexText({ filePath: "main.go", symbolName: null, content: "package main" }),
    ).toBe("main.go\n\npackage main");
  });

  it("lets sparse NL overlap path+symbol for authorize/scope class (R4)", () => {
    // Body-only would miss path tokens like `api` / `auth`; with index text,
    // "per-repo API tokens" shares api+repo with authorizeForRepo @ auth.ts.
    const indexed = chunkIndexText({
      filePath: "apps/api/src/lib/auth.ts",
      symbolName: "authorizeForRepo",
      content:
        "export function authorizeForRepo(principal, repoId, openDev) {\n  return principal.repoId === repoId;\n}",
    });
    const bodyOnly = tokenizeForSparse(
      "export function authorizeForRepo(principal, repoId, openDev) {\n  return principal.repoId === repoId;\n}",
    );
    const withMeta = new Set(tokenizeForSparse(indexed));
    const query = tokenizeForSparse("where do we scope per-repo API tokens");

    expect(withMeta.has("api")).toBe(true);
    expect(withMeta.has("auth")).toBe(true);
    expect(withMeta.has("authorize")).toBe(true);

    const bodySet = new Set(bodyOnly);
    expect(bodySet.has("api")).toBe(false);
    expect(bodySet.has("auth")).toBe(false);

    const overlap = query.filter((t) => withMeta.has(t));
    expect(overlap).toEqual(expect.arrayContaining(["api", "repo"]));
  });
});
