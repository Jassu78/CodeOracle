# Latency SLOs — search_codebase / find_decision (E5)

**Status:** Dogfood targets (not CI gates). E11 owns continuous eval gates.  
**Measure via:** structured `query_latency` logs (`component=query-cache`). Optional dual-write: OpenTelemetry histograms when `OTEL_ENABLED=true` (see [`otel.md`](./otel.md)).  
**Never log** query/topic text or chunk bodies.

## Cache (E5)

| Env | Default | Role |
|-----|---------|------|
| `QUERY_CACHE_ENABLED` | `true` | MCP edge Redis cache |
| `QUERY_CACHE_TTL_SECONDS` | `600` | TTL; also busted by repo `indexEpoch` after reindex |

Cache key includes repo, query/topic, ranking-affecting opts (`topK`, floors, thresholds, `rerankEnabled` + caps even when OFF), and `indexEpoch`. Replay/CLI bypasses cache.

## Dogfood p95 targets (local Ollama `nomic`-class embeds)

| Slice | `search_codebase` | `find_decision` |
|-------|-------------------|-----------------|
| **Cache hit** (embed N/A) | ≤ **50 ms** | ≤ **50 ms** |
| **Miss, embed excluded** | ≤ **400 ms** | ≤ **300 ms** |
| **Miss, embed included** | ≤ **2000 ms** | ≤ **1500 ms** |

### Embed excluded vs included

- **Included** (`latencyMs`): end-to-end tool time on a cache miss (embed + retrieve + hydrate + floors ± rerank).
- **Excluded** (`latencyEmbedExcludedMs` ≈ `latencyMs - embedMs`): retrieval stack only — fair host-comparable budget.
- On **cache hit**, `embedMs` is null; `latencyMs` ≈ `latencyEmbedExcludedMs`.

### Notes

- Local TEI rerank ON can add up to `SEARCH_RERANK_TIMEOUT_MS` (fail-open); raise dogfood timeout to 400–500ms for CPU CE.
- Free-tier cloud chat extract is unrelated to these read-path SLOs.
- Hit rate: `hit / (hit + miss)` from logs (exclude `bypass` / `error`).

## Log fields

```json
{
  "component": "query-cache",
  "msg": "query_latency",
  "tool": "search_codebase",
  "repoId": "<uuid>",
  "cache": "hit",
  "latencyMs": 12,
  "embedMs": null,
  "latencyEmbedExcludedMs": 12,
  "resultCount": 5
}
```
