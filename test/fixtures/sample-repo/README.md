# test/fixtures/sample-repo

Purpose-built fixture for **PRD D5.1** golden-query eval — not a real product.

## Layout

| Path | Role |
|------|------|
| `build.ts` | Deterministic git history materializer (fixed dates → stable SHAs) |
| `tree/` | Checked-in final working tree (browse without running the builder) |
| `build.test.ts` | Guards: history length, tree sync, builder smoke |

Nested `.git` is **never** committed (breaks the parent monorepo). Eval/e2e call `buildSampleRepo()` to get a real git checkout in a temp dir with a fake GitHub `origin` for citation URLs.

## History (WHY commits)

1. scaffold  
2. signed-cookie sessions (not in-memory server Map)  
3. process-local lookup cache (not Redis, ₹0 path)  
4. Postgres pool max cap (fail-loud)  
5. reject empty bearer tokens  
6. health exposes cache + pool stats  

Golden queries live in `test/golden-queries/queries.json`.
