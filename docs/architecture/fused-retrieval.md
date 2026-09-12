# Fused retrieval architecture (E0)

**Status:** Design (wave 0)  
**Issue:** [#40](https://github.com/Jassu78/CodeOracle/issues/40)  
**Repo:** `Jassu78/CodeOracle`  
**Non-goals for this doc PR:** no E1–E2 implementation here.

## Sequencing (hard)

| Before | After | Why |
|--------|-------|-----|
| **P0-A** | any public/agent-facing retrieval change | Secret path/payload refuse is a ship blocker |
| **E8** | **E1** / multi-repo full reindex | Shared `code_chunks` wipe must not land during exact-lane dogfood |
| **E0** (this doc) | **E1 → E3 → E2** | Exact lane before sparse upgrade before learned rerank |
| **P0-B** | soft-NL / decision quality claims | Absolute no-match floors already on `main` |

Wave-0 code (P0-A, E6, P0-B, E8 + review F1–F5) is on `main` as of this writing. E0 unlocks **E1** implementation.

---

## 1. Query classes

| Class | Examples | Primary lane | Notes |
|-------|----------|--------------|-------|
| **Exact / symbol / path** | `verifyGitHubSignature`, `apps/api/src/webhooks/github-signature.ts`, `"change-me-in-dev"` | **E1 lexical** (indexed) | Must not depend on dense embeddings alone |
| **Soft NL** | “where do we verify GitHub webhook HMAC?” | Dense + sparse hybrid (today) | RRF + hybrid cutoff + doc quota |
| **Decision topic** | `find_decision` “cache” / “HMAC” | Dense decisions (today); **E4** may add hybrid | Absolute + relative floors (P0-B) |

Classification may be heuristic (quoted literals, `CamelCase` / `snake_case` tokens, path-shaped strings) but **fusion always runs**: lexical hits participate even when the query also looks soft-NL.

---

## 2. Pipeline (target)

Single MCP surface: `search_codebase` (and the same service for CLI/API). **Not** a second tool.

```
query
  → (optional) classify / feature extract
  → parallel retrieve:
        lexical (E1)     — symbol / path / literal index
        dense            — named vector `dense` (or legacy unnamed)
        sparse           — BM25 TF (doc) + raw TF (query) + Qdrant IDF (`sparse_encoder=bm25-tf-v1`; full reindex)
  → fuse ranks (domain RRF; lexical as its own channel)
  → hybrid cutoff / backfill policy (existing)
  → Postgres hydrate
  → P0-A mustRefuseSecretRetrieval (path + payload)
  → P0-B absolute dense-evidence floor (search)
  → optional learned rerank (E2 — `SEARCH_RERANK_ENABLED`, default off; after hydrate, before diversify)
  → diversifyByFilePath (+ doc quota)
  → citation / Zod → results (may be empty)
```

`find_decision` stays a separate path (topic embed → decisions hybrid RRF (E4) → absolute/relative floors on **dense evidence** → RRF display sort). Strong dense-only tips compete with dual-channel hits; sparse-only tips are dropped before floors. E2 rerank does **not** apply here.

---

## 3. Module ownership

| Concern | Package | Owns |
|---------|---------|------|
| Rank fusion, cutoff, diversify, absolute/relative floors, secret path class | `@codeoracle/core-domain` | Pure policy; no I/O |
| Embed + Qdrant + hydrate + MCP-facing orchestration | `@codeoracle/retrieval` | `searchCodebase`, `findDecision`, `explainFile`, store helpers |
| Exact/lexical index + query adapter | `@codeoracle/retrieval` (preferred) or thin `@codeoracle/lexical` if storage diverges | E1 adapter behind an interface; **no** second MCP server |
| Chunk rows / SoT | `@codeoracle/db` | Postgres chunks; lexical may use Postgres FTS/trigram or a side index keyed by `chunk.id` |
| Crawl denylist | `@codeoracle/worker` + shared `SECRET_PATH_IGNORE_PATTERNS` | Must stay aligned with P0-A |

**Rule:** ranking math stays in `core-domain`. Store-specific query shapes stay in `retrieval` (or a lexical adapter it calls).

---

## 4. Failure modes

| Failure | Behavior |
|---------|----------|
| **Exact index down / unavailable** | Soft-NL hybrid still runs; log/metric `lexical_unavailable`; do not fail the whole tool unless product later chooses fail-closed for exact-only queries |
| **Embed timeout / empty vector** | Today: throw (no silent empty). Keep fail-loud for provider faults; optional future: degrade to lexical-only with explicit flag/metric |
| **Empty sparse channel** | Dense-only (or dense+lexical) fusion; existing single-channel fallback |
| **Denied-path hydrate refuse (P0-A)** | Drop chunk even if ranked; continue. Empty list is valid |
| **Absolute no-match (P0-B)** | If best **dense evidence** `< SEARCH_ABSOLUTE_SCORE_FLOOR` → `{ results: [] }`. Sparse-only / lexical-only tips must not invent dense evidence; E1 must define how lexical-only strong hits interact with the floor (see E1 open point below) |
| **Rerank unavailable / timeout (E2)** | Fail-open: keep fused post-filter order; log `rerank_unavailable`. Never empty the tool solely due to rerank. OFF path skips the call entirely (identity). |
| **Legacy dense collection** | Dense-only query path; no sparse; lexical still OK if Postgres-backed |
| **Multi-repo** | Every vector/SQL filter includes `repo_id`; E8 scoped clear on full index |

### E1 absolute-floor rule (resolved)

High-confidence lexical matches (`symbol_exact`, `path_exact`, `path_suffix` with `/` boundary) set evidence credit `1` so they clear `SEARCH_ABSOLUTE_SCORE_FLOOR`. Soft symbol uses `0.4`. Content is not on the E1 SQL hot path. **Every** hydrated hit must clear the absolute floor (exact lexical does not retain weak hybrid companions).

### E1 fusion policy (MVP amendment)

E1 ships **exact-kind priority + score sort**, not full 3-channel `fuseRrf` yet. Soft lexical never outranks hybrid-only by kind. Promote to domain RRF with `RetrievalChannel = "lexical"` in a follow-up once cutoff rules for three channels are specified.

---

## 5. Security

- **Repo filter always applied** on Qdrant and SQL (no cross-repo bleed).
- **P0-A** refuse on hydrate/explain; crawl denylist aligned.
- **E6** fail-closed prod secrets + `CODEORACLE_ALLOWED_ROOTS` (realpath jail); worker re-validates local paths at index.
- **No secrets in traces/logs:** log repo id, query class, latency, hit counts — never chunk bodies, tokens, or `.env` contents.
- Lexical index must not become a bypass around denylist (index only what crawl allows; refuse still applies at read).

---

## 6. Compatibility

| Collection state | Dense | Sparse | Lexical (E1) |
|------------------|-------|--------|--------------|
| Hybrid `code_chunks` | named `dense` | named `text` | Parallel; fuse as channel |
| Legacy unnamed dense | unnamed vector | n/a | Parallel; fuse dense+lexical |
| Missing collection | create hybrid on full index | — | Lexical may still hit Postgres if rows exist |

Full index: `prepareChunksCollectionForFullIndex` (E8) — scoped clear when hybrid; one-time recreate only for legacy→hybrid.

---

## 7. Test strategy

| Layer | What |
|-------|------|
| **Unit (core-domain)** | RRF with 3 channels; cutoff with lexical present; absolute floor + lexical bypass rule (E1) |
| **Unit (retrieval)** | `searchCodebase` deps seam: lexical-only, dense+lexical, secret refuse, empty absolute |
| **Failure-class fixtures** | Exact symbol/path; soft NL; garbage → empty; `.env2` refuse |
| **Golden / replay** | Exact class golden (E1 AC); soft NL goldens must not regress |
| **Latency smoke** | Record p95 for search with lexical on/off in dogfood notes (E1 / E5) |
| **Integration** | Existing full-pipeline; extend when lexical needs Postgres FTS migration |

---

## 8. Metrics

| Metric | Intent |
|--------|--------|
| **hit@3** / **MRR** | Soft NL + exact class (separate slices) |
| **empty_rate** | Garbage / no-match should be high; in-domain should be low |
| **p95_ms** (`search_codebase`, `find_decision`) | Latency budget; E5 adds SLOs + cache |
| **stale_index_age** | Time since last successful index for repo |
| **lexical_hit_rate** / **lexical_unavailable** | E1 health |
| **secret_refuse_count** | P0-A signal (no payload text) |

Export path: structured logs today; **E7** OTel later.

---

## 9. Non-goals (this issue)

- Implementing E1 exact index, E3 BM25, or E2 rerank in the same PR as this doc  
- Second MCP tool or “grep product” surface  
- In-tree fork of `microsoft/tgrep` unless E1 justifies an adapter with clear ownership  
- Multi-repo workspace product (E14)  
- Changing Stage 6 public launch scope  

**tgrep lesson:** indexed lexical lane beats embed-only for symbols/paths — orthogonal stack; we take the lesson, not the binary.

---

## Current → target map

| Stage | On `main` now | Target |
|-------|---------------|--------|
| Retrieve | Dense + sparse hybrid RRF | + lexical channel (E1) |
| Sparse quality | Hash bag + IDF | **E3:** BM25 TF (doc) + Qdrant IDF; full reindex required (`sparse_encoder=bm25-tf-v1`) |
| Rerank | Hook + kill-switch (`SEARCH_RERANK_ENABLED=false`) | Optional CE/late-interaction provider (E2.1) when eval shows lift |
| Floors / refuse | P0-A + P0-B | Keep; extend for lexical (E1) |
| Isolation | E8 scoped full-index clear | Keep |

### E2 latency budget

- Cap: ≤ `SEARCH_RERANK_MAX_CANDIDATES` (default 20) post-filter candidates.
- Timeout: `SEARCH_RERANK_TIMEOUT_MS` (default 150ms) — fail-open on exceed.
- Target: p95 ≤ timeout for a local cross-encoder on ≤20 short texts; cloud CE may need a higher budget.
- Result `score` remains fused RRF (rerank reorders only; lists may be non-monotonic in score).

---

## E1 implementation sketch (for the next PR)

1. Interface `LexicalSearch` in retrieval: `{ repoId, query, limit } → { id, score }[]`.  
2. Postgres-backed MVP: exact/prefix on `symbol_name`, path match on `file_path`, optional `ILIKE`/`tsvector` on content — **chunk ids only**.  
3. Wire into `searchCodebase` as a third RRF channel (domain `fuseRrf`).  
4. Resolve absolute-floor interaction (section 4 open point).  
5. Goldens + latency note; no new MCP tool.

---

## References

- Roadmap: `CodeOracle-planning/enterprise-roadmap-2026-09.md`  
- Retrieval README: `packages/retrieval/README.md`  
- Issues: E0 #40, E1 #45, E3 #46, E2 #47, E8 #44 (done), P0-A #41 (done), P0-B #43 (done)
