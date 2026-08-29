# @codeoracle/api

**Status:** Stage 4 — plain `node:http` server in `src/main.ts` (Nest scaffold unused).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Deep health — Postgres, Redis, Qdrant |
| POST | `/repos` | Bearer* | Register GitHub or local repo |
| GET | `/repos/:id` | Bearer* | Repo status |
| POST | `/repos/:id/index` | Bearer* | Queue `full_index` (Redis-backed rate limit: 10/min/client) |
| POST | `/repos/:id/tokens` | Bearer* | Issue a per-repo API token (shown once) |
| GET | `/repos/:id/tokens` | Bearer* | List token metadata for a repo (no secrets returned) |
| DELETE | `/repos/:id/tokens/:tokenId` | Bearer* | Revoke a token |
| POST | `/webhooks/github` | **HMAC** (`X-Hub-Signature-256`) | Push → queue `incremental_reindex` (idempotent job id) |

\*Bearer required unless **both** `API_TOKEN` is unset **and** no `api_tokens` rows exist (local dev default = open).

### Auth model — honest current state

Two token classes, both real (no unused schema — see `packages/db/src/repositories/api-tokens.ts`):

1. **`API_TOKEN` env var** — a single bootstrap/admin token, constant-time compared.
2. **Per-repo tokens** (`api_tokens` table) — minted via `POST /repos/:id/tokens`, only the SHA-256 hash is stored, the raw value is returned exactly once. Verified by hash lookup (`verifyApiToken`), and `lastUsedAt` is updated on each successful use.

**What's still MVP, not full production auth:** routes are not yet scoped per-repo — any valid token (env or DB) authorizes every admin route above, not just the repo it was minted for. True per-route repo scoping is deferred to D5.3 (HTTP/SSE MCP transport + bearer tokens) alongside building the actual per-repo authorization checks. Today's improvement over "one shared secret" is real (issue/list/revoke lifecycle, hashed at rest, per-repo audit trail via `lastUsedAt`) — it's just not yet *scoped* auth.

```bash
# Mint a token for a repo (requires an existing admin token or open dev mode)
curl -X POST localhost:3000/repos/<repoId>/tokens
# → {"id":"...","token":"co_...","warning":"shown once — store it now"}
```

## GitHub webhook (Step 4)

1. Set `GITHUB_WEBHOOK_SECRET` in `.env` (same value as the GitHub webhook secret).
2. Point the GitHub repo webhook at `https://<host>/webhooks/github` — events: **Push** (+ Ping).
3. Register the repo in CodeOracle (`githubFullName` must match `owner/name`).
4. Handler verifies HMAC on the **raw body**, ignores tags/deletes, resolves repo, enqueues:

   `jobId = bullJobId("incremental_reindex", repoId, afterSha)`

Duplicate deliveries while the job still exists return `200 { duplicate: true }` — no double queue.

While a full/incremental index is `indexing`, push jobs **defer** (Redis tip coalesce) and are **flushed** to one catch-up `incremental_reindex` when the repo returns to `ready`.

**Step 4 scope:** verify + enqueue. Worker processors handle incremental + defer/flush.

### Local dogfood (ngrok) — not production

ngrok (or similar) is **local-only** so GitHub can reach `localhost:3000`. Free ngrok URLs are **ephemeral** — every tunnel restart needs a webhook URL update.

```bash
# API + worker running locally
ngrok http 3000
# Public URL looks like https://<subdomain>.ngrok-free.dev
gh api repos/<owner>/<repo>/hooks \
  -f name=web -F active=true -f events[]=push -f events[]=ping \
  -f config[url]=https://<subdomain>.ngrok-free.dev/webhooks/github \
  -f config[content_type]=json \
  -f config[secret]=$GITHUB_WEBHOOK_SECRET \
  -F config[insecure_ssl]=0
```

For always-on webhooks, deploy the API behind stable HTTPS (Stage 5 / prod) — do not rely on free ngrok.

### Webhook secret rotation checklist

1. Generate a new secret (`openssl rand -hex 32`).
2. Put it in `.env` as `GITHUB_WEBHOOK_SECRET` (never commit `.env`).
3. Restart the API so it loads the new secret.
4. Update the GitHub hook secret to the **same** value (`gh api ... -X PATCH` or UI).
5. Send a **Ping** from GitHub (or `gh api .../hooks/<id>/pings`) — expect `200 { pong: true }`.
6. Confirm a real **Push** returns `202` and the worker logs `incremental_reindex`.

Order matters: if GitHub still has the old secret while the API has the new one (or vice versa), deliveries fail HMAC (`401`). Rotate GitHub **immediately after** API restart (or briefly accept downtime).

## Example

```bash
export API_TOKEN=dev-secret
pnpm api
curl -H "Authorization: Bearer dev-secret" -X POST localhost:3000/repos \
  -H 'Content-Type: application/json' \
  -d '{"githubFullName":"owner/repo"}'
```
