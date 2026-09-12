import { describe, expect, it } from "vitest";
import { isDecisionShapedDocPath } from "../src/decision-shaped-doc-path.js";

describe("isDecisionShapedDocPath", () => {
  it("matches SAFETY.md and ARCHITECTURE.md anywhere (case-insensitive)", () => {
    expect(isDecisionShapedDocPath("SAFETY.md")).toBe(true);
    expect(isDecisionShapedDocPath("apps/api/safety.md")).toBe(true);
    expect(isDecisionShapedDocPath("docs/ARCHITECTURE.md")).toBe(true);
    expect(isDecisionShapedDocPath("packages/core/Architecture.md")).toBe(true);
  });

  it("matches ADR*.md basename prefix only", () => {
    expect(isDecisionShapedDocPath("docs/adr/ADR-001-auth.md")).toBe(true);
    expect(isDecisionShapedDocPath("ADR0001.md")).toBe(true);
    expect(isDecisionShapedDocPath("adr-notes.md")).toBe(true);
    expect(isDecisionShapedDocPath("docs/address.md")).toBe(false);
    expect(isDecisionShapedDocPath("docs/ADR001.txt")).toBe(false);
  });

  it("matches markdown under docs/**/decisions/**", () => {
    expect(isDecisionShapedDocPath("docs/decisions/2024-01-auth.md")).toBe(true);
    expect(isDecisionShapedDocPath("docs/arch/decisions/foo.md")).toBe(true);
    expect(isDecisionShapedDocPath("docs/decisions/nested/bar.MD")).toBe(true);
    expect(isDecisionShapedDocPath("docs/decisions/notes.txt")).toBe(false);
    expect(isDecisionShapedDocPath("docs/other/foo.md")).toBe(false);
  });

  it("rejects unrelated paths", () => {
    expect(isDecisionShapedDocPath("README.md")).toBe(false);
    expect(isDecisionShapedDocPath("src/config/env.ts")).toBe(false);
    expect(isDecisionShapedDocPath("")).toBe(false);
  });
});
