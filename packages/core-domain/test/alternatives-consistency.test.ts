import { describe, expect, it } from "vitest";
import {
  classifyAlternativesQuality,
  isAlternativesInconsistent,
  textHasContrastCue,
} from "../src/alternatives-consistency.js";

describe("textHasContrastCue", () => {
  it("detects common contrast phrases", () => {
    expect(textHasContrastCue("Use Redis rather than an in-process Map")).toBe(true);
    expect(textHasContrastCue("Chose JWTs instead of server sessions")).toBe(true);
    expect(textHasContrastCue("Picked Postgres over SQLite")).toBe(true);
    expect(textHasContrastCue("Rejected unverified webhooks")).toBe(true);
  });

  it("does not flag ordinary rationale without a contrast", () => {
    expect(textHasContrastCue("Added HMAC verification for GitHub push webhooks.")).toBe(false);
    expect(textHasContrastCue("Enforce a daily token budget for extract jobs.")).toBe(false);
    expect(
      textHasContrastCue("Skip commits already covered at queue time, avoiding redundant extract."),
    ).toBe(false);
  });
});

describe("isAlternativesInconsistent", () => {
  it("is false when alternatives are present", () => {
    expect(
      isAlternativesInconsistent({
        summary: "Chose A rather than B",
        alternativesConsidered: ["B"],
        sourceBody: "Chose A rather than B",
      }),
    ).toBe(false);
  });

  it("flags empty alts when summary asserts contrast (P1)", () => {
    expect(
      isAlternativesInconsistent({
        summary:
          "Implemented generic high-entropy-token redaction rather than relying solely on fixed patterns.",
        alternativesConsidered: [],
      }),
    ).toBe(true);
  });

  it("flags empty alts when source body asserts contrast even if summary does not", () => {
    expect(
      isAlternativesInconsistent({
        summary: "Keep extraction resilient under provider outages.",
        alternativesConsidered: [],
        sourceTitle: "Gateway failover",
        sourceBody: "Failover across OpenAI-compatible endpoints instead of failing hard on primary.",
      }),
    ).toBe(true);
  });

  it("allows true empty when neither source nor summary contrasts", () => {
    expect(
      isAlternativesInconsistent({
        summary: "Added NUL git-log parse tests for robustness.",
        alternativesConsidered: [],
        sourceBody: "Add tests for NUL-delimited git log parsing.",
      }),
    ).toBe(false);
  });

  it("ignores whitespace-only alternatives", () => {
    expect(
      isAlternativesInconsistent({
        summary: "Use A rather than B",
        alternativesConsidered: ["  ", ""],
      }),
    ).toBe(true);
  });
});

describe("classifyAlternativesQuality", () => {
  it("buckets filled / inconsistent / true_empty", () => {
    expect(
      classifyAlternativesQuality({
        summary: "x",
        alternativesConsidered: ["Y"],
      }),
    ).toBe("filled");
    expect(
      classifyAlternativesQuality({
        summary: "x rather than y",
        alternativesConsidered: [],
      }),
    ).toBe("inconsistent");
    expect(
      classifyAlternativesQuality({
        summary: "plain why",
        alternativesConsidered: [],
        sourceBody: "plain why with no options",
      }),
    ).toBe("true_empty");
  });
});
