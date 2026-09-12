# Dogfood / single-host ops

**Goal:** one API, one MCP, and **worker(s)** against the same `REDIS_URL`. Duplicate *stale* workers (old `dist`) caused Q3 gate bypass; that is different from intentional multi-worker scale.

Use these scripts from a deploy root (example: `~/codeoracle/run/`) or copy them next to your `.env`.

## Hard rules

1. **Default:** start **one** worker via `start-worker.sh` (refuses a second process unless `CODEORACLE_ALLOW_MULTI_WORKER=1`).
2. **Multi-worker (E9):** set `CODEORACLE_ALLOW_MULTI_WORKER=1` only when every replica runs the **same rebuilt `dist`**. Index safety is not “one process”:
   - Per-repo Redis lease `codeoracle:index-lease:{repoId}` (full + incremental)
   - Stable BullMQ jobId `bullJobId("full_index", repoId)` + `safeReplaceJob` (skip if active)
   - Shared Redis circuit breaker + extract slot semaphore
3. After `git pull` that touches `packages/*/src` or `apps/worker`: **rebuild package dists**, then **restart all workers** (stop → start). A running process does not reload `dist`.
4. Prefer `restart-worker.sh` over ad-hoc `nohup pnpm worker`.

## Scripts

| Script | Purpose |
|--------|---------|
| `worker-status.sh` | Count API / MCP / worker processes; print pidfile |
| `stop-worker.sh` | SIGTERM (then SIGKILL) only processes whose cwd is `apps/worker` |
| `start-worker.sh` | Start one worker; exits non-zero if a worker is already up (unless `CODEORACLE_ALLOW_MULTI_WORKER=1`) |
| `restart-worker.sh` | Stop → optional Redis lock/budget clear → start |
| `clear-extract-locks.sh` | Clear BullMQ active/wait/delayed/stalled + today’s extract token budget key |

Environment (from repo `.env` or export before running):

- `CODEORACLE_REPO` — absolute path to the git checkout (default: `$HOME/codeoracle/repo`)
- `CODEORACLE_RUN` — directory for `worker.pid` / `worker.log` (default: `$HOME/codeoracle/run`)
- `REDIS_URL` — required for lock/budget clear (loaded from `.env` if present)
- `REPO_ID` — optional; needed to reset `codeoracle:extract:tokens:{repoId}:{day}`
- `CODEORACLE_ALLOW_MULTI_WORKER` — set to `1` to allow a second `start-worker.sh` (advanced)

Redis CLI: host `redis-cli` **or** `docker exec codeoracle-redis-1 redis-cli` when Redis is Compose-only.

## Deploy / extract checklist

```bash
cd "$CODEORACLE_REPO"   # e.g. ~/codeoracle/repo
git pull
pnpm install
pnpm --filter @codeoracle/core-domain --filter @codeoracle/extraction --filter @codeoracle/retrieval build
# rebuild any other packages your pull touched

./infra/dogfood/restart-worker.sh --clear-locks
# wait until worker-status shows WORKER≥1 and log says "Worker listening"

pnpm --filter @codeoracle/cli exec tsx src/main.ts decisions extract <repoId> --clear --limit 15
# wait for queue drain (worker log: extract_decisions complete … consistencyRepaired / droppedInconsistent)

pnpm --filter @codeoracle/cli exec tsx src/main.ts decisions alts-audit <repoId> --show
# exit 0 ⇒ inconsistent ≈ 0

# After retrieval changes: live quality suite (any ready repo; suite is data)
pnpm --filter @codeoracle/cli exec tsx src/main.ts replay <repoId> \
  --suite test/replay/suites/codeoracle-self.json
# exit 0 ⇒ hard gates pass (soft misses printed). Not a GitHub Actions gate —
# CI covers goldens + replay schema/score units only (see test/replay/README.md).
#
# After crawler exclude changes: full reindex (not incremental) so Qdrant drops
# former lockfile / ORM-meta / eval-suite noise points.
```

CLI note: do **not** insert an extra `--` between `pnpm … start` and `decisions` (Commander treats it badly). Prefer `pnpm --filter @codeoracle/cli exec tsx src/main.ts …`.

## Symptoms → fix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `alts-audit` inconsistent > 0 after gate shipped | Stale / mismatched worker `dist` | Rebuild + restart **all** workers → re-extract `--clear` |
| Extract jobs hang / “missing lock” | Stale BullMQ locks after kill -9 | `clear-extract-locks.sh` then restart |
| All extracts `skipped: true` instantly | Daily token budget hit | Reset budget key (script) or wait until UTC day rolls |
| Complete logs lack `consistencyRepaired` | Worker started before Q3 code loaded | Restart worker after rebuild |
| Second `POST /repos/:id/index` while indexing | Expected | `202` with `alreadyIndexing: true` (same jobId) |

## Health sniff

```bash
./infra/dogfood/worker-status.sh
# expect: API=1 MCP=1 WORKER≥1 (usually 1 on dogfood)

tail -n 5 "$CODEORACLE_RUN/worker.log"
# expect: "Worker listening for jobs"
```

## Optional OpenTelemetry (E7)

Default **off**. No cloud vendor SDK — OTLP/HTTP to a local collector only.

```bash
# Collector (example)
docker run --rm -p 4318:4318 otel/opentelemetry-collector-contrib:latest

# In repo .env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318

# Restart worker + MCP; see docs/ops/otel.md
```
