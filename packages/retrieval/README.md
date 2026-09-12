# @codeoracle/retrieval

Vector store helpers + tool-facing retrieval services.

**Architecture (E0):** see [`docs/architecture/fused-retrieval.md`](../../docs/architecture/fused-retrieval.md) for the fused exact + sparse + dense (+ optional rerank) plan and sequencing.

## Search modes

| Collection | Mode |
|---|---|
| `code_chunks` | **Hybrid** when created via `ensureChunksCollection` / `prepareChunksCollectionForFullIndex` (named `dense` + sparse `text`, RRF). Legacy unnamed dense still searchable (dense-only fallback). |
| `decisions` | Hybrid dense + sparse (E4); legacy dense until full reindex |

Sparse vectors use local tokenization (`textToSparseVector`) with **BM25 TF** on documents and raw TF on queries; Qdrant applies `idf` modifier (E3). Tokens hash into a 31-bit index (hashing trick — see `sparse-embed.ts`). Identifiers are split on camelCase / snake_case (raw token kept) so NL queries can overlap symbols. **Query-time** splitting applies immediately; **indexed** sparse weights pick up BM25 (and new tokens) only after a **full** reindex.

**E3 reindex (required):** after deploying `sparse_encoder=bm25-tf-v1`, run a **full** reindex per repo. Mixing pre-E3 raw-TF points with BM25-TF points skews sparse ranks. Upserts stamp `sparse_encoder` on the payload. Ops: `pnpm --filter @codeoracle/retrieval exec tsx scripts/check-hybrid-mode.ts` exits **3** when a sample is not homogeneous; hybrid search also emits a one-shot `sparse_encoder_mixed` warn per repo.

**Chunk index text:** dense embed + sparse both use `chunkIndexText` (path + basename + symbol + body). Payload still stores structured `file_path` / `symbol_name`. Body-only indexing left identifier-heavy modules mid-rank for NL “where do we …” queries; changing this requires a **full** reindex.

**Hybrid relevance floor:** dense and sparse channels are queried separately; dense honors `scoreThreshold` (cosine). Results are fused with Reciprocal Rank Fusion in `@codeoracle/core-domain`, then a post-fusion cutoff prefers dual-channel hits, drops ranks below 50% of the dual-channel top score, and **backfills** dense-only (then sparse-only) hits under a global RRF floor so prose that wins both channels cannot entirely hide dense-only code. Falls back to single-channel if nothing is dual-channel.

**Activate hybrid on an existing dogfood index:** run a **full** reindex. If `code_chunks` is already hybrid, full index **clears only that repo’s points** (E8 — other repos stay intact). If the collection is still legacy dense, the first full index **recreates** the collection as hybrid (one-time wipe of all chunk vectors — reindex every repo afterward). Incremental upserts write sparse when the collection is already hybrid.

**Multi-repo isolation (E8):** do not call `recreateHybridChunksCollection` from product full-index paths; use `prepareChunksCollectionForFullIndex(client, vectorSize, repoId)`. Decisions already use `deleteRepoDecisionVectors(repoId)`.

**Absolute no-match floor (P0-B):** after hydrate, if the best **dense evidence** score is below `SEARCH_ABSOLUTE_SCORE_FLOOR` (default `0.35`), `search_codebase` returns `{ results: [] }`. Hybrid still ranks with RRF, but sparse-only tips (evidence `0`) empty so lexical nonsense cannot fill top-K. MCP already renders empty as “No code chunks matched…”. Exact **symbol/path** lexical hits (E1) credit evidence `1` so they are not wiped by the dense floor; content-only lexical hits do not.

## Lexical lane (E1)

`search_codebase` runs Postgres `searchChunksLexical` in parallel with embed/Qdrant hybrid, then merges. Same MCP tool — no second surface.

| Match | Evidence vs P0-B floor |
|-------|------------------------|
| symbol/path exact or path suffix (`…/basename`) | `1` (keeps result) |
| soft symbol | `0.4` |
| content substring | `0` (not queried on hot path in E1) |

**Access path:** equality + `ILIKE` on `symbol_name` / `file_path` only (repo-scoped). Not a trigram/FTS index yet — fine for dogfood-sized repos; E3/E5 may add FTS. Extension-only queries (`.ts`) do not path-match.

**Merge policy (E1 MVP):** exact lexical kinds sort ahead of hybrid-only ids; soft lexical does not outrank hybrid by kind. Full 3-channel domain RRF is deferred to a follow-up (see architecture doc). Each hydrated hit must clear the absolute evidence floor (weak companions dropped).

**Latency:** lexical starts with embed (no vector dependency); expected add is one small SQL round-trip. Lexical unavailable → structured `lexical_unavailable` warn + hybrid-only.

## Secret refuse (P0-A)

`search_codebase` and `explain_file` refuse dotenv/secret **path classes** (including `.env2`, which `.env.*` miss) and high-confidence secret payloads via `@codeoracle/core-domain` `mustRefuseSecretRetrieval`. Crawl denylist uses the same patterns. After widening the denylist, run a **full** reindex so stale Qdrant points are dropped.

## `find_decision`

Dense topic embed + hybrid RRF over `decisions` (E4), then hydrate + citation filter. Floors use **dense evidence** (absolute default `0.58`, relative `topEvidence × 0.85`); display order among survivors is RRF. Sparse-only tips cannot clear the absolute floor. After deploying E4, run a **full** reindex so `decisions` migrates from legacy dense to hybrid (first legacy recreate wipes all decision vectors — reindex every repo). No E2 rerank on this path.

