# @codeoracle/core-domain

Framework-free **domain rules** — the hexagonal core. No NestJS, BullMQ, HTTP,
Postgres, or Qdrant imports. Adapters (`apps/worker`, `packages/retrieval`,
`packages/extraction`) call into this package; they do not redefine these rules.

| Module | Rule |
|---|---|
| `citation` | `isCitationUrl` — "no citation = bug" |
| `trivial-source` | `isTrivialSourceMessage` — skip non-WHY commits/PRs before LLM spend |
| `file-change` | git / GitHub path status → added/modified/deleted |
| `chunk-sync` | `planChunkSync` — content-hash multiset diff for incremental index |
| `hybrid-rrf` | Reciprocal Rank Fusion + dual-channel preference + single-channel backfill cutoff |
| `diversify-paths` | Best hit per `filePath` after search hydrate |
| `relative-score-floor` | Keep hits near the top score (decision list bleed / Q2) |
| `alternatives-consistency` | Empty alts invalid when source/summary asserts contrast (Q3) |

Capability packages may re-export for backward-compatible import paths, but the
**source of truth** is here.
