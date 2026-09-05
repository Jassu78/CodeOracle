# @codeoracle/gateway

OpenAI-compatible **chat** and **embeddings** access for the whole monorepo.

| Piece | Role |
|-------|------|
| `ChatProviderPort` / `EmbeddingProviderPort` | Ports used by extraction + worker embed |
| `OpenAiCompatAdapter` | Speaks `/v1/chat/completions` and `/v1/embeddings` |
| `ProviderRegistry` | Loads `providers.yaml`, tries endpoints by `priority`, fails over on 429/5xx/network |
| Circuit breaker | Redis-backed skip of unhealthy endpoints |

**Rule:** adding a host is a `providers.yaml` change — never a new SDK.
