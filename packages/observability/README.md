# @codeoracle/observability

Cross-cutting ops helpers:

| Export | Role |
|--------|------|
| `createLogger` | Structured logger for apps/packages |
| `logProviderUsage` | Meter provider calls (`provider_id`, `model`, `latency_ms`, `tokens_used`) |

Keep this package free of business rules — domain policy stays in `@codeoracle/core-domain`.
