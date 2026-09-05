import {
  DecisionExtractionBatchSchema,
  type DecisionExtractionBatch,
  type DecisionExtractionResult,
} from "@codeoracle/contracts";
import { isAlternativesInconsistent } from "@codeoracle/core-domain";

export class ExtractionParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExtractionParseError";
  }
}

/** Strip optional markdown code fences from model output. */
export function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

/**
 * Pull the first JSON object or array substring from noisy model output
 * (trailing prose, "Here is the JSON:" prefixes).
 */
export function extractJsonSubstring(raw: string): string {
  const text = stripMarkdownFence(raw);
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  let start = -1;
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) start = objStart;
  else if (arrStart >= 0) start = arrStart;
  if (start < 0) return text;

  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function coerceConfidence(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function coerceDecision(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const d = raw as Record<string, unknown>;
  return {
    ...d,
    alternativesConsidered: Array.isArray(d.alternativesConsidered)
      ? d.alternativesConsidered
      : [],
    touchedPaths: Array.isArray(d.touchedPaths) ? d.touchedPaths : [],
    confidence: coerceConfidence(d.confidence),
  };
}

/**
 * Normalize common free/local-model shapes before Zod validation (G3.20).
 */
export function coerceExtractionPayload(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    return { decisions: parsed.map(coerceDecision) };
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.decisions)) {
      return { decisions: obj.decisions.map(coerceDecision) };
    }
    // Single decision object root
    if (typeof obj.topic === "string" && typeof obj.summary === "string") {
      return { decisions: [coerceDecision(obj)] };
    }
  }
  return parsed;
}

export function parseExtractionBatch(raw: string): DecisionExtractionBatch {
  const jsonText = extractJsonSubstring(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new ExtractionParseError("LLM output is not valid JSON", err);
  }

  parsed = coerceExtractionPayload(parsed);

  const result = DecisionExtractionBatchSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExtractionParseError(
      `LLM JSON failed schema validation: ${result.error.issues[0]?.message ?? "unknown"}`,
      result.error,
    );
  }

  return result.data;
}

/** Filter out low-confidence extractions without failing the pipeline. */
export function filterByConfidence(
  batch: DecisionExtractionBatch,
  minConfidence: number,
): DecisionExtractionResult[] {
  return batch.decisions.filter((d) => d.confidence >= minConfidence);
}

export type AlternativesSourceContext = {
  sourceTitle?: string;
  sourceBody?: string;
};

/** Decisions that assert contrast in source/summary but left alternatives empty. */
export function listInconsistentAlternatives(
  batch: DecisionExtractionBatch,
  source: AlternativesSourceContext = {},
): DecisionExtractionResult[] {
  return batch.decisions.filter((d) =>
    isAlternativesInconsistent({
      summary: d.summary,
      alternativesConsidered: d.alternativesConsidered,
      sourceTitle: source.sourceTitle,
      sourceBody: source.sourceBody,
    }),
  );
}

/**
 * Drop inconsistent decisions rather than invent alternatives.
 * Prefer fewer/empty results over structured lies.
 */
export function dropInconsistentAlternatives(
  batch: DecisionExtractionBatch,
  source: AlternativesSourceContext = {},
): { batch: DecisionExtractionBatch; dropped: number } {
  const kept = batch.decisions.filter(
    (d) =>
      !isAlternativesInconsistent({
        summary: d.summary,
        alternativesConsidered: d.alternativesConsidered,
        sourceTitle: source.sourceTitle,
        sourceBody: source.sourceBody,
      }),
  );
  return {
    batch: { decisions: kept },
    dropped: batch.decisions.length - kept.length,
  };
}

export const EXTRACTION_REPAIR_SYSTEM = `You fix invalid JSON from a previous extraction attempt.
Return ONLY valid JSON matching:
{"decisions":[{"topic":"string","summary":"string","alternativesConsidered":["string"],"confidence":0.0,"touchedPaths":["string"]}]}
No markdown fences. No commentary. Prefer {"decisions":[]} over inventing fields.
If a decision summary contrasts options, alternativesConsidered MUST list the non-chosen option(s) using only source wording — never leave alternatives empty in that case.`;

/**
 * Dedicated repair when JSON parsed but alternatives consistency failed (Q3).
 * Still forbid inventing alternatives not present in the source.
 */
export const EXTRACTION_ALTERNATIVES_CONSISTENCY_REPAIR_SYSTEM = `You fix architectural decision JSON that failed alternatives consistency validation.
Return ONLY valid JSON matching:
{"decisions":[{"topic":"string","summary":"string","alternativesConsidered":["string"],"confidence":0.0,"touchedPaths":["string"]}]}
No markdown fences. No commentary.

Rules:
- When the source or a decision summary contrasts options (rather than / instead of / vs / chose X over Y / rejected), alternativesConsidered MUST list the non-chosen option(s).
- Use only wording grounded in the provided source title/body. Do NOT invent technologies or options.
- If you cannot name a grounded alternative, omit that decision entirely (fewer decisions or {"decisions":[]}).
- Prefer omitting a decision over emitting contrast text with an empty alternativesConsidered array.`;
