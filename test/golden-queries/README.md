# Golden-query set (PRD D5.1) + scoring (D5.2)

| File | Role |
|------|------|
| `queries.json` | 12 structural expectations against `test/fixtures/sample-repo` |
| `score.ts` | Pure hit@K / citation / explain scorers + PRD aggregate gates |
| `eval.integration.test.ts` | Full index→extract→score against live compose (`pnpm test:eval`) |
| `load.test.ts` / `score.test.ts` | Offline unit guards (`pnpm test:golden`) |

**PRD NFR-5 gates (fail CI if unmet):** search hit@3 ≥ 80%; find_decision citation correctness = 100%.
