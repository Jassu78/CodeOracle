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
| `compose-smoke-test` | Infra startup | Compose Postgres + Redis + Qdrant healthy |
| `integration-test` | Product path (D5.4 e2e) | `pnpm build` → migrate → `pnpm test:integration` |
| | Golden eval (D5.2) | `pnpm test:eval` (hit@3 ≥80%, citation 100%) |

All of the above use the checked-in sample-repo fixture + fake OpenAI-compatible provider — **no** GitHub/Ollama/cloud network on the required path (₹0 / offline CI).

## Local equivalents

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:golden
# with Compose up + migrated DB:
pnpm test:integration
pnpm test:eval
```
