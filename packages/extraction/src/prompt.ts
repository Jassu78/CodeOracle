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
- summary MUST answer WHY (constraint, trade-off, rejected option, or goal). Never restate WHAT changed, the PR/commit title, or the file list as the summary.
- If the source only describes WHAT with no rationale, return {"decisions":[]} — do not invent WHY. Prefer empty output over guessing.
- Do NOT invent technologies, languages, file extensions, or alternatives that are not in the source text.
- Do NOT invent or mention author/committer/reviewer names — omit people entirely.
- Do NOT copy example topics from this prompt; invent topics only from the source.
- confidence: 0.0-1.0 — how explicit the rationale is in the source text (≤0.4 if weak/implied; high only if WHY is explicit).
- touchedPaths: if a "Changed files (from git…)" list is provided, copy paths ONLY from that list (or []). Never invent paths or change extensions. If no list is provided, use [] unless the source text names exact paths.
- alternativesConsidered: when the source contrasts options (e.g. "instead of", "rather than", "vs", "chose X over Y", "rejected", "considered"), list the rejected or non-chosen options using only wording grounded in the source. Empty ONLY if the source names no alternative.
- Consistency (mandatory): if your summary (or the source) names a rejected/non-chosen option, alternativesConsidered MUST list that option. Never emit contrast in summary with an empty alternativesConsidered array — that output is invalid. Prefer omitting the decision or returning {"decisions":[]} over inconsistent JSON.

Negative example (INVALID — do not produce this shape):
{"topic":"Secret redaction","summary":"Use a high-entropy token pattern rather than fixed path denylists only.","alternativesConsidered":[],"confidence":0.8,"touchedPaths":[]}
Valid repair of that idea: put "fixed path denylists" (or the source's phrasing) into alternativesConsidered, or omit the decision.

JSON schema:
{
  "decisions": [
    {
      "topic": "string (max 500 chars, short label of the choice)",
      "summary": "string (1-3 sentences of WHY from the source — not a restatement of the title)",
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

  lines.push(
    "",
    "Reminder: extract WHY only. If no rationale is present, return {\"decisions\":[]}.",
    "If the body contrasts options (instead of / rather than / over / vs), fill alternativesConsidered with the non-chosen option(s).",
    "If summary mentions a rejected option, alternativesConsidered must list it — empty alternatives with contrast text is invalid.",
  );

  return lines.join("\n");
}
