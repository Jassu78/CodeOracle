# @codeoracle/retrieval

Vector store helpers + tool-facing retrieval services.

## Search modes

| Collection | Mode |
|---|---|
| `code_chunks` | **Hybrid** when created via `recreateHybridChunksCollection` / `ensureChunksCollection` (named `dense` + sparse `text`, RRF). Legacy unnamed dense still searchable (dense-only fallback). |
| `decisions` | Dense only |

Sparse vectors are local bag-of-tokens (`textToSparseVector`); Qdrant applies `idf` modifier. Tokens hash into a 31-bit index (standard "hashing trick" — see doc comment in `sparse-embed.ts` for the accepted collision trade-off at single-repo scale).

**Activate hybrid on an existing dogfood index:** run a **full** reindex (recreates the chunks collection). Incremental upserts write sparse when the collection is already hybrid.
