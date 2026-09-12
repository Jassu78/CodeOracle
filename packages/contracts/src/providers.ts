import { z } from "zod";

/**
 * providers.yaml shape. This is the ONLY place a provider's config shape is
 * defined — the gateway package's ProviderRegistry consumes this type, and
 * packages/config validates providers.yaml against it at load time, failing
 * loudly on malformed entries rather than silently skipping them.
 */

export const ProviderKind = z.enum(["chat", "embeddings"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const OpenAiCompatEndpointSchema = z.object({
  id: z.string().min(1),
  kind: ProviderKind,
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1).nullable(),
  model: z.string().min(1),
  priority: z.number().int(),
  enabled: z.boolean(),
});
export type OpenAiCompatEndpoint = z.infer<typeof OpenAiCompatEndpointSchema>;

/**
 * Cross-encoder / TEI rerank endpoint (E2.1). Not OpenAI-compat — dedicated
 * schema so chat/embeddings stay honest about `/v1/*` wire protocol.
 *
 * `model` is usage/metadata only; the served model is chosen by the TEI
 * container at startup.
 */
export const RerankEndpointSchema = z.object({
  id: z.string().min(1),
  protocol: z.literal("tei").default("tei"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1).nullable(),
  model: z.string().min(1),
  priority: z.number().int(),
  enabled: z.boolean(),
});
export type RerankEndpoint = z.infer<typeof RerankEndpointSchema>;

export const ProvidersConfigSchema = z.object({
  chat: z.array(OpenAiCompatEndpointSchema),
  embeddings: z.array(OpenAiCompatEndpointSchema),
  /** Optional; missing key → []. Existing yaml without rerank: still loads. */
  rerank: z.array(RerankEndpointSchema).default([]),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
