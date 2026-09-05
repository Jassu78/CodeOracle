import { describe, expect, it } from "vitest";
import { diversifyByFilePath } from "../src/diversify-paths.js";

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
    expect(out.map((h) => h.filePath)).toEqual([
      "apps/api/README.md",
      "README.md",
      "apps/api/src/webhooks/github-signature.ts",
    ]);
  });

  it("skips blank paths", () => {
    expect(
      diversifyByFilePath([{ filePath: "  " }, { filePath: "a.ts" }], 5).map((h) => h.filePath),
    ).toEqual(["a.ts"]);
  });
});
