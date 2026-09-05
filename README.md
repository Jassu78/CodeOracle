# CodeOracle

**Self-hosted MCP server that searches your code and remembers why it was built that way.**

Works with any editor MCP client (Cursor, Claude Code, and others). Stays fresh via GitHub webhooks or local reindex. **₹0 / $0 for the default path** — no paid API required.

> **Status:** Stages 0–5 on `main` — hybrid search, decision extraction, three citation-backed MCP tools, scoped API auth, Streamable HTTP MCP, golden eval in CI, and multi-stage Docker images.

---

## Why it exists

Coding agents burn tokens re-reading the same files and rediscovering old design choices. CodeOracle indexes a repository once, then answers with **small, cited slices**:

| Without CodeOracle | With CodeOracle |
|--------------------|-----------------|
| Paste or walk large trees into context | Retrieve a few ranked chunks + paths |
| Re-litigate “why did we…?” from git archaeology | `find_decision` returns WHY + source PR/commit URL |
| Guess the right file | `search_codebase` / `explain_file` with citations |

It does **not** replace the model’s reasoning. It **narrows the haystack** so the model spends tokens on the answer, not the scavenger hunt.

---

## What you get

### MCP tools

| Tool | Job | Needs |
|------|-----|--------|
| `search_codebase` | Semantic + hybrid search over indexed chunks | Embeddings |
| `explain_file` | Chunks for a path + related Decisions (deterministic, no LLM rewrite) | Index only |
| `find_decision` | Architectural decisions (WHY), alternatives, confidence, source URL | Chat model for extraction (once); retrieval is embed + DB |

Every answer is citation-backed (file path and/or GitHub PR/commit URL).

### Pipeline (high level)

1. **Register** a GitHub repo or local git mirror  
2. **Worker** clones, chunks (tree-sitter), embeds into Qdrant, stores metadata in Postgres  
3. Optionally **extract Decisions** from PR/commit history via any OpenAI-compatible chat host  
4. **MCP** serves tools over stdio (local editor) or Streamable HTTP (remote, bearer required)  
5. **Webhooks** (GitHub push) queue incremental reindex so the index stays fresh  

### Stack

| Piece | Role |
|-------|------|
| Postgres | Source of truth — repos, chunks metadata, decisions, job history, API tokens |
| Redis + BullMQ | Job queue |
| Qdrant | Dense (+ sparse hybrid after full reindex) vectors |
| Ollama (default) | Local embeddings (`nomic-embed-text`) |
| Any OpenAI-compatible `/v1` host | Chat for extraction; optional remote embeddings |

Providers are **config-only** (`providers.yaml`). Failover on 429 / 5xx / network. Adding a provider is never a new SDK.

---

## Requirements

