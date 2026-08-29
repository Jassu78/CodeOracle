import { describe, expect, it } from "vitest";
import { classifyGithubCompareFiles, classifyNameStatusLines } from "../src/lib/classify-diff.js";

describe("classifyNameStatusLines", () => {
  it("classifies A/M/D and renames", () => {
    expect(
      classifyNameStatusLines([
        "A\tsrc/new.ts",
        "M\tsrc/old.ts",
        "D\tgone.ts",
        "R100\told/name.ts\tnew/name.ts",
      ]),
    ).toEqual([
      { path: "src/new.ts", kind: "added" },
      { path: "src/old.ts", kind: "modified" },
      { path: "gone.ts", kind: "deleted" },
      { path: "old/name.ts", kind: "deleted" },
      { path: "new/name.ts", kind: "added" },
    ]);
  });
});

describe("classifyGithubCompareFiles", () => {
  it("maps GitHub compare statuses", () => {
    expect(
      classifyGithubCompareFiles([
        { filename: "a.ts", status: "added" },
        { filename: "b.ts", status: "modified" },
        { filename: "c.ts", status: "removed" },
        { filename: "d2.ts", status: "renamed", previous_filename: "d1.ts" },
      ]),
    ).toEqual([
      { path: "a.ts", kind: "added" },
      { path: "b.ts", kind: "modified" },
      { path: "c.ts", kind: "deleted" },
      { path: "d1.ts", kind: "deleted" },
      { path: "d2.ts", kind: "added" },
    ]);
  });
});
