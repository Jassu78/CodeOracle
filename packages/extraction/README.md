# @codeoracle/extraction

Decision extraction pipeline (Stage 3): PR/commit → redacted prompt → gateway chat → structured `Decision` JSON.

## Modules

| File | Responsibility |
|------|----------------|
| `redact-secrets.ts` | FR-13 scrubber before LLM calls |
| `prompt.ts` | System + user prompt templates |
| `parse-extraction.ts` | JSON parse + Zod + alternatives consistency drop helpers (Q3) |
| `extract-from-source.ts` | Orchestrates one source extraction (parse repair + Q3 consistency repair/drop; no persistence) |

Persistence and BullMQ jobs live in `apps/worker` (D3.3).

**Q3 alternatives policy:** empty `alternativesConsidered` is allowed when the source names no option. If source/summary asserts contrast and alts are empty, one consistency repair runs; residual inconsistent decisions are **dropped** (never invented).
