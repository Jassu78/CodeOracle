# Retrieval eval gate (E11)

## What CI owns

| Gate | Where | Covers |
|------|-------|--------|
| `pnpm test:retrieval-gates` | Every PR (`ci.yml`) + weekly `retrieval-eval.yml` | Absolute floor / xyzzy empty, secret path refuse (`.env2`), search/explain refuse, lexical garbage empty, replay score helpers |
| `pnpm test:golden` | PR + weekly | Sample-repo structural hit@3 |
| `pnpm test:eval` | Integration job + weekly | Live sample-repo index → search/find hit rates |

## What dogfood owns (not GitHub Actions)

Product-repo soft NL / authorize / HMAC gates need a **ready** index and real embeds:

```bash
cd ~/codeoracle/repo
pnpm --filter @codeoracle/cli exec tsx src/main.ts replay "$REPO_ID" \
  --suite test/replay/suites/codeoracle-self.json
# exit 0 = all hard gates pass; exit 2 = hard failure(s)
```

Suite includes (E11 additions):

- `R6-garbage-empty` — nonsense query must return **zero** hits (`expectEmpty`)
- `R7-exact-signature-symbol` — exact/symbol lane still finds `verifyGitHubSignature`

Schedule a weekly cron on the dogfood host if you want continuous live coverage (CI cannot reach private Ollama + indexed CodeOracle).

## Failure classes checklist

- Soft NL → implementation hit@3 (dogfood R1 / sample soft queries)
- Exact / symbol (dogfood R7 / E1 unit tests)
- Garbage → empty (dogfood R6 + P0-B units)
- Secrets refuse (P0-A units — never assert live `.env` hits)
