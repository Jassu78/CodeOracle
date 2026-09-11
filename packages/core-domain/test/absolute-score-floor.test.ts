import { describe, expect, it } from "vitest";
import {
  DECISION_ABSOLUTE_SCORE_FLOOR,
  SEARCH_ABSOLUTE_SCORE_FLOOR,
  applyAbsoluteTopScoreFloor,
} from "../src/absolute-score-floor.js";

describe("applyAbsoluteTopScoreFloor", () => {
  it("returns empty when top score is below absoluteMin (garbage / xyzzy class)", () => {
    const hits = [{ score: 0.55 }, { score: 0.5 }, { score: 0.4 }];
    expect(
      applyAbsoluteTopScoreFloor(hits, { absoluteMin: DECISION_ABSOLUTE_SCORE_FLOOR }),
    ).toEqual([]);
  });

  it("keeps the list when top score meets absoluteMin (in-domain class)", () => {
    const hits = [{ score: 0.72 }, { score: 0.7 }, { score: 0.4 }];
    expect(
      applyAbsoluteTopScoreFloor(hits, { absoluteMin: DECISION_ABSOLUTE_SCORE_FLOOR }),
    ).toEqual(hits);
  });

  it("empties weak search evidence under SEARCH_ABSOLUTE_SCORE_FLOOR", () => {
    expect(
      applyAbsoluteTopScoreFloor([{ score: 0.12 }, { score: 0.09 }], {
        absoluteMin: SEARCH_ABSOLUTE_SCORE_FLOOR,
      }),
    ).toEqual([]);
    expect(
      applyAbsoluteTopScoreFloor([{ score: 0.4 }, { score: 0.36 }], {
        absoluteMin: SEARCH_ABSOLUTE_SCORE_FLOOR,
      }),
    ).toHaveLength(2);
  });

  it("keeps a hit exactly at the absoluteMin boundary", () => {
    expect(
      applyAbsoluteTopScoreFloor([{ score: SEARCH_ABSOLUTE_SCORE_FLOOR }], {
        absoluteMin: SEARCH_ABSOLUTE_SCORE_FLOOR,
      }),
    ).toHaveLength(1);
    expect(
      applyAbsoluteTopScoreFloor([{ score: DECISION_ABSOLUTE_SCORE_FLOOR }], {
        absoluteMin: DECISION_ABSOLUTE_SCORE_FLOOR,
      }),
    ).toHaveLength(1);
  });

  it("treats non-positive absoluteMin as no-op", () => {
    const hits = [{ score: 0.1 }];
    expect(applyAbsoluteTopScoreFloor(hits, { absoluteMin: 0 })).toEqual(hits);
  });
});
