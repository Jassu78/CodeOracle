# CodeOracle — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| **Document type** | Stage PRD · execution authority |
| **Product** | CodeOracle v1 (single-repo MVP) |
| **Owner** | Jaswanth Jogi |
| **Status** | Approved for planning · free-tier / ₹0 constrained |
| **Date** | 27 Aug 2026 |
| **Related** | `intro.md` (why) · `production-spec.md` (how) |
| **Last updated** | 27 Aug 2026 — see `CHANGELOG.md` |

**Document authority:** This PRD defines *what* each stage must deliver and *what success means*. The production spec defines *how*. The intro defines *why*. If execution conflicts with the intro on product intent, pause and resolve; if execution conflicts with the spec on mechanism, update the spec and continue.

---

## 1. Executive summary

CodeOracle is a **self-hosted MCP server** that gives AI coding agents persistent memory of a codebase’s **architectural WHY** — decisions mined from commits, PRs, and review context — with citations back to source.

**v1 goal:** One developer can index **one** private GitHub repo at ₹0, connect Cursor or Claude Code via MCP, and get cited answers to “why did we choose X?” that beat guessing from current files alone.

**Non-goal for v1:** Multi-repo workspaces, managed SaaS, IDE UI, competing with editor-native code search.

---

## 2. Problem & opportunity

| Stakeholder | Pain |
|---|---|
| Solo / indie developer using Cursor/Claude Code | Agents forget prior decisions between sessions |
| Small teams with private repos | Cloud code-intel (Cody, Greptile) is expensive or unacceptable for data residency |
| Hiring / portfolio | “I extended the AI tooling ecosystem (MCP), not just used chatbots” |

**Opportunity:** Auto-extract **decision objects** from git history, expose them over MCP, keep them fresh via webhooks — self-hosted, free to run for the builder.

---

## 3. Goals, non-goals, constraints

### 3.1 Goals (MVP)

1. Index one GitHub repo (code + PR/commit history) end-to-end.
2. Expose three MCP tools with **mandatory citations**.
3. Incremental reindex on push without full rebuild.
4. Run on **₹0** via a **universal OpenAI-compatible gateway** (free local + free cloud models; any compat endpoint).
5. Prove quality with a **golden-query eval** harness.

### 3.2 Non-goals (v1)

- Multi-repo / org-wide workspace (v2)
- Web dashboard as primary UX
- Paid embedding APIs as a hard dependency
- Perfect AST for every language on day one
- Replacing Cursor’s “what does this function do?” search
- **Architectural drift detection** (import graph vs. recorded decisions) — competitor WhyCode already does this well; see `competitive-strategy.md` §6
- **AST-level bidirectional code↔decision provenance** (`provenance.reverse()`-style) — same reason
- **Independent quality harness / test-tautology detection** — same reason
- **OAuth / team billing tiers** — premature before v1 proves the differentiated wedge

*(Added 27 Aug 2026 after competitive research — see `competitive-strategy.md`.)*

### 3.3 Hard constraints

| Constraint | Rule |
|---|---|
| **Cost** | ₹0 cash for MVP. No required paid APIs. |
| **Infra** | Docker Compose on existing OCI Always Free (verify Ampere quota). |
| **LLM / embeddings** | **Universal OpenAI-compatible gateway** — free models first-class; any `baseUrl` that speaks `/v1/chat/completions` or `/v1/embeddings` (Ollama, Groq, Gemini compat, OpenRouter free, LM Studio, vLLM, LiteLLM, …). |
| **Default ₹0 recipe** | Embeddings: Ollama free local. Chat extraction: free-model chain (Gemini → Groq → OpenRouter free) + Ollama escape. |
| **Auth (GitHub)** | PAT for MVP; GitHub App post-MVP. |
| **Scope** | Single repo registration only. |

---

## 4. Users & jobs-to-be-done

| Persona | Job | Success moment |
|---|---|---|
| **Builder (you)** | Dogfood on own repos while building | Agent cites a real PR you remember |
| **Indie OSS user** | Self-host and connect MCP in <10 minutes | First `find_decision` returns a useful citation |
| **Future: small team lead** | Private decision memory without SaaS | (Post-MVP) shared HTTP MCP with tokens |

**Primary JTBD:** When I ask my coding agent why we built something a certain way, it retrieves grounded historical rationale instead of inventing one from current code.

---

## 5. Product principles (architecture)

1. **Decision memory > code search** — if it only searches files, it failed the product test.
2. **No citation = bug** — every tool answer must carry source URL and/or path.
3. **Async by default** — crawl, embed, extract are BullMQ jobs; MCP reads are fast.
4. **Universal OpenAI-compatible gateway** — free models + any compat endpoint; failover is config; no vendor SDK lock-in.
5. **Self-host first** — Compose up is the happy path; cloud is optional later.
6. **Measure before declaring done** — eval harness gates “MVP complete.”

