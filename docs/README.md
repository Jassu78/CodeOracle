# CodeOracle — Docs Index

Self-hosted MCP server giving AI coding agents persistent memory of a codebase's **WHY** (decisions, trade-offs, PR rationale), built on a ₹0 / free-tier, universal OpenAI-compatible stack.

## Read in this order

1. **[`intro.md`](./intro.md)** — *Why.* Product test, differentiation vs Cody/Greptile/generic memory MCPs, phased scope (single repo → monorepo → multi-repo workspace), monetization.
2. **[`competitive-strategy.md`](./competitive-strategy.md)** — *Reality check.* Detailed comparison against 6 already-shipped competitors (decidex, WhyCode, DecisionNode, RetainDB, wai, whodecided) plus a source-verified deep-dive on **Graphify** (§9 — 111k+ stars, YC-backed) and an honest standalone strength/weakness verdict (§11 — weak as a head-to-head competitor, moderate-to-strong as a narrow technical component, with a "complementary, not competing" framing worth considering). **Read this before trusting the original wedge in `intro.md` at face value — §9.7/§11.3 leave real decisions open for the owner.**
3. **[`production-spec.md`](./production-spec.md)** — *How.* Architecture, data model (`Decision`, `CodeChunk`, `Repo`), incremental reindex algorithm, MCP tool contracts, universal OpenAI-compatible gateway design, locked tech stack.
4. **[`architecture-design.md`](./architecture-design.md)** — *Repo structure.* Monorepo layout, module boundary map, job orchestration, plug-and-play gateway class diagram, CLI bootstrap design — the concrete implementation of production-spec.md's decisions.
5. **[`PRD.md`](./PRD.md)** — *Execution.* Stage 0–7 plan with concrete deliverables and success gates, functional/non-functional requirements, risks, metrics, Definition of Done.

## Doc authority (who wins on conflict)

| Conflict type | Winner |
|---|---|
| Product intent / what we're building | `intro.md`, refined by `competitive-strategy.md` |
| Architecture / mechanism / schema | `production-spec.md` |
| Stage sequencing / deliverables / "is this done" | `PRD.md` |

If `intro.md` and `production-spec.md` disagree on *why*, resolve toward the intro (as refined by the competitive strategy), then update the spec. If `production-spec.md` and `PRD.md` disagree on *how*, the spec wins, then update the PRD's stage detail to match.

## Quick facts

- **Cost:** ₹0 for MVP — self-hosted OCI + universal OpenAI-compatible gateway (free local + free cloud models)
- **Scope (MVP):** one GitHub repo, three MCP tools (`search_codebase`, `explain_file`, `find_decision`), all citation-backed
- **Timeline:** 5-week MVP, 8–10 week hardened v1
- **Non-goals (v1):** multi-repo workspace, web dashboard, paid APIs as a hard requirement, drift detection, AST provenance links, quality harness, OAuth/billing (these exist in competitor WhyCode — see `competitive-strategy.md` §6)
- **Positioning (post-competitive-review):** *"The only self-hosted MCP server that searches your code and remembers why it's built that way — works with any model, stays fresh automatically."* Decisions stay co-headline with hybrid code search; the universal gateway is a supporting feature, deliberately not the headline (it would invite comparison to LiteLLM/Portkey/OpenRouter — see `competitive-strategy.md` §5a). Full reasoning: `competitive-strategy.md` §5.

See `CHANGELOG.md` for the history of material decisions across these docs.
