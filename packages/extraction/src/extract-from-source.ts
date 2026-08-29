import type { ChatProviderPort } from "@codeoracle/gateway";
import type { DecisionExtractionBatch } from "@codeoracle/contracts";
import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionSourceContext,
} from "./prompt.js";
import {
  EXTRACTION_REPAIR_SYSTEM,
  ExtractionParseError,
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
  repaired: boolean;
};

/**
 * D3.2 — single-source extraction: redact → prompt → gateway chat → parse JSON.
 * On parse failure, one repair completion is attempted (G3.20).
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

  const userPrompt = buildExtractionUserPrompt({
    ...opts.source,
    title: titleRedacted.redacted,
    body: bodyRedacted.redacted,
    diffSummary: diffRedacted?.redacted,
  });

  const completion = await opts.gateway.complete(EXTRACTION_SYSTEM_PROMPT, userPrompt);
  let tokensUsed = completion.tokensUsed;
  let latencyMs = completion.latencyMs;
  let providerId = completion.providerId;
  let model = completion.model;
  let repaired = false;

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

  return {
    batch,
    providerId,
    model,
    tokensUsed,
    latencyMs,
    redactionHits: [...bodyRedacted.hits, ...titleRedacted.hits, ...(diffRedacted?.hits ?? [])],
    repaired,
  };
}
