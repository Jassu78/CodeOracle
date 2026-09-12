/** Re-export from queue so producers (API) and workers share one implementation. */
export {
  safeRemoveJobIfIdle,
  safeReplaceJob,
  type SafeReplaceJobResult,
} from "@codeoracle/queue";
