# CodeOracle — Intro

**Status:** Current build choice (decided 27 Aug 2026)  
**Also parked:** ContextVault (project 1) — strongly liked; build after CodeOracle using the same retrieval core  
**Owner:** Jaswanth Jogi · solo / indie  
**Horizon:** ~8–10 weeks full; thin MVP in ~4–6 weeks  
**Cost:** MVP locked to **₹0** via a **universal OpenAI-compatible gateway** (free local + free cloud models; any `/v1` endpoint)  
**Docs:** `intro.md` (why) · `production-spec.md` (how) · `PRD.md` (stages / success)
**Last updated:** 27 Aug 2026 — see `CHANGELOG.md`

---

## One sentence

Self-hosted **MCP server** that gives AI coding agents (Cursor, Claude Code, etc.) persistent memory of a codebase’s **WHY** — decisions, trade-offs, PR rationale — not just what the files contain today.

---

## Problem

Coding agents are strong at reading *current* code. They are weak at remembering:

- why Postgres won over Mongo in 2023  
- which PR documented an auth edge case  
- what the team already rejected and why  

That context lives in commit messages, PR bodies, review threads, and people’s heads. Session-to-session, agents forget it. Cloud tools (Cody, Greptile) help but are expensive and not fully self-hosted for private monorepos.

---

## What CodeOracle is (and is not)

| Is | Is not |
|---|---|
| Decision / rationale memory for agents | Another “chat with your repo” UI |
| MCP tools any editor can call | Locked to one IDE |
| Index of code **+** git/PR history | Only AST / file embeddings |
| Self-hosted Docker Compose | “Send your monorepo to our cloud” by default |
| Local / VPC embeddings & optional local chat (Ollama, etc.) | Forced vendor-only RAG of your private tree |
| Incremental updates via GitHub webhooks | Manual re-upload every week |

**Privacy posture:** search can run fully offline with local embeddings. Decision extract only needs a chat model when you turn it on — keep that local too if code and PR text must not leave your network.

**Product test:** if you remove a fancy UI and still have a sharp capability — *queryable architectural decisions for any coding agent* — you built CodeOracle, not a clone.

---

## Differentiation vs existing tools

| Existing | Gap CodeOracle fills |
|---|---|
| Cursor / Claude Code indexing | Great at WHAT this session; little long-term WHY |
| Sourcegraph Cody | Enterprise / cloud-heavy |
| Greptile (+ MCP) | Review-centric; not a durable decision archive you own |
| Generic “memory” MCPs | Mostly notes you write by hand |
| GitHub MCP | Raw repo access; no decision graph |

**Wedge:** auto-mine **commits + PRs + review comments** into structured decision objects, expose them over MCP, keep fresh with webhooks.

---

## Scope: one repo vs whole system

CodeOracle is **not** limited to a single service forever. Scope grows in phases:

| Mode | What it covers | Phase |
|---|---|---|
| **Single repo** | One GitHub repo (e.g. API only) | **v1 / MVP** |
| **Monorepo** | Frontend + backend + packages in *one* Git repo — still one index; packages treated as linked areas | **v1.5** (almost free once single-repo works) |
| **Multi-repo workspace** | Connected full-stack system: e.g. `api` + `web` + `worker` + `mobile` under one project name | **v2** |

**End state (v2):** one CodeOracle instance = one **workspace / system**. Several repos register under it; every chunk carries `repo_id`; `find_decision` searches across the workspace so a decision in `api` can cite history in `web`. Webhooks stay per-repo; vector DB and decision graph are shared.

**Agents don’t care about repo boundaries** — they care that `find_decision("why gRPC to device")` can pull from API *and* device-client history. That is the product direction; MVP stays single-repo so indexing, MCP, and webhooks actually ship.

---

## Core capabilities (MVP → later)

### Thin MVP (ship first) — single repo

1. **Indexer** — **one** GitHub repo: files (function/class chunks) + commit messages + PR titles/bodies  
2. **Store** — embeddings in Qdrant; metadata (paths, SHAs, PR URLs) in SQLite/Postgres  
3. **MCP server** (stdio) with tools:
   - `search_codebase(query)` — semantic + keyword hybrid  
   - `explain_file(path)` — what + nearby decisions  
   - `find_decision(topic)` — WHY answers with PR/commit citations  
4. **Webhook** — push / PR merge → incremental re-index  
5. **Deploy** — Docker Compose: MCP process + vector DB + volume  

### Deliberately later

- **Multi-repo workspace** for connected full-stack / multi-project systems (shared decision graph, `repo_id` on chunks, cross-repo `find_decision`)  
- Org-wide graph / many workspaces  
- Fancy web dashboard (CLI + MCP first)  
- Managed cloud SaaS  
- Auto-writing ADRs back into the repo  
- Slack bot  

---

## Suggested stack (matches your skills)

- **Language:** TypeScript  
- **MCP:** official MCP SDK (stdio; HTTP later if needed)  
- **API / workers:** NestJS or lightweight Node workers + BullMQ for index jobs  
- **Vectors:** Qdrant  
- **Meta DB:** Postgres from day one (concurrent worker writes rule out SQLite — see production spec §6)  
- **LLM / embeddings:** universal OpenAI-compat gateway (free models default; any `baseUrl`)  
- **GitHub:** App or PAT + webhooks (you already shipped a webhook dashboard)  
- **Packaging:** Docker Compose, one-command bring-up  

---

## How an agent uses it

1. Dev runs CodeOracle against a repo locally (or on a small VPS).  
2. Cursor / Claude Code config points at the MCP server.  
3. Agent calls `find_decision("why redis for rate limits")`.  
4. CodeOracle returns rationale + links to PR/commit + touched files.  
5. Agent answers with grounded history instead of guessing.

---

## Monetization (after it works)

| Path | Model |
|---|---|
| Open source self-host | Free → stars, credibility |
| Managed cloud (per repo) | ~$15/mo |
| GitHub App distribution | Marketplace installs |
| Enterprise on-prem | ~$500–2k/year |

Resume/OSS signal comes first; money follows if the MCP is sticky.

---

## Relation to ContextVault

Both need: chunk → embed → hybrid retrieve → cite sources → Docker.

| | CodeOracle (now) | ContextVault (next) |
|---|---|---|
| Corpus | Git + PR + code | PDFs, Notion, Drive, markdown |
| Interface | MCP tools | Chat + admin + connectors |
| Differentiator | WHY / decisions | Auditable private RAG |

Build CodeOracle first so the retrieval spine exists; ContextVault reuses it with different connectors and a product UI.

---

## Success criteria (MVP done when…)

Full, authoritative Definition of Done lives in `PRD.md` §9 (Stage 5) — it supersedes the short list that used to live here, so there is one place to check, not two that can drift apart. Summary: one repo indexes free-tier end-to-end, all three MCP tools work with citations, incremental push works, golden-query eval passes, and cash spent = ₹0.

---

## Out of scope for v1 (avoid clone trap)

- Competing with Cursor’s built-in code search on “what does this function do?”  
- Building a full IDE  
- Boiling the ocean on multi-language perfect AST for every language  

Focus on **decision memory + MCP + freshness**.

---

## Docs in this repository

- Engineering / free-tier stack: `production-spec.md` (when present)
- Stage PRD / deliverables / success gates: `PRD.md` (when present)
- Product page: `demo/index.html`
