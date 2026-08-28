# CodeOracle

**Self-hosted MCP server that searches your code and remembers why it's built that way — works with any model, stays fresh automatically.**

Self-hosted. **₹0 for the default path** — no required paid API or service anywhere. Runs via Docker Compose on a developer laptop or a 12GB Ampere OCI Always Free instance.

> **Status: early scaffold.** Business logic (API, worker, extraction pipeline, MCP tools) is not implemented yet. See [`CHANGELOG.md`](./CHANGELOG.md) for what's currently green.

## What this is

CodeOracle indexes a GitHub repo, chunks code with tree-sitter, embeds it for hybrid search, extracts structured **Decision** objects from PR/commit history, and exposes three citation-backed MCP tools: `search_codebase`, `explain_file`, and `find_decision`.

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

# bring up Postgres + Redis + Qdrant
cd infra/compose && docker compose up -d

# generate + apply the database schema
cp .env.example .env   # then fill in DATABASE_URL etc.
pnpm db:generate
pnpm db:migrate

# prove the chunker works on a real file
pnpm chunk packages/chunker/fixtures/sample.ts
```

`codeoracle init` (the full guided setup) is not implemented yet.

## License

MIT — see [`LICENSE`](./LICENSE).