---

## 6. System overview (logical)

```
GitHub (repo + webhooks)
        │
        ▼
┌───────────────────┐     BullMQ      ┌─────────────────────┐
│ NestJS API        │───────────────▶│ Workers             │
│ register, webhook │                │ chunk · embed ·     │
│ admin, tokens     │                │ extract · reindex   │
└─────────┬─────────┘                └──────────┬──────────┘
          │                                     │
          ▼                                     ▼
   ┌────────────┐                        ┌────────────┐
   │ Postgres   │◀────── citations ──────│ Qdrant     │
   │ repos,     │                        │ chunks +   │
   │ chunks meta│                        │ decisions  │
   │ decisions  │                        └────────────┘
   └─────▲──────┘
         │
┌────────┴────────┐
│ MCP server      │  stdio (MVP) / HTTP+SSE+bearer (week 5)
│ search_codebase │
│ explain_file    │
│ find_decision   │
└────────┬────────┘
         ▼
   Cursor / Claude Code
```

**Model layer (universal):** Chat and embeddings both use OpenAI-compatible HTTP. Defaults are **free** (local Ollama + free cloud chat models). Users may point the same gateway at any compatible endpoint without forking the product.

---

## 7. Functional requirements (MVP)

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Register one GitHub repo (clone + full index job) | P0 |
| FR-2 | Tree-sitter chunk TS/JS/Python; sliding-window fallback otherwise | P0 |
| FR-3 | Embed via OpenAI-compat `/v1/embeddings` (default Ollama free model); store `embedding_model_id` | P0 |
| FR-4 | Crawl PR/commit history; extract `Decision` objects via universal chat gateway | P0 |
| FR-5 | Dedup / supersede decisions by topic similarity | P1 |
| FR-6 | MCP: `search_codebase`, `explain_file`, `find_decision` with citations | P0 |
| FR-7 | Webhook HMAC verify; incremental reindex per push SHA | P0 |
| FR-8 | Job idempotency keyed by `(repo_id, after_sha)` | P0 |
| FR-9 | HTTP/SSE MCP + bearer token + rate limit | P1 (week 5) |
| FR-10 | Golden-query eval in CI | P0 (week 5 gate) |
| FR-11 | Chat provider failover on 429/5xx; support adding a custom OpenAI-compat `baseUrl` via config only | P0 |
| FR-12 | Respect `.gitignore` + exclude list; never silent-drop parseable files | P0 |
| FR-13 | Best-effort secret-pattern redaction on PR/commit/diff text before any send to a chat endpoint | P0 |
| FR-14 | Embeddings endpoint list supports ≥1 fallback; all-endpoints-down fails the job loudly (not silently) | P0 |

---

## 8. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Cost | ₹0 for builder MVP path |
| NFR-2 | Cold start | `docker compose up` → healthy deps in ≤ 5 min on OCI |
| NFR-3 | README time-to-first-query | ≤ 10 minutes for a competent TS developer |
| NFR-4 | Incremental push | Changed files only; no full rebuild |
| NFR-5 | Eval | `search` hit@3 ≥ 80%; `find_decision` citation match = 100% on golden set |
| NFR-6 | Security | Webhook signatures verified; HTTP MCP rejects bad/missing tokens |
| NFR-7 | Observability | Log provider id, model, latency, tokens per extraction job |
| NFR-8 | Privacy default | Code + embeddings stay on self-hosted infra; only PR text summaries sent to LLM providers for extraction |
| NFR-9 | Secret hygiene | Redaction filter runs on 100% of text sent to any external chat endpoint; documented as best-effort, not a guarantee |
| NFR-10 | Embedding resilience | Indexing pipeline does not stall silently if the default embedding endpoint is unreachable — fails visibly or fails over |

---

## 9. Stage plan — deliverables & success

Each stage ends with a **runnable checkpoint**. A stage is not “done” when code exists — only when success criteria pass.

---

### Stage 0 — Foundations (pre-week / Day 0–2)

**Intent:** Remove environment risk before writing product code.

