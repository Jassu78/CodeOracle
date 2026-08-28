export { redactSecrets, type RedactionHit } from "./redact-secrets.js";
export {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
  type ExtractionSourceContext,
} from "./prompt.js";
export {
  parseExtractionBatch,
  stripMarkdownFence,
  filterByConfidence,
  ExtractionParseError,
} from "./parse-extraction.js";
export {
  extractDecisionsFromSource,
  type ExtractDecisionsFromSourceResult,
} from "./extract-from-source.js";
export { isTrivialSourceMessage } from "./trivial-source.js";
