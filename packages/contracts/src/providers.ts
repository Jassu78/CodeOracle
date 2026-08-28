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

export const ProvidersConfigSchema = z.object({
  chat: z.array(OpenAiCompatEndpointSchema),
  embeddings: z.array(OpenAiCompatEndpointSchema),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
