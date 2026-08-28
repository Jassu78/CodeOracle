import {
  DecisionExtractionBatchSchema,
  type DecisionExtractionBatch,
  type DecisionExtractionResult,
} from "@codeoracle/contracts";

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

export function parseExtractionBatch(raw: string): DecisionExtractionBatch {
  const jsonText = stripMarkdownFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new ExtractionParseError("LLM output is not valid JSON", err);
  }

  // Small models sometimes emit a bare decisions array instead of { decisions: [...] }.
  if (Array.isArray(parsed)) {
    parsed = { decisions: parsed };
  }

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
