import type { DecisionSourceType } from "@codeoracle/contracts";

export type ExtractionSourceContext = {
  sourceType: Exclude<DecisionSourceType, "review_comment">;
  title: string;
  body: string;
  sourceUrl: string;
  sourceSha: string;
  decidedAtIso: string;
  /** Optional diff stat summary — keep small for token budget. */
  diffSummary?: string;
};

export const EXTRACTION_SYSTEM_PROMPT = `You are a software archaeology assistant. Extract structured architectural decisions from git history.

Rules:
- Output ONLY valid JSON matching the schema below — no markdown fences, no commentary.
- Extract zero or more decisions. If the source is trivial (typo fix, version bump, formatting), return {"decisions":[]}.
- Each decision must describe WHY (trade-offs, constraints, rejected options) — never just restate WHAT changed.
- Do NOT invent technologies, languages, file extensions, or alternatives that are not in the source text.
- Do NOT invent or mention author/committer/reviewer names — omit people entirely.
- Do NOT copy example topics from this prompt; invent topics only from the source.
- confidence: 0.0-1.0 — how explicit the rationale is in the source text (low if you are guessing).
- touchedPaths: if a "Changed files (from git…)" list is provided, copy paths ONLY from that list (or []). Never invent paths or change extensions. If no list is provided, use [] unless the source text names exact paths.
- alternativesConsidered: options explicitly mentioned or strongly implied (empty if none).

JSON schema:
{
  "decisions": [
    {
      "topic": "string (max 500 chars, short label of the choice)",
      "summary": "string (1-3 sentences of rationale from the source)",
      "alternativesConsidered": ["string"],
      "confidence": 0.0,
      "touchedPaths": ["string"]
    }
  ]
}`;

export function buildExtractionUserPrompt(ctx: ExtractionSourceContext): string {
  const lines = [
    `Source type: ${ctx.sourceType}`,
    `Source URL: ${ctx.sourceUrl}`,
    `Source SHA: ${ctx.sourceSha}`,
    `Decided at: ${ctx.decidedAtIso}`,
    `Title: ${ctx.title}`,
    "",
    "Body:",
    ctx.body,
  ];

  if (ctx.diffSummary) {
    lines.push("", "Diff summary:", ctx.diffSummary);
  }

  return lines.join("\n");
}
