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
| `hybrid-rrf` | Reciprocal Rank Fusion + post-fusion channel/rank cutoff |

Capability packages may re-export for backward-compatible import paths, but the
**source of truth** is here.
