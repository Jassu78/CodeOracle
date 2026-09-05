# CodeOracle — Repository Changelog

Tracks changes to the CodeOracle codebase.

## Unreleased

### Docs (5 Sep 2026)

- Expanded root **README** — why/architecture, mermaid data-flow + ER diagrams, tech stack, Postgres/Qdrant/MCP schemas, operator setup.
- Added **CONTRIBUTING.md** — principles, boundaries, tests, PR bar, Dependabot majors policy.
- Refreshed package READMEs for `gateway`, `queue`, `observability` (no longer marked stub).

### Initial scaffold (27 Aug 2026)

Initial monorepo bootstrap following hexagonal-core + plug-and-play-gateway structure.

**Added:**

- pnpm workspaces + Turborepo monorepo skeleton (`apps/*`, `packages/*`, `infra/*`, `test/*`)
- `packages/contracts` — zod schemas for `Decision`, `CodeChunk`, `Repo`, job payloads, MCP tool I/O, and `providers.yaml` shape. Every MCP output schema enforces a mandatory citation field at the type level (not just by convention).
- `packages/config` — env loader (fails loudly on missing `DATABASE_URL`/`REDIS_URL`/`QDRANT_URL`) and `providers.yaml` loader (fails loudly if an enabled provider's API key env var is missing/empty).
- `packages/db` — Drizzle schema for all five tables (`repos`, `chunks`, `decisions`, `job_history`, `api_tokens`), with `job_history` carrying a unique `(repo_id, job_type, after_sha)` index for webhook idempotency at the database level.
- `packages/chunker` — tree-sitter based chunking (native bindings, not WASM — see decision log below) for TypeScript and Python, with a fixed-size sliding-window fallback for unsupported languages. Includes real fixture files and boundary-correctness tests.
- `apps/cli` — TUI scaffold (`@clack/prompts` + `commander`) with a working `doctor` command (Node version, Docker, Docker Compose checks).
- `infra/compose/docker-compose.yml` — Postgres 16, Redis 7, Qdrant v1.12.4, all with health checks and RAM budget comments.
- Stub shells (`package.json` + README, no business logic) for `packages/core-domain`, `packages/gateway`, `packages/extraction`, `packages/retrieval`, `packages/queue`, `packages/observability`, `apps/api`, `apps/worker`, `apps/mcp-server` — dependency graph is real from day one.
- GitHub Actions CI: lint + typecheck + unit test across every package (including empty stubs), plus a Compose health-check smoke test.
- `providers.yaml.example`, `.env.example`, root `README.md`.

**Structural decisions made during this scaffold:**

1. Chunker uses native `tree-sitter` + `tree-sitter-typescript`/`tree-sitter-python` bindings, not `web-tree-sitter` (WASM) — simpler Docker/OCI deployment, no `.wasm` grammar file management.
2. Vitest (not Jest) for all packages — uniform, ESM-native. NestJS apps may adopt Jest per-app once real Nest code lands.
3. `tsup` for package builds (dual CJS+ESM output).
4. Drizzle migrations generated via `drizzle-kit generate` and checked into `packages/db/drizzle/`, never `drizzle-kit push`.
5. CLI argument parsing via `commander`.
6. Pinned images: `postgres:16-alpine`, `redis:7-alpine`, `qdrant/qdrant:v1.12.4` — never `:latest`.
7. UUIDs via Postgres core `gen_random_uuid()` (PG13+), no `pgcrypto` extension needed.
8. Node engine range `>=20.11 <25`.

**Explicitly not built yet:** NestJS business logic in `api`/`worker`, gateway provider adapters, the extraction pipeline, the MCP server implementation. Their package shells exist; their logic does not.

**Bugs found and fixed while verifying this scaffold end-to-end (not just written, actually run):**

1. Tree-sitter TS chunks initially excluded the `export` keyword (e.g. produced `function add` instead of `export function add`) because `function_declaration` nodes don't include their `export_statement` wrapper. Fixed by widening the byte range to the wrapper when present — verified with a dedicated test.
2. `tree-sitter-typescript`'s published types lag its `tree-sitter` peer version, causing a real `tsc` type error (not just the peer-dep warning pnpm surfaced at install). Fixed with a documented, narrow type cast; runtime correctness verified by the passing boundary tests.
3. `sql` was imported from `drizzle-orm/pg-core` (wrong module) instead of `drizzle-orm` — caught by `tsup`'s build step, not by `tsc` alone.
4. `drizzle-kit generate` loads schema `.ts` files with its own CJS loader, which does not resolve `.js`-suffixed relative imports on raw TypeScript source (works fine for `tsup`/`vitest`, breaks for `drizzle-kit` specifically). Fixed by using extensionless relative imports inside `packages/db`. Also had to switch `drizzle.config.ts`'s `schema` field from a glob to an explicit file list, since the glob matched `schema.test.ts` and pulled in `vitest` (which can't be `require()`'d), crashing `drizzle-kit` entirely.
5. Qdrant's official Docker image has neither `wget` nor `curl`, so the original `CMD-SHELL wget ...` healthcheck always failed even though the service was healthy. Fixed with a `/dev/tcp` bash-builtin port check, verified against a real running container.
6. Found a **real environment hazard**, not just a scaffold bug: a native Postgres already listening on port 5432 on the dev machine silently won the port-forward race against the Docker container, so clients connected to the wrong database with a confusing `role "codeoracle" does not exist` error instead of a connection failure. Made all three services' host ports configurable via env vars (`POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `QDRANT_HTTP_HOST_PORT`, `QDRANT_GRPC_HOST_PORT`) and documented the failure mode directly in `docker-compose.yml`, since this will bite other users too.
7. `packages/db`'s own schema test used `Symbol.for("drizzle:Name")` indexing that doesn't type-check against Drizzle's generated types — removed the flawed assertion rather than suppressing the error.
8. Every currently-empty stub package/app failed `vitest run` with "No test files found, exiting with code 1". Added `--passWithNoTests` to those specifically so CI stays green without masking missing tests in packages that already have real tests.
9. ESLint resolved to `9.39.5`, which hard-requires flat config — the originally-scaffolded `.eslintrc.json` (legacy format) failed on every package with "couldn't find an eslint.config.js". Also, `eslint-plugin-boundaries` was referenced in that config but never added as a dependency. Replaced with a working `eslint.config.js` (flat config, `typescript-eslint` + `eslint-plugin-boundaries` actually installed), and simplified every package's `lint` script (`eslint src --ext .ts` → `eslint src`, since `--ext` is meaningless under flat config).

**Verified live (not just "should work"):** `pnpm install`, `turbo run build/lint/typecheck/test` (56/56 tasks green), `docker compose up` (all 3 services healthy), `drizzle-kit generate` + `drizzle migrate` against a real Postgres (5 tables created, confirmed via `\dt`, confirmed idempotent on re-run), `codeoracle doctor` (real CLI output), `pnpm chunk fixtures/sample.ts` (real chunk boundaries printed).
