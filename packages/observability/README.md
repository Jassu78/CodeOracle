# @codeoracle/observability

Cross-cutting ops helpers:

| Export | Role |
|--------|------|
| `createLogger` | Structured logger for apps/packages |
| `logProviderUsage` | Meter provider calls (+ optional OTel histogram) |
| `logQueryLatency` | MCP query latency stderr line (+ optional OTel histogram) |
| `initOtel` / `withSpan` | **E7** optional OTLP/HTTP OpenTelemetry (default off) |

Keep this package free of business rules — domain policy stays in `@codeoracle/core-domain`.

## Optional OTel (E7)

No vendor cloud SDKs. When `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the Node SDK exports traces/metrics over OTLP/HTTP to any collector (local Jaeger, Grafana Alloy, etc.).

Default `OTEL_ENABLED=false` → `withSpan` / histograms are API no-ops (zero export).
