import type { ChatProviderPort } from "@codeoracle/gateway";
import type { DecisionExtractionBatch } from "@codeoracle/contracts";
import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionSourceContext,
} from "./prompt.js";
import {
  dropInconsistentAlternatives,
  EXTRACTION_ALTERNATIVES_CONSISTENCY_REPAIR_SYSTEM,
  EXTRACTION_REPAIR_SYSTEM,
  ExtractionParseError,
  listInconsistentAlternatives,
  parseExtractionBatch,
} from "./parse-extraction.js";
import { redactSecrets } from "./redact-secrets.js";

export type ExtractDecisionsFromSourceResult = {
  batch: DecisionExtractionBatch;
  providerId: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  redactionHits: ReturnType<typeof redactSecrets>["hits"];
  /** True when the JSON-parse repair completion ran. */
  repaired: boolean;
  /** True when an alternatives-consistency repair completion ran. */
  consistencyRepaired: boolean;
  /** Decisions removed after repair still failed the consistency gate. */
  droppedInconsistent: number;
};

/**
 * D3.2 — single-source extraction: redact → prompt → gateway chat → parse JSON.
 * On parse failure, one repair completion is attempted (G3.20).
 * On alternatives inconsistency (Q3), one consistency repair is attempted; residual
 * inconsistent decisions are dropped (never invent alternatives).
 * Does not persist — caller (worker job) owns storage.
 */
export async function extractDecisionsFromSource(opts: {
  gateway: ChatProviderPort;
  source: ExtractionSourceContext;
}): Promise<ExtractDecisionsFromSourceResult> {
  const bodyRedacted = redactSecrets(opts.source.body);
  const titleRedacted = redactSecrets(opts.source.title);
  const diffRedacted = opts.source.diffSummary
    ? redactSecrets(opts.source.diffSummary)
    : undefined;

  const sourceTitle = titleRedacted.redacted;
  const sourceBody = bodyRedacted.redacted;
  const sourceCtx = { sourceTitle, sourceBody };

  const userPrompt = buildExtractionUserPrompt({
    ...opts.source,
    title: sourceTitle,
    body: sourceBody,
    diffSummary: diffRedacted?.redacted,
  });

  const completion = await opts.gateway.complete(EXTRACTION_SYSTEM_PROMPT, userPrompt);
  let tokensUsed = completion.tokensUsed;
  let latencyMs = completion.latencyMs;
  let providerId = completion.providerId;
  let model = completion.model;
  let repaired = false;
  let consistencyRepaired = false;

  let batch: DecisionExtractionBatch;
  try {
    batch = parseExtractionBatch(completion.content);
  } catch (err) {
    if (!(err instanceof ExtractionParseError)) throw err;
    const repairUser = [
      "The previous model output failed validation.",
      `Error: ${err.message}`,
      "",
      "Previous output:",
      completion.content.slice(0, 8_000),
      "",
      "Return corrected JSON only.",
    ].join("\n");
    const repair = await opts.gateway.complete(EXTRACTION_REPAIR_SYSTEM, repairUser);
    tokensUsed += repair.tokensUsed;
    latencyMs += repair.latencyMs;
    providerId = repair.providerId;
    model = repair.model;
    repaired = true;
    batch = parseExtractionBatch(repair.content);
  }

  const inconsistent = listInconsistentAlternatives(batch, sourceCtx);
  if (inconsistent.length > 0) {
    const topics = inconsistent.map((d) => d.topic).join("; ");
    const repairUser = [
      "The previous extraction JSON failed alternatives consistency validation.",
      `Inconsistent topics: ${topics}`,
      "Each of those decisions has empty alternativesConsidered but contrast text in the source and/or summary.",
      "",
      "Source title:",
      sourceTitle,
      "",
      "Source body:",
      sourceBody.slice(0, 12_000),
      "",
      "Previous JSON:",
      JSON.stringify(batch).slice(0, 8_000),
      "",
      "Return corrected JSON only. Fill grounded alternatives or omit those decisions. Do not invent.",
    ].join("\n");
    const repair = await opts.gateway.complete(
      EXTRACTION_ALTERNATIVES_CONSISTENCY_REPAIR_SYSTEM,
      repairUser,
    );
    tokensUsed += repair.tokensUsed;
    latencyMs += repair.latencyMs;
    providerId = repair.providerId;
    model = repair.model;
    consistencyRepaired = true;
    batch = parseExtractionBatch(repair.content);
  }

  const gated = dropInconsistentAlternatives(batch, sourceCtx);

  return {
    batch: gated.batch,
    providerId,
    model,
    tokensUsed,
    latencyMs,
    redactionHits: [...bodyRedacted.hits, ...titleRedacted.hits, ...(diffRedacted?.hits ?? [])],
    repaired,
    consistencyRepaired,
    droppedInconsistent: gated.dropped,
  };
}