| Deliverable | Description |
|---|---|
| D0.1 | OCI health check: disk, RAM, Docker, Compose; Ampere quota verified against real component budget (below) |
| D0.2 | Ollama installed; `nomic-embed-text` pull + one embed smoke test |
| D0.3 | Universal gateway smoke: ≥1 **free local** chat/embed (Ollama `/v1`) + ≥1 **free cloud** OpenAI-compat chat endpoint in `.env.example` / `providers.yaml` |
| D0.4 | GitHub PAT with least privilege for target test repo |
| D0.5 | Chosen test repo documented (name, approx commits/PRs, why) |
| D0.6 | Empty git repo for CodeOracle itself + MIT LICENSE stub |
| D0.7 | Document two recipes: (A) all-local free (B) local embed + free-cloud extract |

**Success means:**
- [ ] `docker run hello-world` and Compose work on OCI
- [ ] Ollama OpenAI-compat `/v1/embeddings` returns a vector for a sample string
- [ ] At least **two** free chat endpoints respond via the **same** OpenAI-compat client shape (e.g. Ollama + Gemini or Groq)
- [ ] Test repo clone works with the PAT
- [ ] Written note: “OCI can host Postgres+Redis+Qdrant+Ollama for batch work” (yes/no with RAM numbers)

**Exit gate:** If OCI cannot host the stack, decide laptop-first Compose before Stage 1 — do not start NestJS on a doomed host.

