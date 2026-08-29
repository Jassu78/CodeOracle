import { describe, expect, it } from "vitest";
import {
  ExtractionParseError,
  parseExtractionBatch,
  stripMarkdownFence,
  filterByConfidence,
} from "../src/parse-extraction.js";

describe("parseExtractionBatch", () => {
  it("parses valid JSON batch", () => {
    const batch = parseExtractionBatch(
      JSON.stringify({
        decisions: [
          {
            topic: "Use Postgres",
            summary: "We need relational integrity for job history.",
            alternativesConsidered: ["MongoDB"],
            confidence: 0.9,
            touchedPaths: ["packages/db"],
          },
        ],
      }),
    );
    expect(batch.decisions).toHaveLength(1);
    expect(batch.decisions[0]!.topic).toBe("Use Postgres");
  });

  it("parses JSON wrapped in markdown fences", () => {
    const raw = '```json\n{"decisions":[]}\n```';
    expect(parseExtractionBatch(raw).decisions).toHaveLength(0);
  });

  it("wraps a bare decisions array", () => {
    const batch = parseExtractionBatch(
      JSON.stringify([
        {
          topic: "Use Postgres",
          summary: "We need relational integrity for job history.",
          alternativesConsidered: ["MongoDB"],
          confidence: 0.9,
          touchedPaths: ["packages/db"],
        },
      ]),
    );
    expect(batch.decisions).toHaveLength(1);
    expect(batch.decisions[0]!.topic).toBe("Use Postgres");
  });

  it("coerces trailing prose + string confidence + missing alts (G3.20)", () => {
    const batch = parseExtractionBatch(
      'Here you go:\n{"topic":"Use Redis","summary":"Need shared sessions across replicas.","confidence":"0.8"}\nThanks!',
    );
    expect(batch.decisions).toHaveLength(1);
    expect(batch.decisions[0]!.confidence).toBe(0.8);
    expect(batch.decisions[0]!.alternativesConsidered).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseExtractionBatch("not json")).toThrow(ExtractionParseError);
  });

  it("throws on schema mismatch", () => {
    expect(() => parseExtractionBatch('{"decisions":[{"topic":""}]}')).toThrow(
      ExtractionParseError,
    );
  });
});

describe("stripMarkdownFence", () => {
  it("strips fences", () => {
    expect(stripMarkdownFence("```\n{}\n```")).toBe("{}");
  });
});

describe("filterByConfidence", () => {
  it("drops low-confidence decisions", () => {
    const kept = filterByConfidence(
      {
        decisions: [
          { topic: "A", summary: "s", alternativesConsidered: [], confidence: 0.8, touchedPaths: [] },
          { topic: "B", summary: "s", alternativesConsidered: [], confidence: 0.2, touchedPaths: [] },
        ],
      },
      0.5,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.topic).toBe("A");
  });
});
