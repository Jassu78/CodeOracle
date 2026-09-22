# CodeOracle — Production Implementation Spec

**Status:** Active build · v1 (single-repo MVP) · **₹0 / free-tier constrained**
**Supersedes:** `intro.md` (kept as the product brief; this doc is the build spec)
**Companion:** `PRD.md` — stage PRD, deliverables, success criteria (planning authority for execution)
**Owner:** Jaswanth Jogi · solo
**Horizon:** MVP in 5 weeks, hardened v1 in 8–10 weeks total
**Cost constraint (locked 27 Aug 2026):** MVP must run at **₹0 cash**. Self-host infra on existing OCI lab. **Universal OpenAI-compatible gateway** for chat + embeddings: free models by default (cloud free tiers and/or local Ollama), any OpenAI-compat `baseUrl` supported — no paid vendor SDK required for DoD.
**Last updated:** 27 Aug 2026 — see `CHANGELOG.md`

---

## 0. What changed from the intro doc, and why

The original brief was directionally right — scope discipline, MCP-first, self-hosted — but left the hardest parts undesigned. Nine changes, each because leaving it undesigned would have caused real production failure:

| # | Change | Why it matters |
|---|---|---|
| 1 | **Chunking is now AST-based (tree-sitter), not "function/class chunks"** | Naive line/regex chunking cuts functions mid-body. Retrieval quality is capped by chunk quality — this is the highest-leverage fix in the whole system. |
| 2 | **Decision extraction has a full pipeline spec** (schema, prompt contract, confidence, dedup) | This *is* the product. "Mine into structured decision objects" was a sentence, not a design. Section 3 fixes that. |
| 3 | **Postgres from day one, not SQLite → Postgres later** | BullMQ workers write concurrently; SQLite lock contention is a real failure mode under any real load, and schema migration later is pure waste. |
| 4 | **Embedding model is pinned, with a versioning strategy** | "Local and/or cloud" isn't a decision. Every chunk now carries an `embedding_model_id` so switching models doesn't silently corrupt retrieval. |
| 5 | **MCP server has an auth story from the start** | Even self-hosted, the HTTP/SSE transport (which you'll want beyond one laptop) needs a bearer token. Undesigned auth is how private codebases leak. |
| 6 | **Eval harness is a first-class deliverable, not an afterthought** | Without a golden-query test set, "does `find_decision` actually work" has no answer. This is now part of Definition of Done. |
| 7 | **Incremental reindex has an actual diff algorithm** | "Push → incremental re-index" was asserted, not designed. Section 4 defines exactly what gets invalidated and re-processed on a push. |
| 8 | **Multi-language chunking is explicit** | CodeOracle indexes *other people's* repos — Python, Go, Java, C++ — not just its own TypeScript. tree-sitter grammars are enumerated per language. |
| 9 | **License + CI for the project itself are in scope** | "Production-level" includes the project's own hygiene: tests, lint, a license file, a release process. |

Everything else from the intro doc — the product test, the differentiation table, the phased single-repo → monorepo → multi-repo workspace scope, the OSS-first monetization order — is correct and carried forward unchanged.

---

## 1. Product test (unchanged)

> If you remove a fancy UI and still have a sharp capability — *queryable architectural decisions for any coding agent* — you built CodeOracle, not a clone.

**Is / is not:**

| Is | Is not |
|---|---|
| Decision / rationale memory for agents | Another "chat with your repo" UI |
| MCP tools any editor can call | Locked to one IDE |
| Index of code **+** git/PR history | Only AST / file embeddings |
| Self-hosted Docker Compose | "Send your monorepo to our cloud" by default |
| Incremental updates via GitHub webhooks | Manual re-upload every week |

**Out of scope for v1** (avoid the clone trap): competing with Cursor's built-in "what does this function do?" search, building a full IDE, perfect multi-language AST coverage for every language on day one. Focus stays on decision memory + MCP + freshness.

---

## 2. Architecture

Five layers: source → indexing pipeline → storage → MCP interface → consuming agent. See the system diagram in `PRD.md` §6 for the visual shape; component-level detail below.

### 2.1 Component responsibilities

**Webhook listener** (NestJS controller)
Receives GitHub `push` and `pull_request` (merged) events. Verifies the HMAC signature against the configured webhook secret — reject anything unsigned or mismatched. Enqueues a `reindex` job with the diff (changed file paths + before/after SHAs) rather than re-crawling the whole repo.

**Initial crawler** (one-time, on repo registration)
Clones the repo shallow, walks the tree respecting `.gitignore` and a configurable exclude list (`node_modules`, `dist`, generated files, binary assets), and enqueues a `full_index` job. Also walks GitHub's PR and commit history via the REST API (paginated, rate-limit aware) to seed the initial decision corpus.

**Chunker** (tree-sitter, language-dispatched)
Parses each source file with the language-appropriate tree-sitter grammar and extracts function/method/class-level nodes as chunks, each carrying its byte range, containing file, symbol name, and parent symbol (for methods inside classes). Falls back to fixed-size sliding-window chunking (with overlap) only for languages/files with no grammar available — never silently drops a file.

**Decision extractor** (LLM pass, batched)
Takes a PR's title + body + linked commit messages + the diff summary, and extracts zero or more structured `Decision` objects (schema in §3). Runs as its own BullMQ job type so it can be retried, rate-limited, and cost-tracked independently of embedding.

**Embedder**
Embeds chunk text and decision text with the pinned model, writes vectors to Qdrant with `embedding_model_id` as payload metadata. Batches requests; respects provider rate limits with exponential backoff.

**Storage** — two systems, one source of truth each:
- **Postgres**: repos, files, chunks (metadata only — text lives alongside, not duplicated in Qdrant payload beyond what's needed for citation), decisions, index job history, users/tokens.
- **Qdrant**: two collections — `code_chunks` and `decisions` — each vector tagged with `repo_id`, `embedding_model_id`, and the Postgres row id it maps back to.

**MCP server** (stdio + optional HTTP/SSE transport)
Exposes the three tools (§5). Reads from Postgres for metadata/citation assembly and from Qdrant for retrieval. Stateless — safe to run multiple instances behind the HTTP transport if ever needed.

### 2.2 Why this shape

Separating the *extractor* from the *embedder* as distinct job types (rather than one "process a PR" job) means a failure or cost spike in LLM extraction never blocks embedding, and either stage can be re-run independently — important once you're paying per-token for extraction and want to iterate on the prompt without re-embedding everything.

---

## 3. Data model

### 3.1 Decision object (the core artifact)

```typescript
interface Decision {
  id: string;                    // uuid
  repo_id: string;
  topic: string;                 // short, e.g. "Database choice: Postgres vs MongoDB"
  summary: string;                // 1-3 sentence plain-language rationale
  alternatives_considered: string[]; // e.g. ["MongoDB", "DynamoDB"]
  decided_at: string;             // ISO date, from commit/PR merge date
  source_type: 'pr' | 'commit' | 'review_comment';
  source_url: string;             // link back to GitHub
  source_sha: string;
  touched_paths: string[];        // files this decision relates to
  confidence: number;             // 0-1, from extraction pass
  superseded_by: string | null;   // id of a later Decision that overrides this one
  embedding_model_id: string;
  created_at: string;
}
```

`superseded_by` is what makes this a *living* memory instead of an append-only log — when the extractor finds a new decision whose topic closely matches (embedding similarity above a threshold) an existing one, it links them instead of duplicating. `find_decision` always prefers the non-superseded chain tip but can show history on request.

**`source_type: 'review_comment'` is schema-ready but out of MVP scope.** The Stage 2 crawler (§8, Week 2) only fetches PR titles/bodies/merge commits via Octokit — it does not walk PR review comment threads. Leaving the enum value in place costs nothing and avoids a schema migration later, but do not build extraction logic against review comments until Stage 6+; claiming it works in the MVP README would be false advertising.

### 3.2 Chunk

```typescript
interface CodeChunk {
  id: string;
  repo_id: string;
  file_path: string;
  symbol_name: string | null;     // function/class/method name, null for window-fallback chunks
  parent_symbol: string | null;
  language: string;
  byte_start: number;
  byte_end: number;
  content_hash: string;           // for change detection without re-diffing content
  embedding_model_id: string;
  last_indexed_sha: string;
  created_at: string;
}
```

### 3.3 Repo registry

```typescript
interface Repo {
  id: string;
  github_full_name: string;       // "org/name"
  default_branch: string;
  webhook_secret_hash: string;
  last_full_index_at: string | null;
  last_incremental_at: string | null;
  index_status: 'pending' | 'indexing' | 'ready' | 'error';
  embedding_model_id: string;     // locked per-repo at registration time
}
```

Pinning `embedding_model_id` per repo (not globally) means you can upgrade the embedding model for new repos without a flag-day migration of every existing index — old repos keep working until explicitly re-indexed.

---

## 4. Incremental reindex — the actual algorithm

This was asserted but not designed in the original brief. Here's the real logic, triggered by a webhook `push` event:

1. **Diff resolution.** GitHub's push payload includes `before`/`after` SHAs. Call the compare API (`GET /repos/{repo}/compare/{before}...{after}`) to get the exact list of added/modified/deleted files — never re-walk the whole tree.
2. **Per-file handling:**
   - *Deleted file* → mark all its `CodeChunk` rows and any decisions whose `touched_paths` is now empty as stale; remove their vectors from Qdrant.
   - *Modified file* → re-chunk only that file. Diff old chunk `content_hash` values against new ones — only re-embed chunks whose hash actually changed (a formatting-only change to one function shouldn't re-embed the whole file).
   - *Added file* → chunk and embed fresh.
3. **PR/decision handling.** If the push corresponds to a merged PR (check the payload for `pull_request` context, or poll for PRs merged since `last_incremental_at` if the push doesn't carry it), run the decision extractor on that PR only — not the whole repo's history.
4. **Job idempotency.** Every reindex job is keyed by `(repo_id, after_sha)`. If the same webhook fires twice (GitHub does retry on timeout), the second job is a no-op against an already-processed SHA.
5. **Never full-rebuild on a normal push.** Full rebuild is a separate, manually-triggered operation (`POST /repos/{id}/reindex?full=true`) — used only for embedding-model upgrades or corruption recovery.

---

## 5. MCP server — tool contracts

All three tools return citations (PR/commit URL + file path) — an answer with no citation is a bug, not a feature.

### `search_codebase(query: string, top_k?: number)`
Hybrid retrieval: dense vector search (Qdrant) + sparse/keyword (BM25-style, via Qdrant's native sparse vector support) over `code_chunks`, reciprocal-rank-fused. Returns chunk text, file path, symbol name, and a relevance score.

### `explain_file(path: string)`
Returns the file's current chunk summaries plus any `Decision` objects whose `touched_paths` includes this file, ordered by `decided_at` descending (most recent rationale first, with superseded ones marked).

### `find_decision(topic: string)`
Embeds the query, searches the `decisions` collection, filters to non-superseded (unless the query explicitly asks for history), and returns the decision's summary, alternatives considered, and source citation. This is the tool that answers "why did we choose X."

### Auth
- **stdio transport** (local, single-user): no auth needed — the process runs on the developer's own machine under their own OS permissions.
- **HTTP/SSE transport** (remote/shared): every request requires a bearer token, checked against a hash stored in Postgres (`repo.webhook_secret_hash`-style table, separate `api_tokens` table with per-token scopes limited to specific `repo_id`s). Rate limit at 60 requests/minute/token by default, configurable.

---

## 6. Tech stack (locked) — free-tier / ₹0 MVP path

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | First-class MCP SDK; one language across the whole system keeps a solo build manageable. |
| API / orchestration | NestJS | DI + module structure pays off once webhook handling, job scheduling, and MCP serving are separate concerns in the same codebase. |
| Job queue | BullMQ + Redis | You already know this; battle-tested for exactly this kind of async pipeline. |
| Chunking | `web-tree-sitter` + per-language grammars (TS/JS, Python first; Go, Java, C/C++, Rust post-MVP) | Only real option for structurally-correct multi-language chunking without hand-rolling parsers. |
| Metadata store | **Postgres** in Docker on OCI (not SQLite; not Neon for MVP) | Concurrent worker writes, real migrations, no lock contention; ₹0 on your box. |
| Vector store | **Qdrant** in Docker on OCI | Native hybrid (dense + sparse) search, payload filtering by `repo_id`, standard self-host path. |
| Decision extraction LLM | **Universal OpenAI-compatible gateway** (§6.1) — free models + any compat endpoint | One protocol; any provider; failover is config. Product feels vendor-neutral. |
| Embeddings (MVP default) | **OpenAI-compatible embeddings** → Ollama (`nomic-embed-text`); any `/v1/embeddings` endpoint allowed | Same “universal” idea for vectors; Ollama is the free default, not a hard lock-in. |
| GitHub integration | Octokit (REST + webhooks); **PAT for MVP**, GitHub App post-MVP | PAT ships in week 1; App is week 6+ before public launch. |
| Hosting | Existing **OCI** Always Free box (Docker Compose: API + worker + Postgres + Redis + Qdrant) | Confirm Ampere A1 quota still matches your shape after Oracle’s 2026 Always Free reductions. |
| Packaging | Docker Compose, one `docker compose up` | Matches the self-hosted promise; no k8s for single-repo MVP. |
| CI | GitHub Actions free tier: lint, typecheck, unit tests, fixture-repo integration test | Project tests itself. |
| License | MIT (OSS core) | Adoption / stars first. |

### 6.1 Universal OpenAI-compatible gateway (chat + embeddings)

**Product feel:** CodeOracle is not “a Gemini app” or “a Groq app.” It is a **universal client**: anything that speaks OpenAI’s HTTP API works — free cloud models, free local models, paid models later — without code changes.

#### Protocol (locked)

| Capability | Wire protocol | Default free target |
|---|---|---|
| Decision extraction (chat / tools / JSON) | `POST {baseUrl}/v1/chat/completions` | Free cloud models (Gemini compat, Groq, OpenRouter free, Mistral free, …) **or** local Ollama/LM Studio |
| Embeddings | `POST {baseUrl}/v1/embeddings` | Ollama OpenAI-compat (`nomic-embed-text`); any other `/v1/embeddings` endpoint allowed |

**No vendor SDKs in the hot path.** One thin adapter; providers are data.

```ts
type OpenAiCompatEndpoint = {
  id: string;                 // "gemini-free" | "groq" | "ollama-local" | "custom-..."
  kind: 'chat' | 'embeddings';
  baseUrl: string;            // e.g. https://api.groq.com/openai  OR  http://127.0.0.1:11434/v1
  apiKeyEnv?: string;         // optional — local Ollama often needs none / "ollama"
  model: string;              // free or paid model id
  priority: number;           // lower = tried first (chat failover chain)
  enabled: boolean;
};
```

Config lives in env + `providers.yaml` (or equivalent). Users add a row → new provider. Shipping defaults favor **free models**; power users point `baseUrl` at anything OpenAI-compatible (vLLM, LiteLLM, Azure OpenAI shape, OpenRouter, etc.).

#### Recommended ₹0 chat chain (defaults — not hard locks)

| Priority | Endpoint example | Role |
|---|---|---|
| 1 | Gemini Flash (OpenAI-compat `baseUrl`) | Free primary — strong structured JSON |
| 2 | Groq (OpenAI-compat) | Free fast failover |
| 3 | OpenRouter **free** model ids | Free variety / last resort |
| 4 (optional) | Mistral free / Codestral | Free A/B for code-ish PRs |
| always-on escape | **Ollama** `/v1` + local free model (e.g. `qwen2.5-coder`) | Offline / air-gap / zero cloud |

Failover: on `429` / `5xx` / network → next **enabled** chat endpoint by `priority`. Non-retryable `4xx` (bad key/model) → skip that endpoint, continue chain, surface a clear error if all fail.

#### Embeddings (universal, free default) — including failure handling

- MVP default: Ollama OpenAI-compat embeddings + `nomic-embed-text`.
- Same client code can target any `/v1/embeddings` (future paid code models, remote embed servers).
- Every vector stores `embedding_model_id` (= `provider_id/model`) so swapping endpoints never silently mixes incompatible spaces.
- **Embeddings use the same `OpenAiCompatEndpoint` list shape as chat, with `kind: 'embeddings'`.** A single local Ollama endpoint is a single point of failure for the whole indexing pipeline — configure at least one fallback embeddings endpoint (a second Ollama model, or a free-tier cloud embed endpoint) so a crashed/OOM'd local Ollama process doesn't silently stall every `full_index` and `push` job.
- **Failure mode if all embedding endpoints are down:** the job must fail loudly (status `error` on the `repos` row, logged with endpoint id) — never silently skip embedding and leave a chunk half-indexed with no vector.

#### Universal rules

1. **Free models are first-class** — documented defaults; README shows “all-local free” and “free-cloud + local embed” recipes.
2. **One request shape** for all chat providers — swapping order or adding LiteLLM/vLLM is config.
3. **Log** `provider_id`, `model`, latency, tokens on every job.
4. **Cap concurrency** per endpoint so free quotas are not burned by crawls.
5. **Never require a paid key** for MVP Definition of Done.
6. README must say: *“If it has an OpenAI-compatible base URL, CodeOracle can use it.”*
7. **Redact before send.** Before any PR body, commit message, or diff text is sent to a chat endpoint for extraction, run it through a lightweight secret-pattern scrubber (common key formats: `AKIA...`, `sk-...`, `ghp_...`, generic `-----BEGIN ... KEY-----` blocks, `.env`-style `KEY=value` lines with high-entropy values). This is a best-effort filter, not a guarantee — document that limitation in the README — but shipping zero redaction on a tool whose whole pitch is "self-hosted, private" is a real credibility and security gap.

### 6.2 Free-tier component map

| Component | Free / universal option (MVP) | If you outgrow it later |
|---|---|---|
| Postgres | Docker on OCI | Neon/Supabase free tier |
| Redis | Docker on OCI | Upstash free tier |
| Qdrant | Docker on OCI | Qdrant Cloud free tier |
| Embeddings | Any OpenAI-compat `/v1/embeddings` — default Ollama free | Paid embed APIs (optional) |
| Extraction LLM | Any OpenAI-compat `/v1/chat/completions` — default free-model chain | Paid models via same gateway |
| GitHub API | Authenticated free (5k req/h) | Fine for solo |
| Hosting | OCI Always Free | Upgrade shape / pay-as-you-go |

---

## 7. Evaluation harness (new — was missing entirely)

Without this, "does it work" has no answer. Required before MVP is called done:

1. **Golden query set.** For each fixture/test repo, hand-write 10–15 queries with known-correct answers: 5 `find_decision` queries where you know the PR that should be cited, 5 `search_codebase` queries where you know which function should rank top-3, 5 `explain_file` queries on files with a clear decision history.
2. **Scoring.**
   - `search_codebase`: hit@3 (is the expected chunk in the top 3 results?) — target ≥ 80% on the golden set before calling retrieval "good enough."
   - `find_decision`: citation correctness (does the returned `source_url` match the expected PR?) — target 100% on the golden set; if it's below that, the extraction prompt needs work, not more data.
3. **Run in CI.** The eval script runs against the fixture repo's Compose stack on every PR to the CodeOracle repo itself — a regression in chunking or extraction shows up before merge, not after a user reports a wrong answer.
4. **Re-run manually against your own real repos** before the MVP is called done — synthetic fixtures don't catch every real-world messiness (rebase-heavy history, huge PRs, non-conventional commit messages).

---

## 8. Step-by-step build plan

Five weeks to a working MVP, sequenced so every week ends with something runnable — never a week of pure scaffolding with nothing to show.

### Week 1 — Skeleton + chunker
- NestJS project scaffold: `api` module (webhook + admin endpoints), `worker` module (BullMQ processors), shared `db` module (Postgres via a query builder or lightweight ORM — Drizzle or Prisma, your call).
- Docker Compose: Postgres + Redis + Qdrant wired up, `docker compose up` gets all three healthy.
- Postgres schema migration for `repos`, `chunks`, `decisions`, `api_tokens` (§3).
- Tree-sitter chunker: wire up grammars for TypeScript, JavaScript, Python to start (add more languages incrementally). Unit tests: feed it a handful of real files, assert chunk boundaries land on actual function/class edges, not mid-body.
- **End of week 1 checkpoint:** `pnpm chunk ./some-file.ts` prints correct chunks to stdout. No embedding, no MCP yet — just prove chunking is right first, since everything downstream depends on it.

### Week 2 — Ingestion pipeline
- Initial crawler: clone a repo, walk the tree respecting `.gitignore`, enqueue chunk jobs per file.
- Embedder worker: batches chunks via **universal OpenAI-compat embeddings client** (default: Ollama `/v1/embeddings` + `nomic-embed-text`), writes vectors to Qdrant with correct payload (`repo_id`, `embedding_model_id`, back-reference to the Postgres chunk id).
- GitHub PR/commit history crawler (Octokit + PAT, paginated) — pulls PR titles/bodies/merge dates for the decision extractor to consume in week 3.
- **End of week 2 checkpoint:** point the crawler at one real (your own) repo, run `docker compose up`, and after indexing finishes, manually query Qdrant and see sensible vectors with correct metadata.

### Week 3 — Decision extraction
- Implement **universal OpenAI-compatible gateway** (§6.1): config-driven endpoints (free cloud + local), ordered failover on 429/5xx; prove a *custom* `baseUrl` works (e.g. second local model) without code changes.
- Design and iterate the extraction prompt against real PR data from your own repos — this is the part that needs the most hand-tuning, budget real time here.
- Optional afternoon: A/B two **free** chat models (e.g. Gemini Flash vs Codestral or an OpenRouter free id) on the same 10 PRs; keep the winner as default primary if clearly better.
- Decision extractor worker: batched LLM calls, writes `Decision` rows, computes embedding similarity against existing decisions for the `superseded_by` linking logic.
- Confidence scoring and a manual review CLI command (`pnpm decisions:review --repo X`) to spot-check extraction quality before trusting it.
- **End of week 3 checkpoint:** ≥10 accurate cited Decisions; failover observed in logs; README snippet shows how to add any OpenAI-compat endpoint.

### Week 4 — MCP server + webhook incremental updates
- MCP server: implement `search_codebase`, `explain_file`, `find_decision` per §5, stdio transport first.
- Webhook listener + incremental reindex logic per §4 — signature verification, diff resolution, per-file chunk invalidation, PR-scoped decision extraction.
- Connect a real editor (Cursor or Claude Code) to the local MCP server and manually exercise all three tools against your own indexed repo.
- **End of week 4 checkpoint:** a coding agent can call `find_decision("why gRPC to device")` against a real repo and get a correct, cited answer.

### Week 5 — Eval harness, hardening, docs
- Build the golden query set and scoring script (§7), run it, fix whatever it surfaces.
- Add the HTTP/SSE transport + bearer token auth for anyone who wants remote access.
- GitHub Actions CI: lint, typecheck, unit tests, the fixture-repo integration test.
- README: install → connect → example queries, in under 10 minutes, as stated in the original success criteria.
- **End of week 5 checkpoint:** this is the MVP. Ship it — open the repo, post it, get first real users.

### Weeks 6–10 (post-MVP, only after week 5 ships)
- Expand tree-sitter language coverage (Go, Java, C/C++, Rust).
- Monorepo mode (v1.5, per the original scope table — packages within one repo treated as linked areas).
- Cost/observability dashboard for embedding + extraction spend.
- GitHub App packaging for one-click install (vs. manual PAT setup).

---

## 9. Definition of done (MVP)

Carried forward from the intro doc, with the eval and auth items added:

- [ ] One private repo indexes end-to-end from a `docker compose up`
- [ ] Chunk boundaries verified correct on a sample of real files (not just "it ran without error")
- [ ] Cursor or Claude Code can call all three MCP tools successfully
- [ ] `find_decision` returns at least one answer with a real PR or commit citation
- [ ] A new push updates the index incrementally, without a full rebuild
- [ ] Golden-query eval passes the thresholds in §7 (hit@3 ≥ 80%, citation correctness = 100%)
- [ ] HTTP transport requires a valid bearer token; an invalid/missing token is rejected
- [ ] CI runs lint + typecheck + unit tests + the fixture-repo integration test on every PR
- [ ] README: install → connect → example queries in under 10 minutes

---

## 10. Open decisions (need your input before/during week 1)

1. **ORM choice:** Drizzle (lighter, closer to raw SQL, good migration story) vs Prisma (more batteries-included, heavier). Either is fine — pick based on which you'd rather debug at 11pm.
2. **Embeddings for MVP:** **LOCKED default — Ollama OpenAI-compat `/v1/embeddings` + `nomic-embed-text`.** Any other OpenAI-compat embed endpoint is supported via config; paid models deferred until post-MVP pain is proven.
3. **First real test repo:** which of your own repos becomes the week-1/2/3 test subject? Prefer real PR history + hundreds of commits (`webhook-repo`, `Pdf-Worker`, or a personal repo whose decisions you already know).
4. **GitHub App vs PAT for MVP:** **LOCKED — PAT for weeks 1–5;** GitHub App as week 6+ before public launch.
5. **Default free chat primary:** Gemini Flash vs another free model after short A/B — default primary = Gemini until A/B says otherwise; chain remains universal either way.
6. **OCI quota check:** confirm Always Free Ampere shape still has enough RAM/OCPU for Postgres + Redis + Qdrant + Ollama on the same box (batch jobs are OK slow; OOM is not).

---

## 11. Relation to ContextVault (unchanged from intro doc)

Both projects share a retrieval spine: chunk → embed → hybrid retrieve → cite sources → Docker. Build CodeOracle first so that spine exists and is proven; ContextVault reuses it with different connectors (PDFs, Notion, Drive, markdown) and a chat + admin UI instead of MCP tools.

| | CodeOracle (now) | ContextVault (next) |
|---|---|---|
| Corpus | Git + PR + code | PDFs, Notion, Drive, markdown |
| Interface | MCP tools | Chat + admin + connectors |
| Differentiator | WHY / decisions | Auditable private RAG |

---

## 12. References in this workspace

- Product brief (*why*): `intro.md`
- This doc (*how* / engineering): `production-spec.md`
- Stage PRD / deliverables / success (*execution planning*): `PRD.md`
- Portfolio of alternative project options: `project_recommendations.html`
- Profile / stack context: `Jaswanth-Jogi-Full.pdf`