**Rough RAM budget (verify, don't assume):** Postgres ~256–512MB idle, Redis ~50–100MB, Qdrant ~200–400MB for a small single-repo collection, Ollama + `nomic-embed-text` loaded ~1–2GB, NestJS API + worker processes ~300–500MB combined. That's roughly **2–3.5GB under light load** — should fit inside a 12GB Ampere shape with headroom, but a 7B+ chat model loaded locally as the "offline escape" (§6.1) would push well past comfortable limits on a 12GB box. **Decision:** keep the offline-escape chat model as an opt-in, not something running by default alongside everything else — don't discover this the hard way mid-Stage-3.

---

### Stage 1 — Skeleton + chunker (Week 1)

**Intent:** Prove structural chunking; nothing else matters yet.

| Deliverable | Description |
|---|---|
| D1.1 | NestJS monorepo layout: `api`, `worker`, `db`, shared packages |
| D1.2 | Compose: Postgres + Redis + Qdrant healthy |
| D1.3 | Schema migrations: `repos`, `chunks`, `decisions`, `api_tokens`, job history |
| D1.4 | Tree-sitter chunker CLI: TS/JS/Python |
| D1.5 | Unit tests: chunk boundaries on real fixture files |
| D1.6 | ORM decision locked (Drizzle **or** Prisma) and used in migrations |

**Success means:**
- [ ] `docker compose up` → three deps healthy
- [ ] `pnpm chunk ./fixtures/sample.ts` prints symbol-aligned chunks (not mid-function)
- [ ] ≥ 1 Python + ≥ 1 JS fixture also chunk correctly
- [ ] Migrations apply clean on empty Postgres
- [ ] CI stub runs lint + unit tests on chunker (even if other packages are empty)

**Failure signals:** Regex/line chunking “for now”; SQLite “temporary”; skipping tests.

---

### Stage 2 — Ingestion + embeddings (Week 2)

**Intent:** Full-repo index into Qdrant with correct metadata — still no MCP UX.

| Deliverable | Description |
|---|---|
| D2.1 | Repo registration API/CLI (github_full_name, branch, PAT) |
| D2.2 | Initial crawler: shallow clone, `.gitignore`, exclude list |
| D2.3 | BullMQ `full_index` + per-file chunk jobs |
| D2.4 | Embedder worker → Ollama → Qdrant (`code_chunks`) with payloads |
| D2.5 | GitHub history crawler: PRs + commits stored for Stage 3 |
| D2.6 | Index status on `repos` (`pending` / `indexing` / `ready` / `error`) |

**Success means:**
- [ ] One real personal repo reaches `index_status = ready`
- [ ] Manual Qdrant query returns chunks with correct `repo_id` + `embedding_model_id`
- [ ] Spot-check: 10 random chunks map back to real file paths in Postgres
- [ ] PR/commit raw records available for ≥ N merged PRs (N ≥ 10 if repo has them)
- [ ] Re-running full index is safe (idempotent or clearly replaceable)

**Failure signals:** Embedding without model id; storing only vectors with no Postgres back-ref; ignoring rate limits on GitHub.

---

### Stage 3 — Decision extraction (Week 3)

**Intent:** Create the product’s core artifact — quality Decisions with citations.

| Deliverable | Description |
|---|---|
| D3.1 | **Universal OpenAI-compat gateway** (chat + embeddings): config list, priorities, free defaults, custom `baseUrl` |
| D3.2 | Extraction prompt + JSON schema contract for `Decision` |
| D3.3 | Extractor worker (separate job type from embed) |
| D3.4 | `superseded_by` linking via embedding similarity |
| D3.5 | `pnpm decisions:review` CLI for manual QA |
| D3.6 | Provider/usage logging (id, model, latency, tokens) |
| D3.7 | Optional: A/B two free chat models on 10 PRs; note winner |
| D3.8 | README: “add any OpenAI-compatible endpoint” + free-model recipes |

**Success means:**
- [ ] ≥ **10** Decisions manually verified as accurate + correctly cited
- [ ] Every Decision has `source_url` + `source_type` + `topic` + `summary`
- [ ] Forcing primary chat endpoint failure → job succeeds via next free endpoint (observed in logs)
- [ ] Adding a third endpoint (e.g. another Ollama model or OpenRouter free id) works **by config only**
- [ ] Low-confidence or empty extractions do not crash the pipeline
- [ ] Concurrent extraction respects a configured concurrency cap (no quota burn)

**Failure signals:** Hard-coded Gemini/Groq SDK; single-vendor-only path; “summary of the PR” without structured fields; no citation URL.

---

### Stage 4 — MCP + incremental freshness (Week 4)

**Intent:** Agents can use CodeOracle; pushes stay fresh.

| Deliverable | Description |
|---|---|
| D4.1 | MCP stdio server: three tools per production spec §5 |
| D4.2 | Hybrid retrieval for `search_codebase` (dense + sparse/RRF as available) |
| D4.3 | Webhook endpoint + HMAC verification |
| D4.4 | Incremental reindex algorithm (compare API, hash-based re-embed) |
| D4.5 | Editor config example (Cursor and/or Claude Code) |
| D4.6 | Manual agent session notes (what worked / failed) |

**Success means:**
- [ ] From Cursor or Claude Code, all three tools return usable results
- [ ] `find_decision` returns ≥ 1 answer with a **real** PR/commit URL you can open
- [ ] Answers without citations are impossible in happy path (asserted in code/tests)
- [ ] A test push updates only changed files (verified by job logs / chunk timestamps)
- [ ] Duplicate webhook delivery does not double-process the same `after_sha`

**Failure signals:** Custom chat UI instead of MCP; full rebuild on every push; tools that only search vectors with no decision path.

---

### Stage 5 — Eval, hardening, ship (Week 5)

**Intent:** Gate quality, secure remote access, make it reproducible for others.

| Deliverable | Description |
|---|---|
| D5.1 | Golden set: 10–15 queries with expected answers on fixture +/or dogfood repo. **Fixture repo lives at `test/fixtures/sample-repo` as a small, checked-in, purpose-built repo** (a handful of files + a scripted commit/PR history) — not an external clone — so CI never depends on network access to GitHub or on a real repo's history staying stable. |
| D5.2 | Scoring script: hit@3 + citation correctness |
| D5.3 | HTTP/SSE transport + bearer tokens + rate limit |
| D5.4 | GitHub Actions: lint, typecheck, unit, Compose integration test |
| D5.5 | README: install → connect → example queries ≤ 10 minutes |
| D5.6 | Public or private launch-ready repo (MIT, `.env.example`, Compose) |
| D5.7 | Re-run the competitive check from `competitive-strategy.md` — this niche moves fast; confirm the repositioned wedge (hybrid retrieval + webhook server + universal gateway) is still differentiated before public launch |

**Success means (MVP Definition of Done):**
- [ ] One private repo indexes from Compose up
- [ ] Chunk boundaries verified on sample real files
- [ ] Editor MCP tools all work
- [ ] `find_decision` cites real PR/commit
- [ ] Push = incremental, not full rebuild
- [ ] Eval: hit@3 ≥ **80%**; citation correctness = **100%** on golden set
- [ ] HTTP rejects invalid/missing bearer token
- [ ] CI green on PR
- [ ] README path completed by you on a clean machine/VM in ≤ 10 minutes
- [ ] **Cash spent on required services = ₹0**

**Ship criterion:** All boxes above checked → tag `v0.1.0-mvp`, write a short launch note. Incomplete eval = not shipped.

---

### Stage 6 — Post-MVP hardening (Weeks 6–10) — only after Stage 5 ships

| Deliverable | Success means |
|---|---|
| D6.1 More tree-sitter languages (Go, Java, C/C++, Rust) | Chunk tests pass per language |
| D6.2 Monorepo mode (packages as linked areas) | `explain_file` / decisions aware of package boundaries |
| D6.3 GitHub App auth | Install on a test repo without PAT |
| D6.4 Cost/usage dashboard (even at ₹0) | Per-provider totals visible |
| D6.5 Optional paid embed upgrade path | Documented; old indexes keep `embedding_model_id` |

**Not started until:** Stage 5 DoD is fully green.

---

### Stage 7 — Multi-repo workspace (v2) — future

Documented for roadmap clarity; **out of scope** until Stage 6 is stable.

| Deliverable | Success means |
|---|---|
| Workspace entity binding N repos | `find_decision` returns cross-repo citations |
| Shared graph + per-repo webhooks | Push to repo A does not reindex repo B |
| Cross-repo `repo_id` filtering | Tools accept optional `repo` or search whole workspace |

---

## 10. MCP tool acceptance criteria

| Tool | Must return | Must not |
|---|---|---|
| `search_codebase` | Chunk text, path, symbol (if any), score, repo id | Uncited blobs with no path |
| `explain_file` | Current structure summary + related Decisions (newest first, superseded marked) | Invented history with no sources |
| `find_decision` | Topic, summary, alternatives, `source_url`, confidence; prefer non-superseded tip | Answer with null citation |

---

## 11. Data & privacy requirements

1. Source code and embeddings remain on self-hosted Postgres/Qdrant/OCI by default.
2. LLM providers receive **PR/commit text used for extraction**, not necessarily full file bodies — keep payloads minimal.
3. Secrets only in env / secret store; never commit `.env`.
4. Webhook secrets hashed at rest; API tokens hashed; show token once at creation.
5. Document in README what leaves the machine (extraction text → whichever chat endpoints the user enabled) and the **universal** config story (any OpenAI-compat `baseUrl`).

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Free cloud tier cut | Extraction stalls | Ordered free-model chain + local Ollama escape; same gateway |
| OCI Always Free downsized | OOM / eviction | Verify quota Stage 0; laptop Compose fallback |
| Weak free/local embeddings | Poor search hit@3 | Accept for MVP; swap embed `baseUrl`/model later; eval shows pain |
| Shallow Decision objects | Product feels fake | Manual review CLI; citation-correctness gate; prompt iteration week 3 |
| Scope creep (UI, multi-repo) | No ship | Stage gates; Stage 7 explicitly parked |
| GitHub rate limits | Incomplete history | Paginate + backoff; PAT; concurrency caps |
| Solo bandwidth | Missed weeks | Checkpoints over calendar purity; don’t skip eval |

---

## 13. Metrics

| Metric | When measured | Target (MVP) |
|---|---|---|
| Time to first MCP answer (dogfood) | Stage 4–5 | < 10 min setup after Compose ready |
| Golden `search` hit@3 | Stage 5 | ≥ 80% |
| Golden `find_decision` citation accuracy | Stage 5 | 100% |
| Manual Decision precision (spot check) | Stage 3 | ≥ 10/10 reviewed “good enough” |
| Cash cost | Continuous | ₹0 |
| Incremental reindex correctness | Stage 4 | Changed files only on test push |

---

## 14. Open decisions (owner must answer)

| # | Decision | Default if undecided by Stage 1 start |
|---|---|---|
| 1 | ORM: Drizzle vs Prisma | **Drizzle** (lighter, closer to SQL) |
| 2 | First test repo | Owner picks within 48h of Stage 0 |
| 3 | Default free chat primary after A/B | **Gemini Flash** (OpenAI-compat) until another free model wins A/B; gateway stays universal |
| 4 | Dev on OCI vs laptop first | Prefer OCI if Stage 0 passes; else laptop |

---

## 15. Doc map & change control

| Doc | Authority |
|---|---|
| `intro.md` | Product intent, wedge, phased scope |
| `competitive-strategy.md` | Competitive research, repositioned wedge, scope exclusions |
| `production-spec.md` | Architecture, schemas, algorithms, stack |
| `PRD.md` (this file) | Stages, deliverables, success gates |

**Change control:** Material scope changes (multi-repo in MVP, paid API required, dropping eval) require updating this PRD first, then the production spec.

**Changelog convention:** Each doc's header carries a `Last updated` line. For any material change, append a dated one-line entry to `docs/CHANGELOG.md` (e.g. `2026-08-27 — locked universal OpenAI-compat gateway; added redaction + embedding failover requirements`) instead of relying on chat history to reconstruct why something changed.

---

## 16. Immediate next actions (architect’s recommendation)

1. Execute **Stage 0** (OCI quota + Ollama `/v1` smoke + second free OpenAI-compat chat endpoint).  
2. Lock ORM + test repo.  
3. Scaffold Stage 1 only after Stage 0 exit gate is green.  
4. Implement the **universal gateway** early (Stage 2–3) so free models and custom endpoints are native — not a later refactor.  
5. Do not start MCP or UI work before Stage 3 Decisions exist — that path builds a search toy, not CodeOracle.
