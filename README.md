# CodeOracle

**Self-hosted MCP server that searches your code and remembers why it's built that way — works with any model, stays fresh automatically.**

Self-hosted. **₹0 for the default path** — no required paid API or service anywhere. Runs via Docker Compose on a developer laptop or a 12GB Ampere OCI Always Free instance.

> **Status:** Stage 2 ingestion is on `main`. Stage 3 decision extraction is in progress (`extract_decisions` worker + gateway failover). MCP tools land in Stage 4.

## What this is

CodeOracle indexes a GitHub repo (or local git mirror), chunks code with tree-sitter, embeds it for **hybrid** search (dense + sparse RRF after a full reindex; legacy dense fallback otherwise), extracts structured **Decision** objects from PR/commit history, and (Stage 4) exposes three citation-backed MCP tools: `search_codebase`, `explain_file`, and `find_decision`.

Provider calls go through a universal OpenAI-compatible gateway (`providers.yaml`) with ordered failover — local Ollama, free cloud tiers, or paid APIs later, without code changes.

## Repo layout

```
apps/        deliverables you run (api, worker, mcp-server, cli)
packages/    capabilities you import (contracts, config, db, chunker, gateway, ...)
infra/       Docker Compose + CI scripts
test/        fixture repo + golden-query eval + e2e tests
```

## Getting started (current scope)

```bash
corepack enable
pnpm install

# environment check
pnpm cli doctor

# bring up Postgres + Redis + Qdrant (+ Ollama for local embeddings)
cd infra/compose && docker compose up -d

# generate + apply the database schema
cp .env.example .env   # then fill in DATABASE_URL etc.
cp providers.yaml.example providers.yaml
pnpm db:generate
pnpm db:migrate

# prove the chunker works on a real file
pnpm chunk packages/chunker/fixtures/sample.ts

# register + index a repo (requires worker)
pnpm worker   # separate terminal
pnpm cli -- repo register --github OWNER/REPO --branch main
pnpm cli -- repo index <repoId>
pnpm decisions:review <repoId>
```

## Provider gateway (OpenAI-compatible)

Every chat/embed call goes through `@codeoracle/gateway` → `OpenAiCompatAdapter`.
**Adding a provider is a `providers.yaml` change — never a new SDK.**

1. Copy `providers.yaml.example` → `providers.yaml` (gitignored).
2. Set the matching env var in `.env` (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, …).
3. Set `enabled: true` and a `priority` (lower = tried first).
4. On **429 / 5xx / network** errors, the next enabled endpoint is tried.
5. Provider-specific **4xx** (bad key / missing model) also skips to the next endpoint.

### Recipe A — all local (₹0, offline-capable)

```yaml
chat:
  - id: ollama-local
    kind: chat
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: qwen2.5-coder:1.5b   # or any pulled Ollama chat model
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

### Recipe B — local embed + free-cloud extract (recommended default)

```yaml
chat:
  - id: gemini-free
    kind: chat
    baseUrl: https://generativelanguage.googleapis.com/v1beta/openai
    apiKeyEnv: GEMINI_API_KEY
    model: gemini-2.5-flash
    priority: 1
    enabled: true
  - id: openrouter-free
    kind: chat
    baseUrl: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY
    model: openrouter/free          # Free Models Router (:free pool)
    # or pin: google/gemma-4-26b-a4b-it:free
    priority: 2
    enabled: true
  - id: ollama-local-fallback
    kind: chat
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: qwen2.5-coder:1.5b
    priority: 100
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

Any other OpenAI-compatible host works the same way: set `baseUrl` to its `/v1` root, point `apiKeyEnv` at an `.env` key (or `null`), pick a `model` id, enable it.

## License

MIT — see [`LICENSE`](./LICENSE).
