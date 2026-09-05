import { describe, expect, it } from "vitest";
import {
  dropInconsistentAlternatives,
  listInconsistentAlternatives,
} from "../src/parse-extraction.js";

describe("alternatives consistency gate (Q3)", () => {
  it("lists decisions with contrast in summary but empty alts", () => {
    const bad = listInconsistentAlternatives({
      decisions: [
        {
          topic: "Redaction",
          summary: "Use high-entropy tokens rather than fixed denylists only.",
          alternativesConsidered: [],
          confidence: 0.8,
          touchedPaths: [],
        },
        {
          topic: "Budget",
          summary: "Skip LLM when daily token budget is exceeded.",
          alternativesConsidered: [],
          confidence: 0.8,
          touchedPaths: [],
        },
      ],
    });
    expect(bad.map((d) => d.topic)).toEqual(["Redaction"]);
  });

  it("lists decisions with contrast only in source body", () => {
    const bad = listInconsistentAlternatives(
      {
        decisions: [
          {
            topic: "Failover",
            summary: "Keep extraction running under provider outages.",
            alternativesConsidered: [],
            confidence: 0.7,
            touchedPaths: [],
          },
        ],
      },
      {
        sourceTitle: "Gateway",
        sourceBody: "Failover across endpoints instead of failing hard on primary.",
      },
    );
    expect(bad).toHaveLength(1);
  });

  it("drops inconsistent decisions and keeps honest empties / filled", () => {
    const { batch, dropped } = dropInconsistentAlternatives({
      decisions: [
        {
          topic: "Bad",
          summary: "Chose A rather than B",
          alternativesConsidered: [],
          confidence: 0.9,
          touchedPaths: [],
        },
        {
          topic: "OkEmpty",
          summary: "Add tests for edge cases.",
          alternativesConsidered: [],
          confidence: 0.7,
          touchedPaths: [],
        },
        {
          topic: "OkFilled",
          summary: "Chose A rather than B",
          alternativesConsidered: ["B"],
          confidence: 0.9,
          touchedPaths: [],
        },
      ],
    });
    expect(dropped).toBe(1);
    expect(batch.decisions.map((d) => d.topic)).toEqual(["OkEmpty", "OkFilled"]);
  });
});
