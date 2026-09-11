# @codeoracle/retrieval

Vector store helpers + tool-facing retrieval services.

## Search modes

| Collection | Mode |
|---|---|
| `code_chunks` | **Hybrid** when created via `ensureChunksCollection` / `prepareChunksCollectionForFullIndex` (named `dense` + sparse `text`, RRF). Legacy unnamed dense still searchable (dense-only fallback). |
| `decisions` | Dense only |

Sparse vectors are local bag-of-tokens (`textToSparseVector`); Qdrant applies `idf` modifier. Tokens hash into a 31-bit index (standard "hashing trick" — see doc comment in `sparse-embed.ts` for the accepted collision trade-off at single-repo scale). Identifiers are split on camelCase / snake_case (and the raw token is kept) so NL queries can overlap symbols. **Query-time** splitting applies immediately; **indexed** sparse vectors pick up the new tokens only after a **full** reindex.

**Chunk index text:** dense embed + sparse both use `chunkIndexText` (path + basename + symbol + body). Payload still stores structured `file_path` / `symbol_name`. Body-only indexing left identifier-heavy modules mid-rank for NL “where do we …” queries; changing this requires a **full** reindex.

**Hybrid relevance floor:** dense and sparse channels are queried separately; dense honors `scoreThreshold` (cosine). Results are fused with Reciprocal Rank Fusion in `@codeoracle/core-domain`, then a post-fusion cutoff prefers dual-channel hits, drops ranks below 50% of the dual-channel top score, and **backfills** dense-only (then sparse-only) hits under a global RRF floor so prose that wins both channels cannot entirely hide dense-only code. Falls back to single-channel if nothing is dual-channel.

**Activate hybrid on an existing dogfood index:** run a **full** reindex. If `code_chunks` is already hybrid, full index **clears only that repo’s points** (E8 — other repos stay intact). If the collection is still legacy dense, the first full index **recreates** the collection as hybrid (one-time wipe of all chunk vectors — reindex every repo afterward). Incremental upserts write sparse when the collection is already hybrid.

**Multi-repo isolation (E8):** do not call `recreateHybridChunksCollection` from product full-index paths; use `prepareChunksCollectionForFullIndex(client, vectorSize, repoId)`. Decisions already use `deleteRepoDecisionVectors(repoId)`.

**Absolute no-match floor (P0-B):** after hydrate, if the best **dense evidence** score is below `SEARCH_ABSOLUTE_SCORE_FLOOR` (default `0.35`), `search_codebase` returns `{ results: [] }`. Hybrid still ranks with RRF, but sparse-only tips (evidence `0`) empty so lexical nonsense cannot fill top-K. MCP already renders empty as “No code chunks matched…”.

## Secret refuse (P0-A)

`search_codebase` and `explain_file` refuse dotenv/secret **path classes** (including `.env2`, which `.env.*` miss) and high-confidence secret payloads via `@codeoracle/core-domain` `mustRefuseSecretRetrieval`. Crawl denylist uses the same patterns. After widening the denylist, run a **full** reindex so stale Qdrant points are dropped.

## `find_decision`

Dense topic search over `decisions`, then hydrate + citation filter. Results are cut with an **absolute score floor** (default keep only when top ≥ `0.58`) then a **relative score floor** (default keep `score ≥ topScore × 0.85`) and a **display limit** of 3 so mediocre sticky tips and absolute-threshold tails do not ship. Qdrant fetch is wider than the display limit. No reindex required for this policy.

