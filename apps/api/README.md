# @codeoracle/api

**Status:** Stage 2 MVP — plain `node:http` server in `src/main.ts`.

NestJS scaffold files remain from Stage 0 but are **not** the active entry point. Use `pnpm api` (runs `src/main.ts`).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Deep health — Postgres, Redis, Qdrant |
| POST | `/repos` | Bearer* | Register GitHub or local repo |
| GET | `/repos/:id` | Bearer* | Repo status |
| POST | `/repos/:id/index` | Bearer* | Queue `full_index` (rate limited) |

\*Bearer required when `API_TOKEN` is set in `.env`. Omitted = open (local dev only).

## Example

```bash
export API_TOKEN=dev-secret
pnpm api
curl -H "Authorization: Bearer dev-secret" -X POST localhost:3000/repos \
  -H 'Content-Type: application/json' \
  -d '{"githubFullName":"owner/repo"}'
```

Webhook HMAC verification and NestJS migration are Stage 4+.
