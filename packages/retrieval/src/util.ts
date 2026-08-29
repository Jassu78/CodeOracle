/** Injected at the app edge — keeps retrieval free of gateway imports. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Citation-worthiness check ("no citation = bug"). Lives in `@codeoracle/
 * core-domain` as a framework-free product rule shared across capability
 * packages; re-exported here under its original name so call sites in this
 * package don't churn.
 */
export { isCitationUrl as isHttpUrl } from "@codeoracle/core-domain";
