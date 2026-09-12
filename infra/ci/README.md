# infra/ci

**Status:** Gates live in `.github/workflows/ci.yml` (D5.4 confirmed).

This folder is reserved for reusable CI helper scripts if they outgrow the workflow YAML. Today the workflow is the source of truth.

## Required PR gates (D5.4)

| Job | Covers | Command / what |
|-----|--------|----------------|
| `lint-typecheck-test` | Lint | `pnpm lint` |
| | Typecheck (packages + apps) | `pnpm typecheck` |
| | Typecheck e2e + golden fixtures | `pnpm typecheck:e2e`, `pnpm typecheck:golden` |
| | Unit tests | `pnpm test` |
| | Golden schema/fixture tests (D5.1) | `pnpm test:golden` |
| | Replay hermetic units (score + suite schema) | Included in `pnpm test` (`@codeoracle/cli`) |
| `compose-smoke-test` | Infra startup | Compose Postgres + Redis + Qdrant healthy |
| `integration-test` | Product path (D5.4 e2e) | `pnpm build` → migrate → `pnpm test:integration` |
| | Golden eval (D5.2) | `pnpm test:eval` (hit@3 ≥80%, citation 100%) |
| `dependency-audit` | E10 supply-chain | `pnpm audit:ci` (prod, fail on high/critical) — see [`docs/ops/dependency-audit.md`](../../docs/ops/dependency-audit.md) |

**Also on PRs / main (separate workflow):** CodeQL JavaScript/TypeScript — `.github/workflows/codeql.yml`.

All product-path jobs above use the checked-in sample-repo fixture + fake OpenAI-compatible provider — **no** GitHub/Ollama/cloud network on that path (₹0 / offline CI). Dependency audit and CodeQL need network for the advisory DB / CodeQL pack download.

**Not in CI:** `codeoracle replay` against a product/dogfood index (needs a ready repo + real embeddings). That is an ops gate — see [`test/replay/README.md`](../../test/replay/README.md) and [`infra/dogfood/README.md`](../dogfood/README.md).

## Local equivalents

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:golden
# with Compose up + migrated DB:
pnpm test:integration
pnpm test:eval
# live product index (dogfood / local indexed repo — not CI):
pnpm --filter @codeoracle/cli exec tsx src/main.ts replay <repoId> \
  --suite test/replay/suites/codeoracle-self.json
```
