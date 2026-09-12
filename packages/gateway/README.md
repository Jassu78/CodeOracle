# @codeoracle/gateway

**Chat** and **embeddings** via OpenAI-compatible hosts, plus optional **rerank** via Hugging Face TEI.

| Piece | Role |
|-------|------|
| `ChatProviderPort` / `EmbeddingProviderPort` | Ports used by extraction + worker embed |
| `RerankProviderPort` | E2.1 post-fusion cross-encoder (injected at MCP/CLI edge) |
| `OpenAiCompatAdapter` | Speaks `/v1/chat/completions` and `/v1/embeddings` |
| `TeiRerankAdapter` | Speaks TEI `POST /rerank` (not OpenAI-compat — intentional exception) |
| `ProviderRegistry` | Loads `providers.yaml`, tries endpoints by `priority`, fails over on 429/5xx/network |
| `createSearchRerankFn` | Shared MCP + CLI replay inject when kill-switch + endpoints allow |
| Circuit breaker | Redis-backed skip of unhealthy endpoints |

**Rules:**
- Adding a **chat/embeddings** host is a `providers.yaml` change — never a new SDK.
- **Rerank** is TEI-shaped (`protocol: tei`). Do not pretend it is OpenAI-compat. Abort ≤ `SEARCH_RERANK_TIMEOUT_MS` (never the chat 90s default).
