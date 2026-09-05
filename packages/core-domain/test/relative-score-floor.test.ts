import { describe, expect, it } from "vitest";
import {
  DECISION_RELATIVE_SCORE_FLOOR,
  applyRelativeScoreFloor,
  decisionSearchFetchLimit,
} from "../src/relative-score-floor.js";

describe("applyRelativeScoreFloor", () => {
  it("drops the long tail far below top (Q2 HMAC shape)", () => {
    const hits = [
      { id: "hmac", score: 0.89 },
      { id: "dup-source", score: 0.57 },
      { id: "auth", score: 0.53 },
      { id: "redact", score: 0.5 },
    ];
    const cut = applyRelativeScoreFloor(hits, {
      relativeFloor: DECISION_RELATIVE_SCORE_FLOOR,
      limit: 3,
    });
    expect(cut.map((h) => h.id)).toEqual(["hmac"]);
  });

  it("keeps near-ties within the floor band (Q2 hybrid shape)", () => {
    const hits = [
      { id: "rrf-activate", score: 0.765 },
      { id: "rrf-filter", score: 0.763 },
      { id: "backfill", score: 0.625 },
    ];
    const cut = applyRelativeScoreFloor(hits, {
      relativeFloor: 0.85,
      limit: 3,
    });
    expect(cut.map((h) => h.id)).toEqual(["rrf-activate", "rrf-filter"]);
  });

  it("keeps an on-topic cluster then caps by limit", () => {
    const hits = [
      { id: "a", score: 0.8 },
      { id: "b", score: 0.77 },
      { id: "c", score: 0.7 },
      { id: "d", score: 0.63 },
    ];
    const cut = applyRelativeScoreFloor(hits, { relativeFloor: 0.85, limit: 3 });
    expect(cut.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("returns empty for empty input or non-positive limit", () => {
    expect(applyRelativeScoreFloor([], { limit: 3 })).toEqual([]);
    expect(applyRelativeScoreFloor([{ score: 1 }], { limit: 0 })).toEqual([]);
  });
});

describe("decisionSearchFetchLimit", () => {
  it("over-fetches relative to display limit", () => {
    expect(decisionSearchFetchLimit(3)).toBe(8);
    expect(decisionSearchFetchLimit(5)).toBe(10);
  });
});
