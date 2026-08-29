# @codeoracle/mcp-server

MCP transport — thin adapter over `@codeoracle/retrieval`. Business logic does **not** live here.

## Tools

| Tool | Status |
|------|--------|
| `find_decision` | live |
| `search_codebase` | live (hybrid dense+sparse RRF after full reindex) |
| `explain_file` | live |

## Transports (D5.3)

| Mode | Env | Auth |
|------|-----|------|
| **stdio** (default) | `CODEORACLE_MCP_TRANSPORT=stdio` | Process isolation (editor spawns the process) |
| **Streamable HTTP** (+ SSE streams) | `CODEORACLE_MCP_TRANSPORT=http` | **Bearer required** — missing/invalid → 401; wrong-repo token → 403 |

HTTP also: Redis rate limit (`MCP_HTTP_RATE_LIMIT_PER_MINUTE`, default 60/min/IP). Open-dev is **not** allowed on HTTP.

Accepted bearers: `API_TOKEN`, `MCP_HTTP_BEARER_TOKEN`, or a per-repo `api_tokens` row scoped to `CODEORACLE_REPO_ID`.

```bash
# stdio (Cursor / Claude Code local)
pnpm mcp

# HTTP (remote-capable)
export CODEORACLE_MCP_TRANSPORT=http
export MCP_HTTP_PORT=3100
export API_TOKEN=dev-secret   # or MCP_HTTP_BEARER_TOKEN / scoped co_… token
pnpm mcp:http
# → POST/GET/DELETE http://127.0.0.1:3100/mcp
```

Layout (architecture §10): `transport/stdio.ts` · `transport/http.ts` · shared `create-server.ts` / `bootstrap.ts`. Auth and rate-limit do **not** leak into tool handlers.

## Cursor config (stdio)

```json
{
  "mcpServers": {
    "codeoracle": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/CodeOracle", "mcp"],
      "env": {
        "CODEORACLE_REPO_ID": "<uuid>"
      }
    }
  }
}
```

## Design rules

- Tool handlers validate `@codeoracle/contracts` I/O (citations required).
- Read path is deterministic: embed + Qdrant/Postgres only — no LLM rewrite.
- Fail loud at startup if `CODEORACLE_REPO_ID`, DB, or Qdrant is missing/unreachable.
- HTTP fails loud if no bearer mechanism is configured.
