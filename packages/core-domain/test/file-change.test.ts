import { describe, expect, it } from "vitest";
import { classifyGithubCompareFiles, classifyNameStatusLines } from "../src/file-change.js";

describe("classifyNameStatusLines", () => {
  it("maps A/M/D/R/C statuses", () => {
    expect(
      classifyNameStatusLines([
        "A\tnew.ts",
        "M\tedit.ts",
        "D\tgone.ts",
        "R100\told.ts\trenamed.ts",
        "C50\tsrc.ts\tcopy.ts",
      ]),
    ).toEqual([
      { path: "new.ts", kind: "added" },
      { path: "edit.ts", kind: "modified" },
      { path: "gone.ts", kind: "deleted" },
      { path: "old.ts", kind: "deleted" },
      { path: "renamed.ts", kind: "added" },
      { path: "copy.ts", kind: "added" },
    ]);
  });
});

describe("classifyGithubCompareFiles", () => {
  it("maps GitHub compare file statuses", () => {
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
