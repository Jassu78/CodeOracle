import { describe, expect, it } from "vitest";
import {
  DOC_INDEX_CONFIDENCE,
  buildDocDecisionDrafts,
  githubBlobCitationUrl,
} from "../src/lib/build-doc-decisions.js";

describe("buildDocDecisionDrafts", () => {
  it("uses filename topic when there are no H2 sections", () => {
    const drafts = buildDocDecisionDrafts(
      "docs/SAFETY.md",
      "# Safety\n\nWe use Model Armor and Presidio for PII.\n",
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.topic).toBe("SAFETY");
    expect(drafts[0]!.summary).toContain("Model Armor");
    expect(drafts[0]!.confidence).toBe(DOC_INDEX_CONFIDENCE);
    expect(drafts[0]!.touchedPaths).toEqual(["docs/SAFETY.md"]);
  });

  it("splits on H2 headings", () => {
    const source = [
      "# Intro",
      "preamble",
      "",
      "## Model Armor",
      "Use Model Armor for prompt injection.",
      "",
      "## Presidio",
      "Use Presidio for PII.",
      "",
    ].join("\n");
    const drafts = buildDocDecisionDrafts("SAFETY.md", source);
    expect(drafts.map((d) => d.topic)).toEqual(["Model Armor", "Presidio"]);
    expect(drafts[0]!.startLine).toBe(4);
    expect(drafts[1]!.summary).toContain("Presidio");
  });
});

describe("githubBlobCitationUrl", () => {
  it("builds https blob URLs with optional line fragment", () => {
    expect(
      githubBlobCitationUrl({
        githubHttpsBase: "https://github.com/acme/app",
        sha: "abc123",
        filePath: "docs/SAFETY.md",
        startLine: 12,
      }),
    ).toBe("https://github.com/acme/app/blob/abc123/docs/SAFETY.md#L12");
  });
});
