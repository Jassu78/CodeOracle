import type { ChatProviderPort } from "@codeoracle/gateway";
import type { DecisionExtractionBatch } from "@codeoracle/contracts";
import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionSourceContext,
} from "./prompt.js";
import { parseExtractionBatch } from "./parse-extraction.js";
import { redactSecrets } from "./redact-secrets.js";

export type ExtractDecisionsFromSourceResult = {
  batch: DecisionExtractionBatch;
  providerId: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  redactionHits: ReturnType<typeof redactSecrets>["hits"];
};

/**
 * D3.2 — single-source extraction: redact → prompt → gateway chat → parse JSON.
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
  const batch = parseExtractionBatch(completion.content);

  return {
    batch,
    providerId: completion.providerId,
    model: completion.model,
    tokensUsed: completion.tokensUsed,
    latencyMs: completion.latencyMs,
    redactionHits: [...bodyRedacted.hits, ...titleRedacted.hits, ...(diffRedacted?.hits ?? [])],
  };
}
