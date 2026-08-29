# CodeOracle

**Self-hosted MCP server that searches your code and remembers why it's built that way — works with any model, stays fresh automatically.**

Self-hosted. **₹0 for the default path** — no required paid API. Postgres + Redis + Qdrant via Docker Compose; embeddings via local Ollama (or any OpenAI-compatible host).

> **Status:** Stages 0–4 on `main`. Stage 5 ship hardening — MCP tools, scoped API auth, Streamable HTTP, golden eval in CI.

## Time-to-first-query (≤ 10 minutes)

Competent TypeScript developer, clean machine with **Node 20+**, **pnpm 9+**, **Docker**, and **git**.

### 1. Clone and install (~1 min)

```bash
git clone https://github.com/Jassu78/CodeOracle.git
cd CodeOracle
corepack enable
pnpm install
```

### 2. Start infra + migrate (~2 min)

```bash
cp .env.example .env
cp providers.yaml.example providers.yaml

cd infra/compose && docker compose up -d && cd ../..
pnpm db:migrate
```

`.env` defaults match Compose (`DATABASE_URL` / `REDIS_URL` / `QDRANT_URL`). Change passwords only if you change Compose.

### 3. Embeddings (~2–3 min first pull)

Default `providers.yaml` enables **Ollama local embeddings** (`nomic-embed-text`). Install [Ollama](https://ollama.com), then:

```bash
ollama pull nomic-embed-text
```

For decision extraction (`find_decision`), enable one **chat** endpoint in `providers.yaml` and set its API key in `.env` (Gemini / Groq / OpenRouter free, or local Ollama chat). Search and `explain_file` work with embeddings alone.

### 4. Index a repo (~2–4 min)

```bash
# Terminal A — keep running
pnpm worker

# Terminal B — register a local git repo (no GitHub PAT)
pnpm cli -- repo register --local-path /absolute/path/to/your/repo
# → prints a repo UUID

pnpm cli -- repo index <repoId>
pnpm cli -- repo status <repoId>   # wait until index_status=ready
```

GitHub instead: set `GITHUB_PAT` in `.env`, then `pnpm cli -- repo register --github OWNER/REPO --branch main`.

Guided alternative: `pnpm cli -- init` (doctor → scaffold → register → queue index → print MCP config).

### 5. Connect MCP (~1 min)

```bash
pnpm cli -- mcp-config <repoId>
```

Paste the JSON into Cursor **Settings → MCP** (or `.cursor/mcp.json`). Restart MCP if needed.

Or set `CODEORACLE_REPO_ID=<repoId>` in `.env` and run `pnpm mcp` (stdio). HTTP: `pnpm mcp:http` (bearer required — see `apps/mcp-server/README.md`).

### 6. Example queries

In the editor MCP panel (or any MCP client):

| Tool | Example |
|------|---------|
| `search_codebase` | `"where do we validate JWT"` |
| `explain_file` | path: `"src/auth/middleware.ts"` |
| `find_decision` | topic: `"why Redis for sessions"` |

Every answer includes citations (file path / commit). Empty `find_decision` usually means extract has not run yet:

```bash
pnpm cli -- decisions extract <repoId>
pnpm decisions:review <repoId>
```

---

## What this is

Indexes a GitHub or local git repo, chunks with tree-sitter, hybrid search (dense + sparse RRF after full reindex), extracts **Decision** objects from history, and exposes three citation-backed MCP tools: `search_codebase`, `explain_file`, `find_decision`.

Providers are **config-only** (`providers.yaml`) — any OpenAI-compatible `/v1` host. Failover on 429/5xx/network.

## Repo layout

```
apps/        api, worker, mcp-server, cli
packages/    contracts, config, db, chunker, gateway, retrieval, …
infra/       Docker Compose + CI notes
test/        sample-repo fixture + golden eval + e2e
```

## Provider recipes

**Adding a provider is a `providers.yaml` change — never a new SDK.**

1. Copy `providers.yaml.example` → `providers.yaml` (gitignored).
2. Set the matching env var in `.env`.
3. Set `enabled: true` and `priority` (lower = tried first).

### Recipe A — all local (₹0, offline)

```yaml
chat:
  - id: ollama-local
    kind: chat
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: qwen2.5-coder:1.5b
    priority: 1
    enabled: true
embeddings:
  - id: ollama-embed-local
    kind: embeddings
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: nomic-embed-text
    priority: 1
    enabled: true
```

### Recipe B — local embed + free-cloud extract

Enable `gemini-free` / `groq-free` / `openrouter-free` in the example file and set the corresponding `*_API_KEY`. Keep Ollama embeddings for ₹0 vector search.

## Auth (API + MCP HTTP)

| Principal | Use |
|-----------|-----|
| Open-dev | No `API_TOKEN` and no `api_tokens` rows — local API only |
| `API_TOKEN` | Admin — any repo; mint tokens |
| Per-repo `co_…` token | Scoped to one `repoId` only (cross-repo → 403) |

MCP **HTTP** always requires a bearer (open-dev forbidden). Details: `apps/api/README.md`, `apps/mcp-server/README.md`.

## CI

PRs must pass lint, typecheck, unit, Compose smoke, integration e2e, and golden eval (`pnpm test:eval`). See `infra/ci/README.md`.

## License

MIT — see [`LICENSE`](./LICENSE). Copyright (c) 2026 Jaswanth Jogi.

Launch checklist: MIT ✓ · `.env.example` ✓ · Compose data stack ✓ · host `pnpm` apps ✓ · optional multi-stage images (`infra/docker`).