- **Node.js** 20.11+ (&lt; 25)  
- **pnpm** 9+ (`corepack enable`)  
- **Docker** + Docker Compose (Postgres, Redis, Qdrant)  
- **git**  
- **[Ollama](https://ollama.com)** on the default path (or another embeddings endpoint in `providers.yaml`)

Optional: a free-tier chat key (Gemini / Groq / OpenRouter / Ollama Cloud) for decision extraction.

---

## Time-to-first-query (≤ 10 minutes)

### 1. Clone and install

```bash
git clone https://github.com/Jassu78/CodeOracle.git
cd CodeOracle
corepack enable
pnpm install
```

### 2. Config + data plane

```bash
cp .env.example .env
cp providers.yaml.example providers.yaml

cd infra/compose && docker compose up -d && cd ../..
pnpm db:migrate
```

`.env` defaults match Compose (`DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`). Change passwords only if you change Compose.

### 3. Embeddings

Default `providers.yaml` enables **Ollama** embeddings (`nomic-embed-text`):

```bash
ollama pull nomic-embed-text
```

Search and `explain_file` work with embeddings alone. For `find_decision` after extraction, enable one **chat** endpoint in `providers.yaml` and set its API key in `.env`.

### 4. Run worker + register a repo

```bash
# Terminal A — keep running
pnpm worker

# Terminal B — local mirror (no GitHub PAT)
pnpm --filter @codeoracle/cli start -- repo register --local-path /absolute/path/to/your/repo
# → prints a repo UUID

pnpm --filter @codeoracle/cli start -- repo index <repoId>
pnpm --filter @codeoracle/cli start -- repo status <repoId>   # wait until indexStatus=ready
```

**GitHub instead:** set `GITHUB_PAT` in `.env`, then:

```bash
pnpm --filter @codeoracle/cli start -- repo register --github OWNER/REPO --branch main
pnpm --filter @codeoracle/cli start -- repo index <repoId>
```

Guided alternative: `pnpm --filter @codeoracle/cli start -- init` (doctor → scaffold → register → queue index → print MCP config).

### 5. Connect MCP (stdio — typical editor setup)

```bash
pnpm --filter @codeoracle/cli start -- mcp-config <repoId>
```

Paste the JSON into Cursor **Settings → MCP** (or `.cursor/mcp.json`). Reload MCP servers.

Or set `CODEORACLE_REPO_ID=<repoId>` in `.env` and run:

```bash
pnpm mcp          # stdio
pnpm mcp:http     # Streamable HTTP — bearer required (see below)
```

### 6. Extract decisions (optional but recommended)

```bash
pnpm --filter @codeoracle/cli start -- decisions extract <repoId>
pnpm decisions:review <repoId>
```

Use `EXTRACT_QUEUE_LIMIT` / `--limit N` for a small first sample. Soft daily cost control: `EXTRACT_REPO_DAILY_TOKEN_BUDGET`.

### 7. Example prompts

| Tool | Example |
|------|---------|
| `search_codebase` | `"where do we validate JWT"` |
| `explain_file` | path: `"src/auth/middleware.ts"` |
| `find_decision` | topic: `"why Redis for sessions"` |

Tip: for search, **symbol / API names** often beat vague natural language (“verifyGitHubSignature …” vs “where do we verify webhooks”).

---

## Stay fresh (GitHub webhooks)

1. Set `GITHUB_WEBHOOK_SECRET` in `.env` (same value you configure on GitHub).  
2. Run the HTTP API (`pnpm api`) behind HTTPS in production.  
3. Create a GitHub webhook:  
   - URL: `https://<your-host>/webhooks/github`  
   - Content type: `application/json`  
   - Secret: same as `GITHUB_WEBHOOK_SECRET`  
   - Events: **Push** (and Ping)  

Push → HMAC verify → queue `incremental_reindex`. Details: [`apps/api/README.md`](./apps/api/README.md).

---

## MCP transports

| Mode | Command | Auth |
|------|---------|------|
| **stdio** (default) | `pnpm mcp` | Process isolation (editor spawns the process) |
| **Streamable HTTP** | `CODEORACLE_MCP_TRANSPORT=http pnpm mcp:http` | Bearer **required** — `API_TOKEN`, `MCP_HTTP_BEARER_TOKEN`, or a per-repo `co_…` token |

HTTP defaults: `MCP_HTTP_HOST=127.0.0.1`, `MCP_HTTP_PORT=3100`, path `/mcp`. Open-dev is **not** allowed on HTTP. See [`apps/mcp-server/README.md`](./apps/mcp-server/README.md).

**Cursor stdio example** (from `mcp-config`):

```json
{
  "mcpServers": {
    "codeoracle": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/CodeOracle", "mcp"],
      "env": {
        "CODEORACLE_REPO_ID": "<repo-uuid>"
      }
    }
  }
}
```

**Remote HTTP example** (any MCP client that supports Streamable HTTP + headers):

```json
{
  "mcpServers": {
    "codeoracle": {
      "url": "https://<your-host>/mcp",
      "headers": {
        "Authorization": "Bearer <API_TOKEN or scoped token>"
      }
    }
  }
}
```

---

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

Keep Ollama embeddings. Enable `gemini-free` / `groq-free` / `openrouter-free` / `ollama-cloud` in `providers.yaml.example` and set the corresponding `*_API_KEY`.

---

## Auth (API + MCP HTTP)

| Principal | Use |
|-----------|-----|
| Open-dev | No `API_TOKEN` and no `api_tokens` rows — **local API only** |
| `API_TOKEN` | Admin — any repo; mint tokens |
| Per-repo `co_…` token | Scoped to one `repoId` (cross-repo → 403) |

MCP **HTTP** always requires a bearer. Details: [`apps/api/README.md`](./apps/api/README.md), [`apps/mcp-server/README.md`](./apps/mcp-server/README.md).

---

## CLI cheat sheet

```bash
pnpm --filter @codeoracle/cli start -- init
pnpm --filter @codeoracle/cli start -- repo register --github OWNER/REPO
pnpm --filter @codeoracle/cli start -- repo index <repoId>
pnpm --filter @codeoracle/cli start -- repo status <repoId>
pnpm --filter @codeoracle/cli start -- repo recover <repoId>
pnpm --filter @codeoracle/cli start -- decisions extract <repoId> [--clear] [--limit N]
pnpm --filter @codeoracle/cli start -- decisions review <repoId>
pnpm --filter @codeoracle/cli start -- decisions failures <repoId>
pnpm --filter @codeoracle/cli start -- mcp-config <repoId>
```

Root shortcuts: `pnpm worker`, `pnpm api`, `pnpm mcp`, `pnpm mcp:http`, `pnpm decisions:review`, `pnpm db:migrate`.

---

## Repo layout

```
apps/        api, worker, mcp-server, cli
packages/    contracts, config, db, chunker, gateway, retrieval, extraction, …
infra/       Docker Compose, CI notes, optional multi-stage images
test/        sample-repo fixture, golden eval, e2e
```

Package READMEs under `apps/` and `packages/` cover deeper design notes.

---

## Production notes (generic)

- Run **API + worker + MCP** as long-lived processes (or containers); keep Compose for Postgres / Redis / Qdrant.  
- Put the API (and optional MCP HTTP) behind **HTTPS** with a reverse proxy.  
- Bind data services to **localhost** (or a private network)—do not expose Postgres/Redis/Qdrant/Ollama publicly.  
- Set `API_TOKEN` (and webhook secret) before exposing the API.  
- Optional images: [`infra/docker/README.md`](./infra/docker/README.md).  
- Full reindex recreates the Qdrant `code_chunks` collection — fine for single-repo dogfood; plan carefully for multi-repo on one Qdrant.

---

## Quality & CI

PRs must pass lint, typecheck, unit tests, Compose smoke, integration e2e, and golden eval (`pnpm test:eval`). See [`infra/ci/README.md`](./infra/ci/README.md) and [`test/golden-queries/README.md`](./test/golden-queries/README.md).

Known practical limits (honest):

- Soft natural-language search can prefer **docs** over implementation symbols — prefer precise queries.  
- Decision **alternatives** are often empty; top-1 topics are usually stronger than long ranked lists.  
- Extraction quality depends on the chat model and PR/commit text quality.

---

## License

MIT — see [`LICENSE`](./LICENSE). Copyright (c) 2026 Jaswanth Jogi.

Launch checklist: MIT ✓ · `.env.example` ✓ · Compose data stack ✓ · host `pnpm` apps ✓ · multi-stage images (`infra/docker`).
