import { z } from "zod";

/** D3.6 — one row per provider attempt (success or failover). */
export const ProviderUsageEventSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  kind: z.enum(["chat", "embeddings"]),
  latencyMs: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative().optional(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type ProviderUsageEvent = z.infer<typeof ProviderUsageEventSchema>;

export type ProviderUsageLogger = (event: ProviderUsageEvent) => void;
