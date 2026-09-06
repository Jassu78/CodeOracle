# Dogfood / single-host ops

**Goal:** one API, one MCP, **one worker**. Duplicate workers caused Q3 gate bypass (stale Node modules kept serving extract jobs after `dist` rebuild).

Use these scripts from a deploy root (example: `~/codeoracle/run/`) or copy them next to your `.env`.

## Hard rules

1. **Never** start a second worker against the same `REDIS_URL` / queue.
2. After `git pull` that touches `packages/*/src` or `apps/worker`: **rebuild package dists**, then **restart the worker** (stop → start). A running process does not reload `dist`.
3. Prefer `restart-worker.sh` over ad-hoc `nohup pnpm worker`.

## Scripts

| Script | Purpose |
|--------|---------|
| `worker-status.sh` | Count API / MCP / worker processes; print pidfile |
| `stop-worker.sh` | SIGTERM (then SIGKILL) only processes whose cwd is `apps/worker` |
| `start-worker.sh` | Start **one** worker; **exits non-zero** if a worker is already up |
| `restart-worker.sh` | Stop → optional Redis lock/budget clear → start |
| `clear-extract-locks.sh` | Clear BullMQ active/wait/delayed/stalled + today’s extract token budget key |

Environment (from repo `.env` or export before running):

- `CODEORACLE_REPO` — absolute path to the git checkout (default: `$HOME/codeoracle/repo`)
- `CODEORACLE_RUN` — directory for `worker.pid` / `worker.log` (default: `$HOME/codeoracle/run`)
- `REDIS_URL` — required for lock/budget clear (loaded from `.env` if present)
- `REPO_ID` — optional; needed to reset `codeoracle:extract:tokens:{repoId}:{day}`

Redis CLI: host `redis-cli` **or** `docker exec codeoracle-redis-1 redis-cli` when Redis is Compose-only.

## Deploy / extract checklist

```bash
cd "$CODEORACLE_REPO"   # e.g. ~/codeoracle/repo
git pull
pnpm install
pnpm --filter @codeoracle/core-domain --filter @codeoracle/extraction --filter @codeoracle/retrieval build
# rebuild any other packages your pull touched

./infra/dogfood/restart-worker.sh --clear-locks
# wait until worker-status shows exactly one WORKER and log says "Worker listening"

pnpm --filter @codeoracle/cli exec tsx src/main.ts decisions extract <repoId> --clear --limit 15
# wait for queue drain (worker log: extract_decisions complete … consistencyRepaired / droppedInconsistent)

pnpm --filter @codeoracle/cli exec tsx src/main.ts decisions alts-audit <repoId> --show
# exit 0 ⇒ inconsistent ≈ 0

# After retrieval changes: live quality suite (any ready repo; suite is data)
pnpm --filter @codeoracle/cli exec tsx src/main.ts replay <repoId> \
  --suite test/replay/suites/codeoracle-self.json
```

CLI note: do **not** insert an extra `--` between `pnpm … start` and `decisions` (Commander treats it badly). Prefer `pnpm --filter @codeoracle/cli exec tsx src/main.ts …`.

## Symptoms → fix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `alts-audit` inconsistent > 0 after gate shipped | Stale / duplicate workers | `stop-worker.sh` all → one `start-worker.sh` → re-extract `--clear` |
| Extract jobs hang / “missing lock” | Stale BullMQ locks after kill -9 | `clear-extract-locks.sh` then restart |
| All extracts `skipped: true` instantly | Daily token budget hit | Reset budget key (script) or wait until UTC day rolls |
| Complete logs lack `consistencyRepaired` | Worker started before Q3 code loaded | Restart worker after rebuild |

## Health sniff

```bash
./infra/dogfood/worker-status.sh
# expect: API=1 MCP=1 WORKER=1

tail -n 5 "$CODEORACLE_RUN/worker.log"
# expect: "Worker listening for jobs" and isLeader true on the single process
```
