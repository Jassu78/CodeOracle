import { getOrderedEndpoints } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import type { ProviderRegistry } from "./provider-registry.js";
import type { RerankCandidateInput, RerankHit } from "./ports.js";

export type SearchRerankFn = (
  query: string,
  candidates: RerankCandidateInput[],
) => Promise<RerankHit[]>;

/**
 * App-edge inject for MCP + CLI replay. Returns undefined (identity path)
 * when the kill-switch is off or no enabled TEI rerank endpoints exist.
 */
export function createSearchRerankFn(
  registry: ProviderRegistry,
  config: ProvidersConfig,
  opts: { enabled: boolean; timeoutMs: number },
): SearchRerankFn | undefined {
  if (!opts.enabled) return undefined;
  if (getOrderedEndpoints(config, "rerank").length === 0) return undefined;
  const timeoutMs = opts.timeoutMs;
  return async (query, candidates) => {
    const out = await registry.rerank(query, candidates, { timeoutMs });
    return out.results;
  };
}
