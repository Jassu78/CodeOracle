import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  SearchCodebaseOutputSchema,
  type SearchCodebaseOutput,
} from "@codeoracle/contracts";
import { diversifyByFilePath, mustRefuseSecretRetrieval, SEARCH_ABSOLUTE_SCORE_FLOOR, bestScore } from "@codeoracle/core-domain";
import { getChunksByIds, type ChunkRow, type Database } from "@codeoracle/db";
import { searchSimilarChunks } from "./store/qdrant.js";
import type { EmbedFn } from "./util.js";

export type ChunkSearchHit = {
  id: string;
  /** Ranking score: RRF for hybrid, dense cosine for legacy dense-only. */
  score: number;
  /**
   * Dense cosine evidence for P0-B absolute floor.
   * Hybrid sparse-only hits set this to 0; legacy dense sets it equal to `score`.
   */
  evidenceScore: number;
};

export type SearchCodebaseDeps = {
  search: (opts: {
    repoId: string;
    vector: number[];
    queryText: string;
    limit: number;
    scoreThreshold: number;
  }) => Promise<ChunkSearchHit[]>;
  getByIds: (ids: string[]) => Promise<ChunkRow[]>;
};

export type SearchCodebaseOpts = {
  db: Database;
  qdrant: QdrantClient;
  embed: EmbedFn;
  repoId: string;
  query: string;
  topK?: number;
  scoreThreshold?: number;
  /**
   * If the best **dense evidence** score is below this, return no results (P0-B).
   * Default SEARCH_ABSOLUTE_SCORE_FLOOR (0.35). Hybrid ranking still uses RRF
   * `score`; absolute no-match uses `evidenceScore` so sparse-only garbage empties.
   */
  absoluteMinScore?: number;
  /** Test seam — production callers omit this. */
  deps?: SearchCodebaseDeps;
};

/** Over-fetch so filePath diversity can still fill topK after collapsing dupes. */
export function searchFetchLimit(topK: number): number {
  return Math.max(topK * 2, topK + 5);
}

/**
 * Semantic code search for MCP `search_codebase`.
 * Embed → Qdrant (repo-scoped; hybrid RRF + post-fusion cutoff when collection
 * supports sparse) → Postgres hydrate → absolute dense-evidence floor (P0-B) →
 * filePath diversity with doc quota → citation → Zod. No LLM.
 *
 * Doc quota: when source hits remain in the over-fetch pool, documentation
 * paths cannot consume every display slot (Q1 R4 — dual-channel docs monopoly).
 */
export async function searchCodebase(opts: SearchCodebaseOpts): Promise<SearchCodebaseOutput> {
  const query = opts.query.trim();
  if (!query) {
    throw new Error("searchCodebase: query must be non-empty");
  }
  if (!opts.repoId.trim()) {
    throw new Error("searchCodebase: repoId must be non-empty");
  }

  const limit = opts.topK ?? 10;
  const scoreThreshold = opts.scoreThreshold ?? 0.35;
  const absoluteMinScore = opts.absoluteMinScore ?? SEARCH_ABSOLUTE_SCORE_FLOOR;
  const fetchLimit = searchFetchLimit(limit);

  const deps: SearchCodebaseDeps = opts.deps ?? {
    search: (args) =>
      searchSimilarChunks(opts.qdrant, {
        repoId: args.repoId,
        vector: args.vector,
        queryText: args.queryText,
        limit: args.limit,
        scoreThreshold: args.scoreThreshold,
      }),
    getByIds: (ids) => getChunksByIds(opts.db, ids),
  };

  const [vector] = await opts.embed([query]);
  if (!vector || vector.length === 0) {
    throw new Error("searchCodebase: embedding provider returned an empty vector");
  }

  const hits = await deps.search({
    repoId: opts.repoId,
    vector,
    queryText: query,
    limit: fetchLimit,
    scoreThreshold,
  });

  if (hits.length === 0) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const hydrated: SearchCodebaseOutput["results"] = [];
  const evidenceForFloor: Array<{ score: number }> = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    const filePath = row.filePath?.trim() ?? "";
    if (!filePath) continue; // citation mandatory
    // P0-A: refuse dotenv/secret path class + high-confidence secret payloads
    // even if stale vectors remain until full reindex.
    if (mustRefuseSecretRetrieval(filePath, row.content)) continue;

    evidenceForFloor.push({ score: hit.evidenceScore });
    hydrated.push({
      chunkId: row.id,
      filePath,
      symbolName: row.symbolName ?? null,
      content: row.content,
      score: hit.score,
      repoId: row.repoId,
    });
  }

  // P0-B: empty when best dense evidence is too weak (sparse-only → evidence 0).
  if (hydrated.length === 0 || bestScore(evidenceForFloor) < absoluteMinScore) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const results = diversifyByFilePath(hydrated, limit);
  return SearchCodebaseOutputSchema.parse({ results });
}
