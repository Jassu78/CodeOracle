# @codeoracle/mcp-server

MCP stdio transport — thin adapter over `@codeoracle/retrieval`. Business logic does **not** live here.

## Stage 4 tools

| Tool | Status |
|------|--------|
| `find_decision` | live |
| `search_codebase` | live (hybrid dense+sparse RRF after full reindex; dense fallback on legacy collections) |
| `explain_file` | live (deterministic chunks + decisions-by-path) |

## Run

```bash
# In repo root .env:
# CODEORACLE_REPO_ID=<uuid from `pnpm cli repo status`>
# DATABASE_URL / REDIS_URL / QDRANT_URL as usual

pnpm mcp
```

Live smokes (tool handlers + retrieval, no MCP transport):

```bash
pnpm --filter @codeoracle/mcp-server exec tsx scripts/smoke-find-decision.ts "Feature Enhancement"
pnpm --filter @codeoracle/mcp-server exec tsx scripts/smoke-search-codebase.ts "nasa weather"
pnpm --filter @codeoracle/mcp-server exec tsx scripts/smoke-explain-file.ts "src/components/ClimateTrendsChart.tsx"
```

Logs go to **stderr** only — stdout is the MCP JSON-RPC stream.

## Cursor config example

Add to Cursor MCP settings (path adjusted to your clone):

```json
{
  "mcpServers": {
    "codeoracle": {
      "command": "pnpm",
      "args": ["--dir", "/Users/YOU/AlinGod/CodeOracle", "mcp"],
      "env": {
        "CODEORACLE_REPO_ID": "9462ddb7-6064-4620-87c7-584566f643af"
      }
    }
  }
}
```

Or point `command` at `npx tsx apps/mcp-server/src/main.ts` with `cwd` set to the monorepo root so `.env` / `providers.yaml` resolve.

## Design rules

- Tool handlers validate `@codeoracle/contracts` I/O (citations required).
- Read path is deterministic: embed + Qdrant/Postgres only — no LLM rewrite.
- Fail loud at startup if `CODEORACLE_REPO_ID`, DB, or Qdrant is missing/unreachable.
