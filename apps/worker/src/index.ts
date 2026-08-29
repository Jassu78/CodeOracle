export { runFullIndexSetup, finalizeIndexIfComplete, markRepoIndexError } from "./processors/full-index.js";
export { runChunkFile } from "./processors/chunk-file.js";
export { runEmbedChunks } from "./processors/embed-chunks.js";
export { runExtractDecisions } from "./processors/extract-decisions.js";
export { recoverStaleIndexRun, recoverAllStaleIndexes } from "./lib/recover-stale-index.js";
export type { RecoverResult } from "./lib/recover-stale-index.js";
export { queueExtractDecisionsForRepo } from "./lib/queue-extraction-jobs.js";
