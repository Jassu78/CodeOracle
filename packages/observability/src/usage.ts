import type { ProviderUsageEvent } from "@codeoracle/contracts";
import { createLogger } from "./logger.js";
import { recordDurationMs } from "./trace.js";

const usageLog = createLogger("provider-usage");

/** D3.6 — structured log line for every LLM/embed provider call. */
export function logProviderUsage(event: ProviderUsageEvent): void {
  usageLog.info("provider call", {
    providerId: event.providerId,
    model: event.model,
    kind: event.kind,
    latencyMs: event.latencyMs,
    tokensUsed: event.tokensUsed,
    success: event.success,
    error: event.error,
  });
  recordDurationMs("gateway.provider.latency_ms", event.latencyMs, {
    kind: event.kind,
    providerId: event.providerId,
    success: event.success,
  });
}
