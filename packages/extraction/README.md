# @codeoracle/extraction

Decision extraction pipeline (Stage 3): PR/commit → redacted prompt → gateway chat → structured `Decision` JSON.

## Modules

| File | Responsibility |
|------|----------------|
| `redact-secrets.ts` | FR-13 scrubber before LLM calls |
| `prompt.ts` | System + user prompt templates |
| `parse-extraction.ts` | JSON parse + `DecisionExtractionBatchSchema` validation |
| `extract-from-source.ts` | Orchestrates one source extraction (no persistence) |

Persistence and BullMQ jobs live in `apps/worker` (D3.3).
