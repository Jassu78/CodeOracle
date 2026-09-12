import { metrics, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const TRACER = "codeoracle";
const METER = "codeoracle";

function cleanAttrs(attrs: Record<string, string | number | boolean | undefined>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** No-op when SDK is not registered (OTEL_ENABLED=false). */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER);
  return tracer.startActiveSpan(name, { attributes: cleanAttrs(attrs) }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

export function recordDurationMs(
  name: string,
  durationMs: number,
  attrs: Record<string, string | number | boolean | undefined> = {},
): void {
  const meter = metrics.getMeter(METER);
  const hist = meter.createHistogram(name, {
    description: "Duration in milliseconds",
    unit: "ms",
  });
  hist.record(durationMs, cleanAttrs(attrs));
}
