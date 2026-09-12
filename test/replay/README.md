# Live index replay suites

**Purpose:** Run structural quality gates against **any indexed repo** (not only the sample-repo fixture).  
Complements `test/golden-queries/` (CI fixture) with ops/dogfood regression for real indexes.

## CI vs dogfood (honest split)

| Layer | Where it runs | Needs |
|-------|---------------|--------|
| Golden fixture eval (`pnpm test:golden` / `pnpm test:eval`) | **Required CI** | Sample-repo + Compose + fake OpenAI provider — **no** Ollama/cloud |
| Replay **engine** units (`score` + suite schema load) | **Required CI** via `pnpm test` (`@codeoracle/cli`) | Nothing live — validates scoring + committed suite JSON |
| `codeoracle replay` against a product repo | **Dogfood / ops only** | Ready index + real embed provider (e.g. Ollama) + Postgres/Qdrant |

Live product-repo replay is **not** a GitHub Actions gate: it depends on a full indexed repo and real embeddings. CI locks ranking/extract behavior on the fixture path + **E11 failure-class units** (`pnpm test:retrieval-gates`); dogfood locks NL/decision quality on real indexes. See [`docs/ops/retrieval-eval-gate.md`](../../docs/ops/retrieval-eval-gate.md). Do not fake live replay in CI.

## Design

| Layer | Role |
|-------|------|
| Suite JSON | Data: queries + expectations for **one** product/repo shape |
| `codeoracle replay` | Engine: embed → `searchCodebase` / `findDecision` → score → exit code |
| Scoring | Pure functions (unit-tested): path **substring** match, hit@K, citation URL, topic needles, optional maxCount |

No ranking shortcuts live here. Suites never encode hostnames or dogfood-only policy.

## Suite shape

```json
{
  "version": 1,
  "description": "Optional human note",
  "cases": [
    {
      "id": "search-nl-impl",
      "tool": "search_codebase",
      "query": "where do we verify …",
      "gate": "hard",
      "expect": {
        "anyOfPathIncludes": ["github-signature.ts"],
        "hitAt": 3
      }
    },
    {
      "id": "find-topic",
      "tool": "find_decision",
      "query": "GitHub webhook HMAC",
      "gate": "hard",
      "expect": {
        "maxCount": 3,
        "topicOrSummaryIncludesAny": ["hmac", "webhook"],
        "requireCitationHttp": true
      }
    }
  ]
}
```

- **`gate: "hard"`** — failure → non-zero exit (default).  
- **`gate: "soft"`** — printed, does not fail the run (stretch cases).  
- **`anyOfPathIncludes`** — at least one result in hit@K has `filePath` **or** `symbolName` containing one of the strings (works across repo layouts; symbols catch `authorize*` in differently named files).  
- **`maxCount`** — upper bound on find_decision result length (bleed guard).

## Commands

```bash
# from repo root, with .env + providers.yaml + indexed repo
pnpm --filter @codeoracle/cli exec tsx src/main.ts replay <repoId> \
  --suite test/replay/suites/codeoracle-self.json

# or after build
pnpm codeoracle -- replay <repoId> --suite test/replay/suites/example.json
```

Exit: `0` all hard gates pass · `1` config/repo error · `2` hard gate failure(s).

## Adding a suite for another repo

1. Copy `example.json`.  
2. Write queries that express **failure classes** you care about (NL→impl, keyword no-regress, doc-intent, decision bleed).  
3. Use path **substrings** that exist in that repo’s tree.  
4. Keep stretch cases `gate: "soft"` until they pass reliably.
