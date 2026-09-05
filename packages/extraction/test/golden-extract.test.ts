/**
 * G3.15 — offline golden extract parse checks (no live LLM).
 * Scores parse coercion + field presence against fixture model outputs.
 */
import { describe, expect, it } from "vitest";
import { parseExtractionBatch } from "../src/parse-extraction.js";
import { EXTRACTION_SYSTEM_PROMPT } from "../src/prompt.js";

const GOLDENS = [
  {
    id: "auth-jwt-vs-session",
    raw: JSON.stringify({
      decisions: [
        {
          topic: "JWT access tokens",
          summary: "Chose short-lived JWTs instead of server sessions for stateless API scale-out.",
          alternativesConsidered: ["server sessions", "opaque tokens in Redis"],
          confidence: 0.9,
          touchedPaths: ["src/auth/middleware.ts"],
        },
      ],
    }),
    expectTopicIncludes: "JWT",
    expectSummaryIncludes: ["instead of", "session"],
    expectAlternativesIncludes: ["session"],
  },
  {
    id: "cache-redis-vs-memory",
    raw: `Sure!\n\`\`\`json\n{"decisions":[{"topic":"Redis cache","summary":"Use Redis rather than in-process Map so workers share cache.","alternativesConsidered":["In-memory Map"],"confidence":"0.85","touchedPaths":[]}]}\n\`\`\``,
    expectTopicIncludes: "Redis",
    expectSummaryIncludes: ["rather than"],
    expectAlternativesIncludes: ["Map"],
  },
  {
    id: "trivial-empty",
    raw: '{"decisions":[]}',
    expectEmpty: true,
  },
] as const;

describe("golden extract parse (G3.15 offline)", () => {
  it("system prompt still requires alternatives guidance", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/alternativesConsidered/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/instead of|rather than/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/Consistency \(mandatory\)/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/INVALID/i);
  });

  for (const g of GOLDENS) {
    it(`parses ${g.id}`, () => {
      const batch = parseExtractionBatch(g.raw);
      if ("expectEmpty" in g && g.expectEmpty) {
        expect(batch.decisions).toHaveLength(0);
        return;
      }
      expect(batch.decisions.length).toBeGreaterThan(0);
      const d = batch.decisions[0]!;
      expect(d.topic).toMatch(new RegExp(g.expectTopicIncludes!, "i"));
      for (const s of g.expectSummaryIncludes ?? []) {
        expect(d.summary.toLowerCase()).toContain(s.toLowerCase());
      }
      for (const a of g.expectAlternativesIncludes ?? []) {
        expect(d.alternativesConsidered.join(" ").toLowerCase()).toContain(a.toLowerCase());
      }
    });
  }
});
