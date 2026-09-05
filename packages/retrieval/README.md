# @codeoracle/retrieval

Vector store helpers + tool-facing retrieval services.

## Search modes

| Collection | Mode |
|---|---|
| `code_chunks` | **Hybrid** when created via `recreateHybridChunksCollection` / `ensureChunksCollection` (named `dense` + sparse `text`, RRF). Legacy unnamed dense still searchable (dense-only fallback). |
| `decisions` | Dense only |

Sparse vectors are local bag-of-tokens (`textToSparseVector`); Qdrant applies `idf` modifier. Tokens hash into a 31-bit index (standard "hashing trick" — see doc comment in `sparse-embed.ts` for the accepted collision trade-off at single-repo scale). Identifiers are split on camelCase / snake_case (and the raw token is kept) so NL queries can overlap symbols. **Query-time** splitting applies immediately; **indexed** sparse vectors pick up the new tokens only after a **full** reindex.

**Hybrid relevance floor:** dense and sparse channels are queried separately; dense honors `scoreThreshold` (cosine). Results are fused with Reciprocal Rank Fusion in `@codeoracle/core-domain`, then a post-fusion cutoff prefers dual-channel hits, drops ranks below 50% of the dual-channel top score, and **backfills** dense-only (then sparse-only) hits under a global RRF floor so prose that wins both channels cannot entirely hide dense-only code. Falls back to single-channel if nothing is dual-channel.

**Activate hybrid on an existing dogfood index:** run a **full** reindex (recreates the chunks collection). Incremental upserts write sparse when the collection is already hybrid.
