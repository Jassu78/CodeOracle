# Optional OpenTelemetry (E7)

**Default:** off (`OTEL_ENABLED=false`). No vendor cloud agent — OTLP/HTTP only.

## Env

| Variable | Default | Role |
|----------|---------|------|
| `OTEL_ENABLED` | `false` | Master switch |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Base URL, e.g. `http://127.0.0.1:4318` (no `/v1/traces` suffix) |
| `OTEL_SERVICE_NAME` | per process | Overrides `codeoracle-worker` / `codeoracle-api` / `codeoracle-mcp` |

## What is instrumented

| Signal | Source |
|--------|--------|
| Span `bullmq.job` | Worker job processor |
| Histogram `gateway.provider.latency_ms` | `logProviderUsage` |
| Histogram `retrieval.tool.latency_ms` (+ embed-excluded) | `logQueryLatency` (MCP) |

Structured JSON logs remain the primary dogfood signal; OTel is an optional dual-write.

## Local collector (example)

```bash
# Any OTLP/HTTP receiver on :4318 — contrib collector is one option:
docker run --rm -p 4318:4318 otel/opentelemetry-collector-contrib:latest

# In .env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318

# Restart worker + MCP; run one index job + one search_codebase
```

See also `docs/ops/latency-slos.md` (log-based p95 targets).
