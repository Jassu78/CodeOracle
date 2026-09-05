# Contributing to CodeOracle

Thanks for contributing. This document is the **execution contract** for changes: how to set up, what “done” means, where logic belongs, and how PRs are reviewed.

If product intent conflicts with this file, pause and resolve with the maintainer. If mechanism conflicts with the code, update the docs in the same PR.

---

## Table of contents

1. [Product principles](#product-principles)
2. [Development setup](#development-setup)
3. [Repository map](#repository-map)
4. [Architecture rules](#architecture-rules)
5. [Data & schema changes](#data--schema-changes)
6. [Providers & secrets](#providers--secrets)
7. [Testing](#testing)
8. [Pull requests](#pull-requests)
9. [Commit style](#commit-style)
10. [Dependabot & dependency majors](#dependabot--dependency-majors)
11. [Security](#security)
12. [Docs](#docs)

---

## Product principles

Keep these intact unless the PR explicitly changes product policy and says so in the description:

| Principle | Meaning in code |
|-----------|-----------------|
| **Narrow the haystack** | Prefer retrieval + citations over dumping trees into context |
| **No citation = bug** | `filePath` / `sourceUrl` required in Zod **and** DB (`decisions.source_url` NOT NULL) |
| **No invent** | Extraction must not invent tech, paths, or alternatives not in the source |
| **Config-only providers** | New LLM hosts → `providers.yaml`, not a new SDK package |
| **Domain owns policy** | Ranking floors, RRF cutoffs, trivial filters → `@codeoracle/core-domain` |
| **Fail loud** | Invalid env / providers config throws at startup — never silent defaults for required values |

---

## Development setup

### Prerequisites

- Node.js **20.11+** (&lt; 25)
- pnpm **9+** (`corepack enable`)
- Docker + Compose
- git
- Ollama (default embeddings) — `ollama pull nomic-embed-text`

### Bootstrap

```bash
git clone https://github.com/Jassu78/CodeOracle.git
cd CodeOracle
corepack enable
pnpm install

cp .env.example .env
cp providers.yaml.example providers.yaml

cd infra/compose && docker compose up -d && cd ../..
pnpm db:migrate
```

### Run the stack (dev)

```bash
# Terminal A
pnpm worker

# Terminal B (optional — webhooks / HTTP API)
pnpm api

# Terminal C — MCP stdio (or let the editor spawn `pnpm mcp`)
export CODEORACLE_REPO_ID=<uuid>
pnpm mcp
```

Guided first-time path: `pnpm --filter @codeoracle/cli start -- init`.

Full operator docs: [`README.md`](./README.md).

### Useful scripts

| Script | Purpose |
|--------|---------|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Local gates (also via Turborepo filters) |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm test:eval` | Golden-query eval (needs data plane + `INTEGRATION_TEST` where applicable) |
| `pnpm --filter @codeoracle/<pkg> test` | Package unit tests |

---

## Repository map

| Path | Responsibility |
|------|----------------|
| `apps/api` | HTTP, webhooks, token minting |
| `apps/worker` | BullMQ processors only |
| `apps/mcp-server` | MCP transport → `retrieval` |
| `apps/cli` | Ops CLI |
| `packages/core-domain` | Framework-free domain rules |
| `packages/contracts` | Shared Zod schemas |
| `packages/config` | Env + `providers.yaml` |
| `packages/db` | Schema, migrations, repositories |
| `packages/retrieval` | Search / find_decision / explain_file |
| `packages/extraction` | Extract orchestration |
| `packages/gateway` | OpenAI-compat ports + failover |
| `packages/chunker` | Tree-sitter chunking |
| `packages/queue` | BullMQ helpers |
| `packages/observability` | Logging / usage |
| `infra/` | Compose, Docker images, CI notes |
| `test/` | Fixtures, e2e, golden queries |

---

## Architecture rules

Dependency direction is one-way: **apps → packages → contracts/config**, and capability packages may call **core-domain**. Packages never import apps. `core-domain` never imports frameworks, HTTP, BullMQ, or Qdrant.

1. **Do not put ranking / citation / “is this trivial?” policy in MCP or HTTP handlers.** Put it in `core-domain` (or call existing helpers).
2. **MCP stays thin.** Tool handlers validate contracts and call `retrieval`.
3. **Worker stays an orchestrator.** Persist via `db`, call `chunker` / `gateway` / `extraction`, record `job_history`.
4. **Shared shapes live in `contracts`.** If two packages need the same TypeScript type for wire format, it belongs in Zod there.
5. **ESLint boundaries** must stay green — packages importing apps is a hard fail.

When unsure where a change belongs, prefer:

`contracts` (shape) → `core-domain` (rule) → capability package (mechanism) → `apps/*` (wiring).

---

## Data & schema changes

1. Edit Drizzle tables under `packages/db/src/schema/`.
2. Generate / add a migration under `packages/db/drizzle/` (follow existing numbered SQL style).
3. Update repositories and any Zod contracts that mirror columns.
4. Never weaken **citation** constraints (`decisions.source_url` NOT NULL, MCP citation fields required) without an explicit product decision.
5. Qdrant payload changes must stay compatible with retrieval hydrate paths — document collection recreate needs in the PR if a full reindex is required.

See the ER diagram and table notes in [`README.md` § Schemas](./README.md#schemas).

---

## Providers & secrets

- Commit **`providers.yaml.example`** and **`.env.example`** only.
- Never commit `providers.yaml`, `.env`, API keys, raw `co_…` tokens, or webhook secrets.
- New providers: add an example block + document the env var name; implement nothing provider-specific in TypeScript beyond the OpenAI-compat adapter.
- Extraction prompts must keep **no invent** and citation discipline.

---

## Testing

### Minimum for every PR

- [ ] Relevant **unit tests** updated or added  
- [ ] `pnpm` lint + typecheck + tests green locally for touched packages  
- [ ] CI green on the PR (`lint-typecheck-test`, `compose-smoke-test`, `integration-test`)

### When you must add / extend tests

| Change | Expect |
|--------|--------|
| Domain ranking / filter rule | `packages/core-domain` unit tests |
| Parse / extract behavior | `packages/extraction` unit tests |
| MCP I/O shape | `packages/contracts` + mcp-server tests if handlers change |
| Job orchestration | worker unit tests and/or e2e |
| Search quality regression lock | golden queries (`test/golden-queries`) if you change retrieval policy |

### Integration / eval

- E2e and golden eval need Compose services; see `test/e2e/README.md` and `test/golden-queries/README.md`.
- Do not lower golden thresholds to “make CI green” without documenting the product trade-off.

---

## Pull requests

### Scope

- **One concern per PR** (one quality backlog item, one bug class, one infra fix).
- Do not mix Dependabot majors with product features.
- Prefer small, reviewable diffs over “while I was here” refactors.

### Description template

```markdown
## Summary
- What changed and why (user-visible or operator-visible outcome)

## Test plan
- [ ] Unit tests
- [ ] CI green
- [ ] Dogfood / manual check (if retrieval, extract, or worker path)
```

### Review bar

Reviewers check:

1. Principles (citation, no invent, domain ownership)  
2. Boundaries (no apps ← packages inversion)  
3. Tests match the risk  
4. Docs updated when behavior or ops steps change  
5. No secrets in the diff  

### Merge

- Wait for required CI checks.
- Squash or merge per repo settings; keep history readable.
- After merge impacting worker/MCP packages on a dogfood host: **pull → rebuild package dists if needed → restart worker/MCP** using [`infra/dogfood/`](./infra/dogfood/README.md) (`restart-worker.sh`). Never leave two workers on the same Redis queue.

---

## Commit style

Use short, imperative subjects with an optional scope:

```text
fix(retrieval): apply relative score floor on find_decision
feat(extract): skip trivial chore commits before LLM
chore(dependabot): ignore semver majors
docs: expand README architecture and schemas
```

Explain **why** in the body when the diff is non-obvious.

---

## Dependabot & dependency majors

- Weekly Dependabot opens **grouped minor/patch** PRs (npm + GitHub Actions).
- **Semver majors are ignored** in `.github/dependabot.yml` on purpose (zod / bullmq / typescript / eslint class bumps are high risk).
- To take a major: open a **dedicated** PR with migration notes, CI green, and a dogfood smoke plan.
- Repo labels `dependencies` and `github-actions` must exist so Dependabot can label PRs.

---

## Security

- Report sensitive issues privately to the maintainer; do not file public issues with secrets.
- Webhook handlers must verify `X-Hub-Signature-256` before side effects.
- MCP HTTP must require a bearer; do not reintroduce open-dev on HTTP.
- Redaction in extraction is mandatory for high-entropy tokens in source bodies — extend tests if you change patterns.

---

## Docs

| Doc | Audience |
|-----|----------|
| [`README.md`](./README.md) | Operators + architecture overview (mermaid, schemas, setup) |
| This file | Contributors |
| `apps/*/README.md`, `packages/*/README.md` | Package-local design notes |
| `infra/*/README.md` | Compose / images / CI |

When you change operator-facing behavior (CLI flags, env vars, job semantics, MCP schemas), update the root README (or the package README) **in the same PR**.

Keep package READMEs honest — do not leave “Stub / not implemented” text after the code ships.

---

## Quick checklist before you push

- [ ] Change belongs in the right package  
- [ ] Contracts / schema / migrations aligned  
- [ ] Tests cover the new rule or bugfix  
- [ ] No secrets; examples only in `*.example`  
- [ ] README / CONTRIBUTING updated if ops or architecture shifted  
- [ ] CI will understand the change (no skipped gates without reason)  
